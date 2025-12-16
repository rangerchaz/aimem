// Test helpers for aimem tests

import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SCHEMA } from '../src/db/schema.js';

export interface TestDb {
  db: Database.Database;
  path: string;
  cleanup: () => void;
}

/**
 * Create an isolated test database
 */
export function createTestDb(): TestDb {
  const testDir = join(tmpdir(), `aimem-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  const dbPath = join(testDir, 'test.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  return {
    db,
    path: dbPath,
    cleanup: () => {
      db.close();
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }
  };
}

/**
 * Create a project in the test database
 */
export function createTestProject(db: Database.Database, path: string, name: string) {
  const stmt = db.prepare('INSERT INTO projects (path, name) VALUES (?, ?) RETURNING *');
  return stmt.get(path, name) as { id: number; path: string; name: string; created_at: string };
}

/**
 * Create a file in the test database
 */
export function createTestFile(db: Database.Database, projectId: number, path: string, hash: string) {
  const stmt = db.prepare(`
    INSERT INTO files (project_id, path, hash, last_indexed)
    VALUES (?, ?, ?, datetime('now'))
    RETURNING *
  `);
  return stmt.get(projectId, path, hash) as { id: number; project_id: number; path: string; hash: string };
}

/**
 * Create a structure in the test database
 */
export function createTestStructure(
  db: Database.Database,
  fileId: number,
  type: string,
  name: string,
  lineStart: number,
  lineEnd: number,
  signature: string | null,
  rawContent: string
) {
  const stmt = db.prepare(`
    INSERT INTO structures (file_id, type, name, line_start, line_end, signature, raw_content, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
    RETURNING *
  `);
  return stmt.get(fileId, type, name, lineStart, lineEnd, signature, rawContent);
}

/**
 * Create a conversation in the test database
 */
export function createTestConversation(
  db: Database.Database,
  projectId: number | null,
  rawContent: string,
  summary: string | null = null
) {
  const stmt = db.prepare(`
    INSERT INTO conversations (project_id, raw_content, summary)
    VALUES (?, ?, ?)
    RETURNING *
  `);
  return stmt.get(projectId, rawContent, summary) as { id: number; project_id: number | null; raw_content: string };
}

/**
 * Create an extraction in the test database
 */
export function createTestExtraction(
  db: Database.Database,
  conversationId: number,
  type: string,
  content: string
) {
  const stmt = db.prepare(`
    INSERT INTO extractions (conversation_id, type, content, metadata)
    VALUES (?, ?, ?, '{}')
    RETURNING *
  `);
  return stmt.get(conversationId, type, content);
}

/**
 * Create a link in the test database
 */
export function createTestLink(
  db: Database.Database,
  sourceType: string,
  sourceId: number,
  targetType: string,
  targetId: number,
  linkType: string
) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO links (source_type, source_id, target_type, target_id, link_type)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(sourceType, sourceId, targetType, targetId, linkType);
}
