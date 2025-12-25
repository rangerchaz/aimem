#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'module';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { queryCommand } from './commands/query.js';
import { mcpServeCommand } from './commands/mcp-serve.js';
import { setupCommand } from './commands/setup.js';
import { importCommand } from './commands/import.js';
import { visualizeCommand } from './commands/visualize.js';
import { gitCommand } from './commands/git.js';
import { reindexCommand } from './commands/reindex.js';
import { guardrailsCommand } from './commands/guardrails.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

const program = new Command();

program
  .name('aimem')
  .description('Local memory system for AI coding assistants')
  .version(packageJson.version);

program
  .command('init [path]')
  .description('Initialize aimem for a codebase')
  .action(initCommand);

program
  .command('reindex [path]')
  .description('Reindex a project, file, or directory')
  .option('-f, --full', 'Clear all indexed data before reindexing')
  .option('-b, --with-blame', 'Track git authorship for each structure')
  .action((path, options) => {
    reindexCommand(path, {
      full: options.full,
      withBlame: options.withBlame,
    });
  });

program
  .command('start')
  .description('Start proxy and watcher services')
  .option('--no-proxy', 'Do not start the proxy')
  .option('--no-watcher', 'Do not start the file watcher')
  .option('-p, --port <port>', 'Proxy port', '8080')
  .action((options) => {
    startCommand({
      proxy: options.proxy,
      watcher: options.watcher,
      port: parseInt(options.port, 10),
    });
  });

program
  .command('stop')
  .description('Stop running services')
  .option('--proxy', 'Only stop the proxy')
  .option('--watcher', 'Only stop the watcher')
  .action((options) => {
    const stopProxy = options.proxy || (!options.proxy && !options.watcher);
    const stopWatcher = options.watcher || (!options.proxy && !options.watcher);
    stopCommand({ proxy: stopProxy, watcher: stopWatcher });
  });

program
  .command('status')
  .description('Show status of aimem services and database')
  .action(statusCommand);

program
  .command('query <search>')
  .description('Query structures and conversations (scoped to current project by default)')
  .option('-t, --type <type>', 'Query type: all, structures, conversations', 'all')
  .option('-l, --limit <limit>', 'Maximum results', '10')
  .option('-g, --global', 'Search across all projects')
  .action((search, options) => {
    queryCommand(search, {
      type: options.type as 'all' | 'structures' | 'conversations',
      limit: parseInt(options.limit, 10),
      global: options.global,
    });
  });

program
  .command('mcp-serve')
  .description('Start MCP server for Claude Code integration')
  .action(mcpServeCommand);

// Setup commands for integrating with AI coding tools
program
  .command('setup [tool]')
  .description('Configure aimem for an AI coding tool (e.g., claude-code, proxy, cursor, continue)')
  .option('-f, --force', 'Overwrite existing configuration')
  .option('-p, --port <port>', 'Proxy port (default: 8080)')
  .option('-i, --install', 'Full install: add cert to system trust store and configure shell profile')
  .option('-a, --autostart', 'Configure proxy to start automatically on login')
  .action((tool, options) => {
    setupCommand(tool, { force: options.force, port: options.port, install: options.install, autostart: options.autostart });
  });

// Import old conversations from AI coding tools
program
  .command('import')
  .description('Import conversation history from AI coding tools (Claude, Aider, Continue.dev)')
  .option('-p, --project <path>', 'Project path (defaults to cwd)')
  .option('-s, --source <source>', 'Source to import: claude, aider, continue, all (default: all)')
  .option('-n, --dry-run', 'Show what would be imported without making changes')
  .option('-l, --limit <count>', 'Maximum extractions to import', '1000')
  .option('-f, --full', 'Store complete conversation content (for long-term memory)')
  .action((options) => {
    importCommand({
      project: options.project,
      source: options.source,
      dryRun: options.dryRun,
      limit: parseInt(options.limit, 10),
      full: options.full,
    });
  });

// Visualize codebase as interactive dashboard
program
  .command('visualize')
  .description('Generate an interactive visualization dashboard of the codebase')
  .option('-o, --output <path>', 'Output file path (default: ./aimem-dashboard.html)')
  .option('--open', 'Open dashboard in browser after generating')
  .option('-s, --serve', 'Start a local server instead of generating a static file')
  .option('-p, --port <port>', 'Server port when using --serve (default: 8080)')
  .action(async (options) => {
    await visualizeCommand({
      output: options.output,
      open: options.open,
      serve: options.serve,
      port: options.port ? parseInt(options.port, 10) : undefined,
    });
  });

// Git integration commands
program.addCommand(gitCommand);

// Guardrails (DIK) commands
program.addCommand(guardrailsCommand);

program.parse();
