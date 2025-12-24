import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getStats, getAllProjects, getDataDir } from '../../db/index.js';
function getServiceStatus(name) {
    const pidFile = join(getDataDir(), `${name}.pid`);
    if (!existsSync(pidFile)) {
        return { running: false };
    }
    try {
        const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
        // Check if process is running
        process.kill(pid, 0);
        return { running: true, pid };
    }
    catch {
        return { running: false };
    }
}
export function statusCommand() {
    const dataDir = getDataDir();
    console.log(chalk.bold('aimem status\n'));
    // Data directory
    console.log(chalk.gray(`Data directory: ${dataDir}`));
    console.log();
    // Services
    console.log(chalk.bold('Services:'));
    const proxy = getServiceStatus('proxy');
    const watcher = getServiceStatus('watcher');
    console.log(`  Proxy:   ${proxy.running ? chalk.green(`running (PID ${proxy.pid})`) : chalk.gray('stopped')}`);
    console.log(`  Watcher: ${watcher.running ? chalk.green(`running (PID ${watcher.pid})`) : chalk.gray('stopped')}`);
    console.log();
    // Database stats
    console.log(chalk.bold('Database:'));
    try {
        const stats = getStats();
        console.log(`  Projects:      ${chalk.cyan(stats.projects)}`);
        console.log(`  Files:         ${chalk.cyan(stats.files)}`);
        console.log(`  Structures:    ${chalk.cyan(stats.structures)}`);
        console.log(`  Conversations: ${chalk.cyan(stats.conversations)}`);
        console.log(`  Links:         ${chalk.cyan(stats.links)}`);
    }
    catch (err) {
        console.log(chalk.gray('  (no database yet)'));
    }
    console.log();
    // Projects
    console.log(chalk.bold('Projects:'));
    try {
        const projects = getAllProjects();
        if (projects.length === 0) {
            console.log(chalk.gray('  (none)'));
        }
        else {
            for (const p of projects) {
                console.log(`  ${chalk.cyan(p.name)} - ${chalk.gray(p.path)}`);
            }
        }
    }
    catch {
        console.log(chalk.gray('  (no database yet)'));
    }
}
//# sourceMappingURL=status.js.map