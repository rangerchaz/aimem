import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { SCHEMA, MIGRATIONS, COMMIT_LINKS_SCHEMA } from './schema.js';
function resolveDataDir() {
    return process.env.AIMEM_DATA_DIR || join(homedir(), '.aimem');
}
let db = null;
export function getDataDir() {
    return resolveDataDir();
}
export function ensureDataDir() {
    const dataDir = resolveDataDir();
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }
}
function applyMigrations(database) {
    // Apply each migration, ignoring errors for already-applied ones
    for (const migration of MIGRATIONS) {
        try {
            database.exec(migration);
        }
        catch {
            // Column already exists or other expected error
        }
    }
    // Apply commit_links schema
    database.exec(COMMIT_LINKS_SCHEMA);
}
export function getDb() {
    if (!db) {
        ensureDataDir();
        const dbPath = join(resolveDataDir(), 'aimem.db');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        db.pragma('foreign_keys = ON');
        db.exec(SCHEMA);
        applyMigrations(db);
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
// Get recent conversations (optionally scoped to project)
export function getRecentConversations(limit = 10, projectId) {
    const db = getDb();
    if (projectId) {
        return db.prepare(`
      SELECT * FROM conversations
      WHERE project_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(projectId, limit);
    }
    return db.prepare(`
    SELECT * FROM conversations
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);
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
// Get all structures for a project with file paths
export function getAllProjectStructures(projectId) {
    const db = getDb();
    return db.prepare(`
    SELECT s.*, f.path as file_path
    FROM structures s
    JOIN files f ON s.file_id = f.id
    WHERE f.project_id = ?
    ORDER BY f.path, s.line_start
  `).all(projectId);
}
// Get all links for a project
export function getAllProjectLinks(projectId) {
    const db = getDb();
    return db.prepare(`
    SELECT DISTINCT l.* FROM links l
    LEFT JOIN structures s ON l.source_type = 'structure' AND l.source_id = s.id
    LEFT JOIN files f ON s.file_id = f.id
    LEFT JOIN conversations c ON l.source_type = 'conversation' AND l.source_id = c.id
    WHERE f.project_id = ? OR c.project_id = ?
  `).all(projectId, projectId);
}
// Get all extractions for a project
export function getAllProjectExtractions(projectId) {
    const db = getDb();
    return db.prepare(`
    SELECT e.* FROM extractions e
    JOIN conversations c ON e.conversation_id = c.id
    WHERE c.project_id = ?
    ORDER BY c.timestamp DESC
  `).all(projectId);
}
// ============ Git Operations ============
// Commit operations
export function upsertCommit(projectId, hash, shortHash, authorName, authorEmail, timestamp, subject, body, parentHashes = []) {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO commits (project_id, hash, short_hash, author_name, author_email, timestamp, subject, body, parent_hashes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, hash) DO UPDATE SET
      short_hash = excluded.short_hash,
      author_name = excluded.author_name,
      author_email = excluded.author_email,
      subject = excluded.subject,
      body = excluded.body,
      parent_hashes = excluded.parent_hashes
    RETURNING *
  `);
    return stmt.get(projectId, hash, shortHash, authorName, authorEmail, timestamp, subject, body, JSON.stringify(parentHashes));
}
export function getCommitByHash(projectId, hash) {
    const db = getDb();
    return db.prepare('SELECT * FROM commits WHERE project_id = ? AND hash = ?').get(projectId, hash);
}
export function getCommitById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM commits WHERE id = ?').get(id);
}
export function searchCommits(query, limit = 20, projectId) {
    const db = getDb();
    if (projectId) {
        return db.prepare(`
      SELECT c.* FROM commits c
      JOIN commits_fts fts ON c.id = fts.rowid
      WHERE commits_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit);
    }
    return db.prepare(`
    SELECT c.* FROM commits c
    JOIN commits_fts fts ON c.id = fts.rowid
    WHERE commits_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);
}
export function getRecentCommits(projectId, limit = 50) {
    const db = getDb();
    return db.prepare(`
    SELECT * FROM commits WHERE project_id = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(projectId, limit);
}
// Commit link operations
export function createCommitLink(commitId, targetType, targetId, linkType) {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT OR IGNORE INTO commit_links (commit_id, target_type, target_id, link_type)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `);
    return stmt.get(commitId, targetType, targetId, linkType);
}
export function getCommitLinks(commitId) {
    const db = getDb();
    return db.prepare('SELECT * FROM commit_links WHERE commit_id = ?').all(commitId);
}
export function getLinksToCommit(targetType, targetId) {
    const db = getDb();
    return db.prepare('SELECT * FROM commit_links WHERE target_type = ? AND target_id = ?').all(targetType, targetId);
}
export function getCommitsForStructure(structureId) {
    const db = getDb();
    return db.prepare(`
    SELECT c.* FROM commits c
    JOIN commit_links cl ON c.id = cl.commit_id
    WHERE cl.target_type = 'structure' AND cl.target_id = ?
    ORDER BY c.timestamp DESC
  `).all(structureId);
}
export function getCommitsForExtraction(extractionId) {
    const db = getDb();
    return db.prepare(`
    SELECT c.* FROM commits c
    JOIN commit_links cl ON c.id = cl.commit_id
    WHERE cl.target_type = 'extraction' AND cl.target_id = ?
    ORDER BY c.timestamp DESC
  `).all(extractionId);
}
// Update structure authorship
export function updateStructureAuthorship(structureId, author, authorEmail, commitHash) {
    const db = getDb();
    db.prepare(`
    UPDATE structures SET
      last_author = ?,
      last_author_email = ?,
      last_commit_hash = ?
    WHERE id = ?
  `).run(author, authorEmail, commitHash, structureId);
}
// Get uncommitted decisions (extractions created since last commit)
export function getUncommittedExtractions(projectId, sinceCommitHash) {
    const db = getDb();
    if (sinceCommitHash) {
        // Get extractions created after the specified commit's timestamp
        return db.prepare(`
      SELECT e.* FROM extractions e
      JOIN conversations c ON e.conversation_id = c.id
      WHERE c.project_id = ?
        AND c.timestamp > (
          SELECT timestamp FROM commits WHERE project_id = ? AND hash = ?
        )
        AND e.id NOT IN (
          SELECT target_id FROM commit_links WHERE target_type = 'extraction'
        )
      ORDER BY c.timestamp DESC
    `).all(projectId, projectId, sinceCommitHash);
    }
    // Get all extractions not linked to any commit
    return db.prepare(`
    SELECT e.* FROM extractions e
    JOIN conversations c ON e.conversation_id = c.id
    WHERE c.project_id = ?
      AND e.id NOT IN (
        SELECT target_id FROM commit_links WHERE target_type = 'extraction'
      )
    ORDER BY c.timestamp DESC
  `).all(projectId);
}
//# sourceMappingURL=index.js.map