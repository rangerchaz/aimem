// Test helpers for aimem tests
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SCHEMA } from '../src/db/schema.js';
/**
 * Create an isolated test database
 */
export function createTestDb() {
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
export function createTestProject(db, path, name) {
    const stmt = db.prepare('INSERT INTO projects (path, name) VALUES (?, ?) RETURNING *');
    return stmt.get(path, name);
}
/**
 * Create a file in the test database
 */
export function createTestFile(db, projectId, path, hash) {
    const stmt = db.prepare(`
    INSERT INTO files (project_id, path, hash, last_indexed)
    VALUES (?, ?, ?, datetime('now'))
    RETURNING *
  `);
    return stmt.get(projectId, path, hash);
}
/**
 * Create a structure in the test database
 */
export function createTestStructure(db, fileId, type, name, lineStart, lineEnd, signature, rawContent) {
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
export function createTestConversation(db, projectId, rawContent, summary = null) {
    const stmt = db.prepare(`
    INSERT INTO conversations (project_id, raw_content, summary)
    VALUES (?, ?, ?)
    RETURNING *
  `);
    return stmt.get(projectId, rawContent, summary);
}
/**
 * Create an extraction in the test database
 */
export function createTestExtraction(db, conversationId, type, content) {
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
export function createTestLink(db, sourceType, sourceId, targetType, targetId, linkType) {
    const stmt = db.prepare(`
    INSERT OR IGNORE INTO links (source_type, source_id, target_type, target_id, link_type)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `);
    return stmt.get(sourceType, sourceId, targetType, targetId, linkType);
}
//# sourceMappingURL=helpers.js.map