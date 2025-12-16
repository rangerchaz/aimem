// Simple HTTP server for serving the dashboard with live data
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { VisualizationData } from './index.js';
import { generateDashboardHTML } from './template.js';

export interface ServerOptions {
  port: number;
  getData: () => VisualizationData;
}

export function startDashboardServer(options: ServerOptions): Promise<void> {
  const { port, getData } = options;

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '/';

      // CORS headers for API
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (url === '/' || url === '/index.html') {
        // Serve dashboard HTML
        try {
          const data = getData();
          const html = generateDashboardHTML(data);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error generating dashboard: ' + (error as Error).message);
        }
      } else if (url === '/api/data') {
        // API endpoint for fresh data (for live updates)
        try {
          const data = getData();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      } else if (url === '/api/health') {
        // Health check endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      resolve();
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      server.close(() => {
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      server.close(() => {
        process.exit(0);
      });
    });
  });
}
