import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { getDataDir } from '../../db/index.js';

function stopService(name: string): boolean {
  const pidFile = join(getDataDir(), `${name}.pid`);

  if (!existsSync(pidFile)) {
    return false;
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);

    // Try to kill the process
    try {
      process.kill(pid, 'SIGTERM');
      console.log(chalk.green(`Stopped ${name} (PID ${pid})`));
    } catch {
      console.log(chalk.gray(`${name} was not running`));
    }

    // Remove PID file
    unlinkSync(pidFile);
    return true;
  } catch (err) {
    console.log(chalk.red(`Error stopping ${name}: ${err}`));
    return false;
  }
}

interface StopOptions {
  proxy?: boolean;
  watcher?: boolean;
}

export function stopCommand(options: StopOptions): void {
  const stopProxy = options.proxy !== false;
  const stopWatcher = options.watcher !== false;

  console.log(chalk.bold('Stopping aimem services...\n'));

  let stopped = 0;

  if (stopProxy) {
    if (stopService('proxy')) stopped++;
  }

  if (stopWatcher) {
    if (stopService('watcher')) stopped++;
  }

  if (stopped === 0) {
    console.log(chalk.gray('No services were running'));
  }
}
