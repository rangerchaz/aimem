// Watcher daemon - runs in background
import { startWatcher } from './watcher.js';

console.log('[aimem watcher] Starting...');

const stop = startWatcher({
  onIndex: (projectId, path, structures) => {
    console.log(`[aimem watcher] Indexed ${path} (${structures} structures)`);
  },
  onDelete: (projectId, path) => {
    console.log(`[aimem watcher] Removed ${path}`);
  },
  onError: (error) => {
    console.error('[aimem watcher] Error:', error.message);
  },
});

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('[aimem watcher] Shutting down...');
  stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[aimem watcher] Shutting down...');
  stop();
  process.exit(0);
});

console.log('[aimem watcher] Ready');
