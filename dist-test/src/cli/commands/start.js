import { spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { getDataDir, ensureDataDir } from '../../db/index.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function getServicePid(name) {
    const pidFile = join(getDataDir(), `${name}.pid`);
    if (!existsSync(pidFile))
        return null;
    try {
        const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
        return isProcessRunning(pid) ? pid : null;
    }
    catch {
        return null;
    }
}
function writePidFile(name, pid) {
    const pidFile = join(getDataDir(), `${name}.pid`);
    writeFileSync(pidFile, String(pid));
}
export async function startCommand(options) {
    ensureDataDir();
    const dataDir = getDataDir();
    const startProxy = options.proxy !== false;
    const startWatcher = options.watcher !== false;
    const port = options.port || 8080;
    console.log(chalk.bold('Starting aimem services...\n'));
    // Start proxy (mockttp-based)
    if (startProxy) {
        const existingPid = getServicePid('proxy');
        if (existingPid) {
            console.log(chalk.yellow(`Proxy already running (PID ${existingPid})`));
        }
        else {
            const interceptorPath = join(__dirname, '..', '..', 'proxy', 'interceptor-mockttp.js');
            const child = spawn('node', [interceptorPath], {
                detached: true,
                stdio: 'ignore',
                env: {
                    ...process.env,
                    AIMEM_DATA_DIR: dataDir,
                    AIMEM_PROXY_PORT: String(port),
                },
            });
            if (child.pid) {
                writePidFile('proxy', child.pid);
                child.unref();
                console.log(chalk.green(`Proxy started on port ${port} (PID ${child.pid})`));
                console.log(chalk.gray(`  Configure tools with: HTTPS_PROXY=http://localhost:${port}`));
                const certPath = join(dataDir, 'ca-cert.pem');
                console.log(chalk.gray(`  CA certificate: ${certPath}`));
            }
        }
    }
    // Start watcher
    if (startWatcher) {
        const existingPid = getServicePid('watcher');
        if (existingPid) {
            console.log(chalk.yellow(`Watcher already running (PID ${existingPid})`));
        }
        else {
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
//# sourceMappingURL=start.js.map