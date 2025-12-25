import { resolve, relative, join } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import { glob } from 'glob';
import { getProjectByPath, getAllProjects, getDb, getProjectFiles, deleteFile } from '../../db/index.js';
import { indexProject, indexFile, getSupportedExtensions } from '../../indexer/index.js';

interface ReindexOptions {
  full?: boolean;
  withBlame?: boolean;
}

function findProjectForPath(targetPath: string): { project: ReturnType<typeof getProjectByPath>; projectPath: string } | null {
  // Check if targetPath itself is a project
  let project = getProjectByPath(targetPath);
  if (project) {
    return { project, projectPath: targetPath };
  }

  // Walk up the directory tree to find a project
  let currentPath = targetPath;
  while (currentPath !== resolve(currentPath, '..')) {
    currentPath = resolve(currentPath, '..');
    project = getProjectByPath(currentPath);
    if (project) {
      return { project, projectPath: currentPath };
    }
  }

  return null;
}

async function reindexFiles(
  projectId: number,
  projectPath: string,
  filePaths: string[],
  options: ReindexOptions
): Promise<{ files: number; structures: number }> {
  let totalStructures = 0;
  let indexedFiles = 0;

  for (const relativePath of filePaths) {
    const count = await indexFile(projectId, projectPath, relativePath, {
      trackBlame: options.withBlame,
    });
    if (count > 0) {
      indexedFiles++;
      totalStructures += count;
      console.log(chalk.gray(`  ${relativePath}: ${count} structures`));
    }
  }

  return { files: indexedFiles, structures: totalStructures };
}

export async function reindexCommand(targetPath?: string, options: ReindexOptions = {}): Promise<void> {
  const inputPath = resolve(targetPath || process.cwd());

  if (!existsSync(inputPath)) {
    console.error(chalk.red(`Error: Path does not exist: ${inputPath}`));
    process.exit(1);
  }

  // Find the project this path belongs to
  const found = findProjectForPath(inputPath);
  if (!found) {
    console.error(chalk.red(`Error: No aimem project found for: ${inputPath}`));
    console.error(chalk.gray(`Run 'aimem init' first to initialize a project.`));
    process.exit(1);
  }

  const { project, projectPath } = found;
  const isSubPath = inputPath !== projectPath;
  const stat = statSync(inputPath);

  console.log(chalk.blue(`Project: ${project!.name} (${projectPath})`));

  if (options.full && !isSubPath) {
    // Full reindex: clear all structures and links for this project
    console.log(chalk.yellow(`Clearing existing index...`));
    const db = getDb();

    // Delete all structures (cascades to links via triggers)
    db.prepare(`
      DELETE FROM structures WHERE file_id IN (
        SELECT id FROM files WHERE project_id = ?
      )
    `).run(project!.id);

    // Delete all files for this project
    db.prepare('DELETE FROM files WHERE project_id = ?').run(project!.id);

    console.log(chalk.gray(`  Cleared all indexed data for project`));
  }

  if (isSubPath) {
    // Reindex specific file or directory
    const relativeTo = projectPath;
    let filesToIndex: string[] = [];

    if (stat.isFile()) {
      // Single file
      const relPath = relative(projectPath, inputPath);
      filesToIndex = [relPath];
      console.log(chalk.blue(`Reindexing file: ${relPath}`));
    } else {
      // Directory - find all supported files
      const extensions = getSupportedExtensions().map(ext => ext.slice(1));
      const pattern = `**/*.{${extensions.join(',')}}`;
      const relDir = relative(projectPath, inputPath);

      const files = await glob(pattern, {
        cwd: inputPath,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/__pycache__/**',
          '**/.venv/**',
        ],
        nodir: true,
        absolute: false,
      });

      filesToIndex = files.map(f => join(relDir, f));
      console.log(chalk.blue(`Reindexing directory: ${relDir}/ (${filesToIndex.length} files)`));
    }

    if (filesToIndex.length === 0) {
      console.log(chalk.yellow(`No supported files found to index.`));
      return;
    }

    const result = await reindexFiles(project!.id, projectPath, filesToIndex, options);
    console.log(chalk.green(`Done! Indexed ${result.files} files, ${result.structures} structures`));
  } else {
    // Full project reindex
    console.log(chalk.blue(`Reindexing entire project...`));
    const result = await indexProject(project!.id, projectPath, {
      trackBlame: options.withBlame,
    });
    console.log(chalk.green(`Done! Indexed ${result.files} files, ${result.structures} structures, ${result.links} call links`));
  }
}
