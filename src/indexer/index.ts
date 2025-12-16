import { readFileSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { upsertFile, deleteFileStructures, insertStructure, getProjectFiles, deleteFile, getStructuresByName, createLink, getDb } from '../db/index.js';
import type { Parser, ParsedStructure } from './parsers/base.js';
import { javascriptParser } from './parsers/javascript.js';
import { pythonParser } from './parsers/python.js';
import { rubyParser } from './parsers/ruby.js';
import { goParser } from './parsers/go.js';

// Store pending calls to resolve after all structures are indexed
interface PendingCall {
  callerId: number;
  calledName: string;
}

// Register all parsers
const parsers: Parser[] = [
  javascriptParser,
  pythonParser,
  rubyParser,
  goParser,
];

// Build extension to parser map
const extensionMap = new Map<string, Parser>();
for (const parser of parsers) {
  for (const ext of parser.extensions) {
    extensionMap.set(ext, parser);
  }
}

// Files/directories to ignore
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

function getFileHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

function getParser(filePath: string): Parser | null {
  const ext = extname(filePath).toLowerCase();
  return extensionMap.get(ext) || null;
}

async function getProjectFilePaths(projectPath: string): Promise<string[]> {
  const extensions = Array.from(extensionMap.keys()).map(ext => ext.slice(1)); // Remove leading dot
  const pattern = `**/*.{${extensions.join(',')}}`;

  const files = await glob(pattern, {
    cwd: projectPath,
    ignore: IGNORE_PATTERNS,
    nodir: true,
    absolute: false,
  });

  return files;
}

export async function indexFile(
  projectId: number,
  projectPath: string,
  relativePath: string,
  pendingCalls?: PendingCall[]
): Promise<number> {
  const fullPath = join(projectPath, relativePath);
  const parser = getParser(fullPath);

  if (!parser) {
    return 0;
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const hash = getFileHash(content);

    // Upsert file record
    const file = upsertFile(projectId, relativePath, hash);

    // Clear existing structures for this file
    deleteFileStructures(file.id);

    // Parse and store structures
    const structures = parser.parse(content, relativePath);

    for (const s of structures) {
      const inserted = insertStructure(
        file.id,
        s.type,
        s.name,
        s.lineStart,
        s.lineEnd,
        s.signature,
        s.rawContent,
        s.metadata
      );

      // Collect pending calls to resolve later
      if (pendingCalls && s.calls && s.calls.length > 0) {
        for (const calledName of s.calls) {
          pendingCalls.push({
            callerId: inserted.id,
            calledName,
          });
        }
      }
    }

    return structures.length;
  } catch (err) {
    // File might have been deleted or unreadable
    console.error(`Error indexing ${relativePath}:`, err);
    return 0;
  }
}

export async function indexProject(projectId: number, projectPath: string): Promise<{ files: number; structures: number; links: number }> {
  const filePaths = await getProjectFilePaths(projectPath);
  const pendingCalls: PendingCall[] = [];

  let totalStructures = 0;
  let indexedFiles = 0;

  // Clear existing call links for this project before re-indexing
  const db = getDb();
  db.prepare(`
    DELETE FROM links WHERE link_type IN ('calls', 'called_by')
    AND source_type = 'structure'
    AND source_id IN (
      SELECT s.id FROM structures s
      JOIN files f ON s.file_id = f.id
      WHERE f.project_id = ?
    )
  `).run(projectId);

  for (const relativePath of filePaths) {
    const count = await indexFile(projectId, projectPath, relativePath, pendingCalls);
    if (count > 0) {
      indexedFiles++;
      totalStructures += count;
    }
  }

  // Clean up files that no longer exist
  const existingFiles = getProjectFiles(projectId);
  const currentPaths = new Set(filePaths);

  for (const file of existingFiles) {
    if (!currentPaths.has(file.path)) {
      deleteFile(file.id);
    }
  }

  // Resolve pending calls and create links
  let linksCreated = 0;
  for (const pending of pendingCalls) {
    const targets = getStructuresByName(pending.calledName, projectId);
    if (targets.length > 0) {
      // Link to the first match (could be improved with scope analysis)
      const target = targets[0];
      if (target.id !== pending.callerId) { // Don't link to self
        createLink('structure', pending.callerId, 'structure', target.id, 'calls');
        linksCreated++;
      }
    }
  }

  console.log(`  Indexed ${indexedFiles} files, ${totalStructures} structures, ${linksCreated} call links`);
  return { files: indexedFiles, structures: totalStructures, links: linksCreated };
}

export function getSupportedExtensions(): string[] {
  return Array.from(extensionMap.keys());
}
