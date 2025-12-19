/**
 * Proxy daemon - runs the mockttp proxy as a background service
 */

import { AimemProxy } from './interceptor-mockttp.js';

const port = parseInt(process.env.AIMEM_PROXY_PORT || '8080', 10);
const projectId = parseInt(process.env.AIMEM_PROJECT_ID || '0', 10) || undefined;

const proxy = new AimemProxy({ projectId });

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[aimem-proxy] Received SIGTERM, shutting down...');
  await proxy.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[aimem-proxy] Received SIGINT, shutting down...');
  await proxy.stop();
  process.exit(0);
});

// Start the proxy
proxy.start(port).then(() => {
  console.log(`[aimem-proxy] Daemon started on port ${port}`);
}).catch(err => {
  console.error('[aimem-proxy] Failed to start:', err);
  process.exit(1);
});
