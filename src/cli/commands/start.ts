import { spawn, spawnSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { getDataDir, ensureDataDir } from '../../db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isMitmproxyInstalled(): boolean {
  try {
    const result = spawnSync('mitmdump', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

interface StartOptions {
  proxy?: boolean;
  watcher?: boolean;
  port?: number;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getServicePid(name: string): number | null {
  const pidFile = join(getDataDir(), `${name}.pid`);
  if (!existsSync(pidFile)) return null;

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    return isProcessRunning(pid) ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(name: string, pid: number): void {
  const pidFile = join(getDataDir(), `${name}.pid`);
  writeFileSync(pidFile, String(pid));
}

export async function startCommand(options: StartOptions): Promise<void> {
  ensureDataDir();
  const dataDir = getDataDir();

  const startProxy = options.proxy !== false;
  const startWatcher = options.watcher !== false;
  const port = options.port || 8080;

  console.log(chalk.bold('Starting aimem services...\n'));

  // Start proxy
  if (startProxy) {
    const existingPid = getServicePid('proxy');
    if (existingPid) {
      console.log(chalk.yellow(`Proxy already running (PID ${existingPid})`));
    } else if (!isMitmproxyInstalled()) {
      console.log(chalk.red('✗ mitmproxy is not installed'));
      console.log(chalk.yellow('\n  mitmproxy is required for context capture. Install it with:\n'));
      console.log(chalk.white('    pip install mitmproxy\n'));
      console.log(chalk.gray('  After installing, run `aimem start` again.'));
    } else {
      const interceptorPath = join(__dirname, '..', '..', 'proxy', 'interceptor.py');

      try {
        const child = spawn('mitmdump', [
          '-s', interceptorPath,
          '-p', String(port),
          '--set', `data_dir=${dataDir}`,
        ], {
          detached: true,
          stdio: 'ignore',
        });

        if (child.pid) {
          writePidFile('proxy', child.pid);
          child.unref();
          console.log(chalk.green(`Proxy started on port ${port} (PID ${child.pid})`));
          console.log(chalk.gray(`  Configure tools with: HTTP_PROXY=http://localhost:${port}`));
        }
      } catch (err) {
        console.log(chalk.red('Failed to start proxy.'));
        console.log(chalk.gray('  Check mitmproxy installation: pip install mitmproxy'));
      }
    }
  }

  // Start watcher
  if (startWatcher) {
    const existingPid = getServicePid('watcher');
    if (existingPid) {
      console.log(chalk.yellow(`Watcher already running (PID ${existingPid})`));
    } else {
      const watcherPath = join(__dirname, '..', '..', 'indexer', 'watcher-daemon.js');

      const child = spawn('node', [watcherPath], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, AIMEM_DATA_DIR: dataDir },
      });

      if (child.pid) {
        writePidFile('watcher', child.pid);
        child.unref();
        console.log(chalk.green(`Watcher started (PID ${child.pid})`));
      }
    }
  }

  console.log(chalk.gray('\nUse `aimem status` to check service status'));
  console.log(chalk.gray('Use `aimem stop` to stop services'));
}
