import chalk from 'chalk';
import { searchStructures, searchConversations, getLinksTo, getFile, findProjectForPath } from '../../db/index.js';
import type { Structure, Conversation } from '../../types/index.js';

interface QueryOptions {
  type?: 'all' | 'structures' | 'conversations';
  limit?: number;
  global?: boolean;
}

function formatStructure(s: Structure, fileCache: Map<number, string>): string {
  let filePath = fileCache.get(s.file_id);
  if (!filePath) {
    const file = getFile(s.file_id);
    filePath = file?.path || 'unknown';
    fileCache.set(s.file_id, filePath);
  }

  const location = `${filePath}:${s.line_start}`;
  const sig = s.signature || s.name;

  return `  ${chalk.cyan(s.type)} ${chalk.bold(s.name)}
    ${chalk.gray(location)}
    ${chalk.gray(sig)}`;
}

function formatConversation(c: Conversation): string {
  const date = new Date(c.timestamp).toLocaleDateString();
  const summary = c.summary || c.raw_content.slice(0, 100) + '...';
  const model = c.model || 'unknown';

  return `  ${chalk.yellow(`#${c.id}`)} ${chalk.gray(date)} ${chalk.gray(`[${model}]`)}
    ${summary}`;
}

export function queryCommand(searchQuery: string, options: QueryOptions): void {
  const type = options.type || 'all';
  const limit = options.limit || 10;

  // Auto-detect project from cwd unless --global flag is set
  let projectId: number | undefined;
  if (!options.global) {
    const project = findProjectForPath(process.cwd());
    if (project) {
      projectId = project.id;
      console.log(chalk.gray(`Searching in project: ${project.name}`));
      console.log(chalk.gray(`(use --global to search all projects)\n`));
    }
  }

  console.log(chalk.bold(`Searching for: "${searchQuery}"\n`));

  const fileCache = new Map<number, string>();
  let foundAny = false;

  // Search structures
  if (type === 'all' || type === 'structures') {
    try {
      const structures = searchStructures(searchQuery, limit, projectId);
      if (structures.length > 0) {
        foundAny = true;
        console.log(chalk.bold.blue(`Structures (${structures.length}):`));
        for (const s of structures) {
          console.log(formatStructure(s, fileCache));

          // Show related conversations
          const links = getLinksTo('structure', s.id);
          const decisions = links.filter(l => l.link_type === 'decision');
          if (decisions.length > 0) {
            console.log(chalk.gray(`    ${decisions.length} related decision(s)`));
          }
        }
        console.log();
      }
    } catch (err) {
      // FTS might not be ready
    }
  }

  // Search conversations
  if (type === 'all' || type === 'conversations') {
    try {
      const conversations = searchConversations(searchQuery, limit, projectId);
      if (conversations.length > 0) {
        foundAny = true;
        console.log(chalk.bold.yellow(`Conversations (${conversations.length}):`));
        for (const c of conversations) {
          console.log(formatConversation(c));
        }
        console.log();
      }
    } catch (err) {
      // FTS might not be ready
    }
  }

  if (!foundAny) {
    console.log(chalk.gray('No results found'));
  }
}
