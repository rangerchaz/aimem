import { watch } from 'chokidar';
import { relative } from 'path';
import { getAllProjects, getFileByPath, deleteFile } from '../db/index.js';
import { indexFile, getSupportedExtensions } from './index.js';

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/vendor/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
];

export interface WatcherOptions {
  onIndex?: (projectId: number, path: string, structures: number) => void;
  onDelete?: (projectId: number, path: string) => void;
  onError?: (error: Error) => void;
}

export function startWatcher(options: WatcherOptions = {}): () => void {
  const projects = getAllProjects();
  const watchers: ReturnType<typeof watch>[] = [];

  const extensions = getSupportedExtensions();
  const extPattern = extensions.map(e => e.slice(1)).join(',');

  for (const project of projects) {
    const watcher = watch(`**/*.{${extPattern}}`, {
      cwd: project.path,
      ignored: IGNORE_PATTERNS,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    watcher.on('add', async (path) => {
      try {
        const count = await indexFile(project.id, project.path, path);
        options.onIndex?.(project.id, path, count);
      } catch (err) {
        options.onError?.(err as Error);
      }
    });

    watcher.on('change', async (path) => {
      try {
        const count = await indexFile(project.id, project.path, path);
        options.onIndex?.(project.id, path, count);
      } catch (err) {
        options.onError?.(err as Error);
      }
    });

    watcher.on('unlink', async (path) => {
      try {
        const file = getFileByPath(project.id, path);
        if (file) {
          deleteFile(file.id);
          options.onDelete?.(project.id, path);
        }
      } catch (err) {
        options.onError?.(err as Error);
      }
    });

    watcher.on('error', (err: unknown) => {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

    watchers.push(watcher);
  }

  // Return cleanup function
  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}
