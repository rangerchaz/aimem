import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import {
  findProjectForPath,
  getProjectFiles,
  getAllProjectStructures,
  getAllProjectLinks,
  getAllProjectExtractions,
  getFullConversations,
} from '../../db/index.js';
import { buildVisualizationData, generateDashboard } from '../../visualize/index.js';
import { startDashboardServer } from '../../visualize/server.js';

export interface VisualizeOptions {
  output?: string;
  open?: boolean;
  serve?: boolean;
  port?: number;
}

export async function visualizeCommand(options: VisualizeOptions): Promise<void> {
  const cwd = process.cwd();

  // Find project
  const project = findProjectForPath(cwd);
  if (!project) {
    console.log(chalk.red('Error: No aimem project found for current directory.'));
    console.log(chalk.gray('Run "aimem init" first to initialize a project.'));
    process.exit(1);
  }

  console.log(chalk.bold(`Generating visualization for: ${project.name}\n`));

  // Gather data
  console.log(chalk.gray('Gathering data...'));
  const structures = getAllProjectStructures(project.id);
  const files = getProjectFiles(project.id);
  const links = getAllProjectLinks(project.id);
  const extractions = getAllProjectExtractions(project.id);
  const conversations = getFullConversations(project.id, 1000); // Get up to 1000 conversations

  console.log(chalk.gray(`  ${structures.length} structures`));
  console.log(chalk.gray(`  ${files.length} files`));
  console.log(chalk.gray(`  ${links.length} links`));
  console.log(chalk.gray(`  ${extractions.length} extractions`));
  console.log(chalk.gray(`  ${conversations.length} conversations`));
  console.log();

  if (structures.length === 0) {
    console.log(chalk.yellow('Warning: No structures found. The codebase may not be indexed yet.'));
    console.log(chalk.gray('Run "aimem start" to begin indexing.'));
  }

  // Build visualization data
  const vizData = buildVisualizationData(project, structures, files, links, extractions, conversations);

  if (options.serve) {
    // Serve mode
    const port = options.port || 8080;

    console.log(chalk.cyan(`Starting dashboard server on port ${port}...`));

    try {
      await startDashboardServer({
        port,
        getData: () => buildVisualizationData(
          project,
          getAllProjectStructures(project.id),
          getProjectFiles(project.id),
          getAllProjectLinks(project.id),
          getAllProjectExtractions(project.id),
          getFullConversations(project.id, 1000)
        ),
      });

      const url = `http://localhost:${port}`;
      console.log(chalk.green(`\nDashboard running at: ${chalk.bold(url)}`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      // Open in browser if requested
      if (options.open) {
        openBrowser(url);
      }
    } catch (error) {
      console.log(chalk.red(`Error starting server: ${(error as Error).message}`));
      process.exit(1);
    }
  } else {
    // Static file mode
    const outputPath = options.output || join(cwd, 'aimem-dashboard.html');

    console.log(chalk.gray('Generating HTML...'));
    const html = generateDashboard(vizData);

    writeFileSync(outputPath, html, 'utf-8');
    console.log(chalk.green(`\nDashboard saved to: ${chalk.bold(outputPath)}`));

    // Open in browser if requested
    if (options.open) {
      console.log(chalk.gray('Opening in browser...'));
      openBrowser(outputPath);
    } else {
      console.log(chalk.gray('Use --open to open in browser'));
    }
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    // Linux and others
    command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.log(chalk.yellow(`Could not open browser automatically.`));
      console.log(chalk.gray(`Open manually: ${url}`));
    }
  });
}
