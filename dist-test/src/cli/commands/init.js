import { resolve } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { createProject, getProjectByPath, getDataDir } from '../../db/index.js';
import { indexProject } from '../../indexer/index.js';
export async function initCommand(targetPath) {
    const projectPath = resolve(targetPath || process.cwd());
    if (!existsSync(projectPath)) {
        console.error(chalk.red(`Error: Path does not exist: ${projectPath}`));
        process.exit(1);
    }
    // Check if already initialized
    const existing = getProjectByPath(projectPath);
    if (existing) {
        console.log(chalk.yellow(`Project already initialized: ${existing.name}`));
        console.log(chalk.gray(`Re-indexing...`));
        await indexProject(existing.id, projectPath);
        console.log(chalk.green(`Re-indexed: ${projectPath}`));
        return;
    }
    // Create new project
    const name = projectPath.split('/').pop() || 'project';
    const project = createProject(projectPath, name);
    console.log(chalk.green(`Initialized aimem for: ${projectPath}`));
    console.log(chalk.gray(`Data stored in: ${getDataDir()}`));
    console.log(chalk.gray(`Project ID: ${project.id}`));
    // Index the project
    console.log(chalk.blue(`Indexing codebase...`));
    await indexProject(project.id, projectPath);
    console.log(chalk.green(`Done!`));
}
//# sourceMappingURL=init.js.map