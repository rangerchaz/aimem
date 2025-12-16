import { startMcpServer } from '../../mcp/server.js';

export async function mcpServeCommand(): Promise<void> {
  await startMcpServer();
}
