/**
 * Import command: Import old conversations from various AI coding tools
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import {
  getDb,
  getProjectByPath,
  ensureDataDir,
} from '../../db/index.js';

// Decision extraction patterns (same as proxy)
const DECISION_PATTERNS = [
  /(?:we should|let's|I'll|I will|going to|decided to|will use|using|chose|choosing|the best approach is|recommend using)\s+(.+?)(?:\.|$)/gi,
  /(?:the approach|the solution|the fix|the implementation|the strategy)\s+(?:is|will be|should be)\s+(.+?)(?:\.|$)/gi,
  /(?:because|since|the reason is|this is because)\s+(.+?)(?:\.|$)/gi,
  /(?:I've implemented|I've added|I've created|I've updated)\s+(.+?)(?:\.|$)/gi,
];

const REJECTION_PATTERNS = [
  /(?:instead of|rather than|not using|won't use|shouldn't use|avoid using|don't use)\s+(.+?)(?:\.|$)/gi,
  /(?:rejected|ruled out|decided against|not recommended|wouldn't work)\s+(.+?)(?:\.|$)/gi,
  /(?:the problem with|the issue with|doesn't work because)\s+(.+?)(?:\.|$)/gi,
];

type ImportSource = 'claude' | 'aider' | 'continue' | 'all';

interface ImportOptions {
  project?: string;
  source?: ImportSource;
  dryRun?: boolean;
  limit?: number;
  full?: boolean;  // Store complete conversation content, not just extractions
}

interface ImportResult {
  source: string;
  messages: number;
  extractions: number;
  duplicates: number;
}

interface ClaudeMessage {
  type: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; thinking?: string }> | string;
  };
  cwd?: string;
  timestamp?: string;
  sessionId?: string;
}

// ============================================================================
// Shared utilities
// ============================================================================

function getSentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index) + 1, text.lastIndexOf('\n', index) + 1);
  let endDot = text.indexOf('.', index);
  let endNewline = text.indexOf('\n', index);
  let end = text.length;
  if (endDot !== -1) end = Math.min(end, endDot + 1);
  if (endNewline !== -1) end = Math.min(end, endNewline);
  return text.slice(start, end).trim();
}

function isValidExtraction(sentence: string): boolean {
  if (sentence.length < 30 || sentence.length > 500) return false;
  if ((sentence.match(/{/g) || []).length + (sentence.match(/}/g) || []).length > 3) return false;
  if (sentence.includes('```')) return false;
  return true;
}

function extractDecisions(content: string): Array<{ type: string; content: string }> {
  const extractions: Array<{ type: string; content: string }> = [];
  const seen = new Set<string>();

  for (const pattern of DECISION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const sentence = getSentenceAround(content, match.index);
      if (isValidExtraction(sentence)) {
        const key = sentence.slice(0, 80).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          extractions.push({ type: 'decision', content: sentence });
        }
      }
    }
  }

  for (const pattern of REJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const sentence = getSentenceAround(content, match.index);
      if (isValidExtraction(sentence)) {
        const key = sentence.slice(0, 80).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          extractions.push({ type: 'rejection', content: sentence });
        }
      }
    }
  }

  return extractions;
}

// ============================================================================
// Claude Code import
// ============================================================================

function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

function encodeProjectPath(projectPath: string): string {
  return '-' + projectPath.replace(/\//g, '-').replace(/^-/, '');
}

function findClaudeProject(projectPath: string): string | null {
  const claudeProjectsDir = getClaudeProjectsDir();
  if (!existsSync(claudeProjectsDir)) return null;

  const encoded = encodeProjectPath(projectPath);
  const fullPath = join(claudeProjectsDir, encoded);

  if (existsSync(fullPath)) {
    return fullPath;
  }

  const dirs = readdirSync(claudeProjectsDir);
  for (const dir of dirs) {
    if (dir.includes(basename(projectPath))) {
      return join(claudeProjectsDir, dir);
    }
  }

  return null;
}

function extractClaudeAssistantText(message: ClaudeMessage): string {
  if (!message.message || message.message.role !== 'assistant') {
    return '';
  }

  const content = message.message.content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n');
  }

  return '';
}

function parseClaudeConversationFile(filePath: string): ClaudeMessage[] {
  const content = readFileSync(filePath, 'utf-8');
  const messages: ClaudeMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ClaudeMessage;
      if (parsed.type === 'assistant') {
        messages.push(parsed);
      }
    } catch {
      // Skip invalid lines
    }
  }

  return messages;
}

async function importFromClaude(
  projectPath: string,
  projectId: number,
  existingExtractions: Set<string>,
  dryRun: boolean,
  limit: number,
  full: boolean = false
): Promise<ImportResult | null> {
  const claudeProjectDir = findClaudeProject(projectPath);
  if (!claudeProjectDir) {
    return null;
  }

  console.log(chalk.bold('\n📁 Claude Code'));
  console.log(`   ${chalk.gray(claudeProjectDir)}`);

  const db = getDb();
  const files = readdirSync(claudeProjectDir)
    .filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))
    .map((f) => join(claudeProjectDir, f));

  if (files.length === 0) {
    console.log(chalk.gray('   No conversation files found'));
    return null;
  }

  console.log(`   Found ${files.length} conversation files`);

  let totalMessages = 0;
  let totalExtractions = 0;
  let skippedDuplicates = 0;

  for (const file of files) {
    const fileName = basename(file);
    const messages = parseClaudeConversationFile(file);

    if (messages.length === 0) continue;

    for (const msg of messages) {
      if (totalExtractions >= limit) break;

      const text = extractClaudeAssistantText(msg);
      if (!text || text.length < 100) continue;

      totalMessages++;
      const extractions = extractDecisions(text);

      const newExtractions = extractions.filter((e) => {
        const key = e.content.slice(0, 80).toLowerCase();
        if (existingExtractions.has(key)) {
          skippedDuplicates++;
          return false;
        }
        existingExtractions.add(key);
        return true;
      });

      if (newExtractions.length === 0) continue;

      if (dryRun) {
        if (full) {
          console.log(chalk.gray(`   [full] ${text.slice(0, 80)}...`));
        }
        for (const ext of newExtractions) {
          console.log(chalk.gray(`   [${ext.type}] ${ext.content.slice(0, 50)}...`));
          totalExtractions++;
        }
      } else {
        const timestamp = msg.timestamp || new Date().toISOString();
        // Store full content if --full flag is set, otherwise just metadata
        const rawContent = full ? text : JSON.stringify({ imported: true, source: fileName });
        const result = db.prepare(`
          INSERT INTO conversations (project_id, model, tool, raw_content, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `).run(projectId, 'imported', 'claude-code', rawContent, timestamp);

        const conversationId = result.lastInsertRowid;

        for (const ext of newExtractions) {
          db.prepare(`
            INSERT INTO extractions (conversation_id, type, content, metadata)
            VALUES (?, ?, ?, ?)
          `).run(conversationId, ext.type, ext.content, JSON.stringify({ imported: true, source: 'claude' }));
          totalExtractions++;
        }
      }
    }

    if (totalExtractions >= limit) break;
  }

  return { source: 'claude', messages: totalMessages, extractions: totalExtractions, duplicates: skippedDuplicates };
}

// ============================================================================
// Aider import
// ============================================================================

function findAiderHistoryFiles(projectPath: string): string[] {
  const files: string[] = [];

  // Check for .aider.chat.history.md in project root
  const historyFile = join(projectPath, '.aider.chat.history.md');
  if (existsSync(historyFile)) {
    files.push(historyFile);
  }

  // Also check for .aider.input.history and .aider.tags.cache.v3 patterns
  try {
    const projectFiles = readdirSync(projectPath);
    for (const f of projectFiles) {
      if (f.startsWith('.aider') && f.includes('history') && f.endsWith('.md')) {
        const fullPath = join(projectPath, f);
        if (!files.includes(fullPath)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return files;
}

function parseAiderHistory(content: string): string[] {
  // Aider format:
  // #### /ask or #### user message
  // User content
  //
  // #### assistant or #### Claude response
  // Assistant content

  const assistantBlocks: string[] = [];
  const lines = content.split('\n');
  let inAssistantBlock = false;
  let currentBlock = '';

  for (const line of lines) {
    // Check for block headers
    if (line.startsWith('#### ')) {
      // Save previous assistant block
      if (inAssistantBlock && currentBlock.trim()) {
        assistantBlocks.push(currentBlock.trim());
      }
      currentBlock = '';

      // Check if this is an assistant block
      const header = line.slice(5).toLowerCase();
      inAssistantBlock = !header.startsWith('/') &&
                         !header.includes('user') &&
                         !header.includes('human') &&
                         (header.includes('assistant') ||
                          header.includes('claude') ||
                          header.includes('gpt') ||
                          header.includes('aider') ||
                          header === '');
    } else if (inAssistantBlock) {
      currentBlock += line + '\n';
    }
  }

  // Don't forget the last block
  if (inAssistantBlock && currentBlock.trim()) {
    assistantBlocks.push(currentBlock.trim());
  }

  return assistantBlocks;
}

async function importFromAider(
  projectPath: string,
  projectId: number,
  existingExtractions: Set<string>,
  dryRun: boolean,
  limit: number,
  full: boolean = false
): Promise<ImportResult | null> {
  const historyFiles = findAiderHistoryFiles(projectPath);

  if (historyFiles.length === 0) {
    return null;
  }

  console.log(chalk.bold('\n📁 Aider'));
  console.log(`   Found ${historyFiles.length} history file(s)`);

  const db = getDb();
  let totalMessages = 0;
  let totalExtractions = 0;
  let skippedDuplicates = 0;

  for (const file of historyFiles) {
    const fileName = basename(file);
    console.log(`   ${chalk.gray(fileName)}`);

    const content = readFileSync(file, 'utf-8');
    const assistantBlocks = parseAiderHistory(content);

    if (assistantBlocks.length === 0) {
      console.log(chalk.gray('   No assistant messages found'));
      continue;
    }

    console.log(`   ${assistantBlocks.length} assistant messages`);

    for (const block of assistantBlocks) {
      if (totalExtractions >= limit) break;
      if (block.length < 100) continue;

      totalMessages++;
      const extractions = extractDecisions(block);

      const newExtractions = extractions.filter((e) => {
        const key = e.content.slice(0, 80).toLowerCase();
        if (existingExtractions.has(key)) {
          skippedDuplicates++;
          return false;
        }
        existingExtractions.add(key);
        return true;
      });

      if (newExtractions.length === 0) continue;

      if (dryRun) {
        if (full) {
          console.log(chalk.gray(`   [full] ${block.slice(0, 80)}...`));
        }
        for (const ext of newExtractions) {
          console.log(chalk.gray(`   [${ext.type}] ${ext.content.slice(0, 50)}...`));
          totalExtractions++;
        }
      } else {
        // Store full content if --full flag is set, otherwise just metadata
        const rawContent = full ? block : JSON.stringify({ imported: true, source: fileName });
        const result = db.prepare(`
          INSERT INTO conversations (project_id, model, tool, raw_content, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `).run(projectId, 'imported', 'aider', rawContent, new Date().toISOString());

        const conversationId = result.lastInsertRowid;

        for (const ext of newExtractions) {
          db.prepare(`
            INSERT INTO extractions (conversation_id, type, content, metadata)
            VALUES (?, ?, ?, ?)
          `).run(conversationId, ext.type, ext.content, JSON.stringify({ imported: true, source: 'aider' }));
          totalExtractions++;
        }
      }
    }

    if (totalExtractions >= limit) break;
  }

  return { source: 'aider', messages: totalMessages, extractions: totalExtractions, duplicates: skippedDuplicates };
}

// ============================================================================
// Continue.dev import
// ============================================================================

function getContinueSessionsDir(): string {
  return join(homedir(), '.continue', 'sessions');
}

interface ContinueSession {
  history?: Array<{
    role: string;
    content: string;
  }>;
}

async function importFromContinue(
  projectPath: string,
  projectId: number,
  existingExtractions: Set<string>,
  dryRun: boolean,
  limit: number,
  full: boolean = false
): Promise<ImportResult | null> {
  const sessionsDir = getContinueSessionsDir();

  if (!existsSync(sessionsDir)) {
    return null;
  }

  console.log(chalk.bold('\n📁 Continue.dev'));
  console.log(`   ${chalk.gray(sessionsDir)}`);

  const db = getDb();
  let totalMessages = 0;
  let totalExtractions = 0;
  let skippedDuplicates = 0;

  try {
    const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));

    if (files.length === 0) {
      console.log(chalk.gray('   No session files found'));
      return null;
    }

    console.log(`   Found ${files.length} session files`);

    for (const file of files) {
      if (totalExtractions >= limit) break;

      try {
        const content = readFileSync(join(sessionsDir, file), 'utf-8');
        const session = JSON.parse(content) as ContinueSession;

        if (!session.history || !Array.isArray(session.history)) continue;

        const assistantMessages = session.history.filter((m) => m.role === 'assistant' && m.content);

        for (const msg of assistantMessages) {
          if (totalExtractions >= limit) break;
          if (msg.content.length < 100) continue;

          totalMessages++;
          const extractions = extractDecisions(msg.content);

          const newExtractions = extractions.filter((e) => {
            const key = e.content.slice(0, 80).toLowerCase();
            if (existingExtractions.has(key)) {
              skippedDuplicates++;
              return false;
            }
            existingExtractions.add(key);
            return true;
          });

          if (newExtractions.length === 0) continue;

          if (dryRun) {
            if (full) {
              console.log(chalk.gray(`   [full] ${msg.content.slice(0, 80)}...`));
            }
            for (const ext of newExtractions) {
              console.log(chalk.gray(`   [${ext.type}] ${ext.content.slice(0, 50)}...`));
              totalExtractions++;
            }
          } else {
            // Store full content if --full flag is set, otherwise just metadata
            const rawContent = full ? msg.content : JSON.stringify({ imported: true, source: file });
            const result = db.prepare(`
              INSERT INTO conversations (project_id, model, tool, raw_content, timestamp)
              VALUES (?, ?, ?, ?, ?)
            `).run(projectId, 'imported', 'continue', rawContent, new Date().toISOString());

            const conversationId = result.lastInsertRowid;

            for (const ext of newExtractions) {
              db.prepare(`
                INSERT INTO extractions (conversation_id, type, content, metadata)
                VALUES (?, ?, ?, ?)
              `).run(conversationId, ext.type, ext.content, JSON.stringify({ imported: true, source: 'continue' }));
              totalExtractions++;
            }
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    return null;
  }

  if (totalMessages === 0) {
    return null;
  }

  return { source: 'continue', messages: totalMessages, extractions: totalExtractions, duplicates: skippedDuplicates };
}

// ============================================================================
// Main import command
// ============================================================================

export async function importCommand(options: ImportOptions): Promise<void> {
  ensureDataDir();
  const db = getDb();

  const projectPath = options.project || process.cwd();
  const source = options.source || 'all';
  const dryRun = options.dryRun || false;
  const limit = options.limit || 1000;
  const full = options.full || false;

  console.log(chalk.bold('Importing conversation history...\n'));

  // Find the aimem project
  const aimemProject = getProjectByPath(projectPath);
  if (!aimemProject) {
    console.log(chalk.red(`Project not indexed: ${projectPath}`));
    console.log(chalk.yellow('Run `aimem init` first to index this project.'));
    process.exit(1);
  }

  console.log(`Project: ${chalk.cyan(aimemProject.path)}`);
  console.log(`Source:  ${chalk.cyan(source)}`);
  if (dryRun) console.log(chalk.yellow('Mode:    dry-run'));
  if (full) console.log(chalk.green('Mode:    full (storing complete conversation content)'));

  // Load existing extractions to avoid duplicates
  const existingExtractions = new Set<string>();
  const existingRows = db.prepare(`
    SELECT e.content FROM extractions e
    JOIN conversations c ON e.conversation_id = c.id
    WHERE c.project_id = ?
  `).all(aimemProject.id) as Array<{ content: string }>;

  for (const row of existingRows) {
    existingExtractions.add(row.content.slice(0, 80).toLowerCase());
  }

  console.log(`Existing extractions: ${existingExtractions.size}`);

  const results: ImportResult[] = [];

  // Import from selected sources
  if (source === 'all' || source === 'claude') {
    const result = await importFromClaude(projectPath, aimemProject.id, existingExtractions, dryRun, limit, full);
    if (result) results.push(result);
  }

  if (source === 'all' || source === 'aider') {
    const result = await importFromAider(projectPath, aimemProject.id, existingExtractions, dryRun, limit, full);
    if (result) results.push(result);
  }

  if (source === 'all' || source === 'continue') {
    const result = await importFromContinue(projectPath, aimemProject.id, existingExtractions, dryRun, limit, full);
    if (result) results.push(result);
  }

  // Summary
  console.log(chalk.bold('\n━━━ Summary ━━━'));

  if (results.length === 0) {
    console.log(chalk.yellow('No conversation history found for any source.'));
    console.log(chalk.gray('\nSupported sources:'));
    console.log(chalk.gray('  - Claude Code: ~/.claude/projects/'));
    console.log(chalk.gray('  - Aider: .aider.chat.history.md in project'));
    console.log(chalk.gray('  - Continue.dev: ~/.continue/sessions/'));
    return;
  }

  let totalMessages = 0;
  let totalExtractions = 0;
  let totalDuplicates = 0;

  for (const r of results) {
    console.log(`\n${chalk.cyan(r.source)}:`);
    console.log(`  Messages:    ${r.messages}`);
    console.log(`  Extractions: ${chalk.green(r.extractions)}`);
    console.log(`  Duplicates:  ${r.duplicates}`);
    totalMessages += r.messages;
    totalExtractions += r.extractions;
    totalDuplicates += r.duplicates;
  }

  console.log(chalk.bold('\n━━━ Total ━━━'));
  console.log(`Messages:    ${totalMessages}`);
  console.log(`Extractions: ${chalk.green(totalExtractions)}`);
  console.log(`Duplicates:  ${totalDuplicates}`);

  if (dryRun) {
    console.log(chalk.yellow('\nDry run - no changes made. Remove --dry-run to import.'));
  } else if (totalExtractions > 0) {
    console.log(chalk.green('\nImport complete!'));
    console.log(chalk.gray('Query with: aimem_decisions <topic>'));
  }
}
