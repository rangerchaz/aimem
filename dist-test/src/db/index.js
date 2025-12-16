import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { SCHEMA } from './schema.js';
const DATA_DIR = join(homedir(), '.aimem');
const DB_PATH = join(DATA_DIR, 'aimem.db');
let db = null;
export function getDataDir() {
    return DATA_DIR;
}
export function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}
export function getDb() {
    if (!db) {
        ensureDataDir();
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.exec(SCHEMA);
    }
    return db;
}
export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
// Project operations
export function createProject(path, name) {
    const db = getDb();
    const stmt = db.prepare('INSERT INTO projects (path, name) VALUES (?, ?) RETURNING *');
    return stmt.get(path, name);
}
export function getProject(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}
export function getProjectByPath(path) {
    const db = getDb();
    return db.prepare('SELECT * FROM projects WHERE path = ?').get(path);
}
export function getAllProjects() {
    const db = getDb();
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
}
// File operations
export function upsertFile(projectId, path, hash) {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO files (project_id, path, hash, last_indexed)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, path) DO UPDATE SET
      hash = excluded.hash,
      last_indexed = datetime('now')
    RETURNING *
  `);
    return stmt.get(projectId, path, hash);
}
export function getFile(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
}
export function getFileByPath(projectId, path) {
    const db = getDb();
    return db.prepare('SELECT * FROM files WHERE project_id = ? AND path = ?').get(projectId, path);
}
export function deleteFile(id) {
    const db = getDb();
    db.prepare('DELETE FROM files WHERE id = ?').run(id);
}
export function getProjectFiles(projectId) {
    const db = getDb();
    return db.prepare('SELECT * FROM files WHERE project_id = ?').all(projectId);
}
// Structure operations
export function insertStructure(fileId, type, name, lineStart, lineEnd, signature, rawContent, metadata = {}) {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO structures (file_id, type, name, line_start, line_end, signature, raw_content, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
    return stmt.get(fileId, type, name, lineStart, lineEnd, signature, rawContent, JSON.stringify(metadata));
}
export function deleteFileStructures(fileId) {
    const db = getDb();
    db.prepare('DELETE FROM structures WHERE file_id = ?').run(fileId);
}
export function searchStructures(query, limit = 20, projectId) {
    const db = getDb();
    if (projectId) {
        return db.prepare(`
      SELECT s.* FROM structures s
      JOIN structures_fts fts ON s.id = fts.rowid
      JOIN files f ON s.file_id = f.id
      WHERE structures_fts MATCH ? AND f.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit);
    }
    return db.prepare(`
    SELECT s.* FROM structures s
    JOIN structures_fts fts ON s.id = fts.rowid
    WHERE structures_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);
}
export function getStructuresByName(name, projectId) {
    const db = getDb();
    if (projectId) {
        return db.prepare(`
      SELECT s.* FROM structures s
      JOIN files f ON s.file_id = f.id
      WHERE s.name = ? AND f.project_id = ?
    `).all(name, projectId);
    }
    return db.prepare('SELECT * FROM structures WHERE name = ?').all(name);
}
// Find project by checking if cwd is inside any project path
export function findProjectForPath(targetPath) {
    const projects = getAllProjects();
    // Sort by path length descending to find most specific match
    projects.sort((a, b) => b.path.length - a.path.length);
    for (const project of projects) {
        if (targetPath.startsWith(project.path)) {
            return project;
        }
    }
    return undefined;
}
// Conversation operations
export function insertConversation(rawContent, projectId = null, model = null, tool = null, summary = null) {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO conversations (project_id, model, tool, summary, raw_content)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `);
    return stmt.get(projectId, model, tool, summary, rawContent);
}
export function searchConversations(query, limit = 20, projectId) {
    const db = getDb();
    if (projectId) {
        return db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversations_fts fts ON c.id = fts.rowid
      WHERE conversations_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit);
    }
    return db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversations_fts fts ON c.id = fts.rowid
    WHERE conversations_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);
}
// Link operations
export function createLink(sourceType, sourceId, targetType, targetId, linkType) {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT OR IGNORE INTO links (source_type, source_id, target_type, target_id, link_type)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `);
    return stmt.get(sourceType, sourceId, targetType, targetId, linkType);
}
export function getLinksFrom(sourceType, sourceId) {
    const db = getDb();
    return db.prepare('SELECT * FROM links WHERE source_type = ? AND source_id = ?').all(sourceType, sourceId);
}
export function getLinksTo(targetType, targetId) {
    const db = getDb();
    return db.prepare('SELECT * FROM links WHERE target_type = ? AND target_id = ?').all(targetType, targetId);
}
// Extraction operations
export function insertExtraction(conversationId, type, content, metadata = {}) {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO extractions (conversation_id, type, content, metadata)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `);
    return stmt.get(conversationId, type, content, JSON.stringify(metadata));
}
export function getConversationExtractions(conversationId) {
    const db = getDb();
    return db.prepare('SELECT * FROM extractions WHERE conversation_id = ?').all(conversationId);
}
export function getExtraction(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM extractions WHERE id = ?').get(id);
}
export function searchExtractions(query, limit = 20, projectId) {
    const db = getDb();
    const searchTerm = `%${query}%`;
    if (projectId) {
        return db.prepare(`
      SELECT e.* FROM extractions e
      JOIN conversations c ON e.conversation_id = c.id
      WHERE e.content LIKE ? AND c.project_id = ?
      ORDER BY e.id DESC
      LIMIT ?
    `).all(searchTerm, projectId, limit);
    }
    return db.prepare(`
    SELECT * FROM extractions
    WHERE content LIKE ?
    ORDER BY id DESC
    LIMIT ?
  `).all(searchTerm, limit);
}
export function isDuplicateExtraction(content, projectId, windowSeconds = 300) {
    const db = getDb();
    // Check for duplicate extraction content within the last N seconds
    const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM extractions e
    JOIN conversations c ON e.conversation_id = c.id
    WHERE e.content = ?
    AND (c.project_id = ? OR (c.project_id IS NULL AND ? IS NULL))
    AND datetime(c.timestamp) > datetime('now', '-' || ? || ' seconds')
  `);
    const result = stmt.get(content.trim(), projectId, projectId, windowSeconds);
    return result.count > 0;
}
// Stats
export function getStats() {
    const db = getDb();
    const projects = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
    const files = db.prepare('SELECT COUNT(*) as count FROM files').get().count;
    const structures = db.prepare('SELECT COUNT(*) as count FROM structures').get().count;
    const conversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const links = db.prepare('SELECT COUNT(*) as count FROM links').get().count;
    return { projects, files, structures, conversations, links };
}
// Check if entity exists (for hallucination checking)
export function structureExists(name) {
    const db = getDb();
    const result = db.prepare('SELECT 1 FROM structures WHERE name = ? LIMIT 1').get(name);
    return result !== undefined;
}
export function fileExists(path) {
    const db = getDb();
    const result = db.prepare('SELECT 1 FROM files WHERE path = ? LIMIT 1').get(path);
    return result !== undefined;
}
// Get a conversation by ID with full content
export function getConversationById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}
// Get full conversations for a project (for long-term memory)
export function getFullConversations(projectId, limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
    SELECT * FROM conversations
    WHERE project_id = ?
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(projectId, limit, offset);
}
// Search conversations and return full content
export function searchFullConversations(query, limit = 20, projectId) {
    const db = getDb();
    if (projectId) {
        return db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversations_fts fts ON c.id = fts.rowid
      WHERE conversations_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit);
    }
    return db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversations_fts fts ON c.id = fts.rowid
    WHERE conversations_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);
}
//# sourceMappingURL=index.js.map