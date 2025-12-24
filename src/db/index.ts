import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { SCHEMA, MIGRATIONS, COMMIT_LINKS_SCHEMA } from './schema.js';
import type { Project, File, Structure, Conversation, Link, Extraction, IndexStats, Commit, CommitLink } from '../types/index.js';

function resolveDataDir(): string {
  return process.env.AIMEM_DATA_DIR || join(homedir(), '.aimem');
}

let db: Database.Database | null = null;

export function getDataDir(): string {
  return resolveDataDir();
}

export function ensureDataDir(): void {
  const dataDir = resolveDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function applyMigrations(database: Database.Database): void {
  // Apply each migration, ignoring errors for already-applied ones
  for (const migration of MIGRATIONS) {
    try {
      database.exec(migration);
    } catch {
      // Column already exists or other expected error
    }
  }
  // Apply commit_links schema
  database.exec(COMMIT_LINKS_SCHEMA);
}

export function getDb(): Database.Database {
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

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Project operations
export function createProject(path: string, name: string): Project {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO projects (path, name) VALUES (?, ?) RETURNING *');
  return stmt.get(path, name) as Project;
}

export function getProject(id: number): Project | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function getProjectByPath(path: string): Project | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Project | undefined;
}

export function getAllProjects(): Project[] {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

// File operations
export function upsertFile(projectId: number, path: string, hash: string): File {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO files (project_id, path, hash, last_indexed)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, path) DO UPDATE SET
      hash = excluded.hash,
      last_indexed = datetime('now')
    RETURNING *
  `);
  return stmt.get(projectId, path, hash) as File;
}

export function getFile(id: number): File | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id) as File | undefined;
}

export function getFileByPath(projectId: number, path: string): File | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM files WHERE project_id = ? AND path = ?').get(projectId, path) as File | undefined;
}

export function deleteFile(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM files WHERE id = ?').run(id);
}

export function getProjectFiles(projectId: number): File[] {
  const db = getDb();
  return db.prepare('SELECT * FROM files WHERE project_id = ?').all(projectId) as File[];
}

// Structure operations
export function insertStructure(
  fileId: number,
  type: Structure['type'],
  name: string,
  lineStart: number,
  lineEnd: number,
  signature: string | null,
  rawContent: string,
  metadata: Record<string, unknown> = {}
): Structure {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO structures (file_id, type, name, line_start, line_end, signature, raw_content, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(fileId, type, name, lineStart, lineEnd, signature, rawContent, JSON.stringify(metadata)) as Structure;
}

export function deleteFileStructures(fileId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM structures WHERE file_id = ?').run(fileId);
}

export function searchStructures(query: string, limit = 20, projectId?: number): Structure[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT s.* FROM structures s
      JOIN structures_fts fts ON s.id = fts.rowid
      JOIN files f ON s.file_id = f.id
      WHERE structures_fts MATCH ? AND f.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit) as Structure[];
  }
  return db.prepare(`
    SELECT s.* FROM structures s
    JOIN structures_fts fts ON s.id = fts.rowid
    WHERE structures_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as Structure[];
}

export function getStructuresByName(name: string, projectId?: number): Structure[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT s.* FROM structures s
      JOIN files f ON s.file_id = f.id
      WHERE s.name = ? AND f.project_id = ?
    `).all(name, projectId) as Structure[];
  }
  return db.prepare('SELECT * FROM structures WHERE name = ?').all(name) as Structure[];
}

// Find project by checking if cwd is inside any project path
export function findProjectForPath(targetPath: string): Project | undefined {
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
export function insertConversation(
  rawContent: string,
  projectId: number | null = null,
  model: string | null = null,
  tool: string | null = null,
  summary: string | null = null
): Conversation {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO conversations (project_id, model, tool, summary, raw_content)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(projectId, model, tool, summary, rawContent) as Conversation;
}

export function searchConversations(query: string, limit = 20, projectId?: number): Conversation[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversations_fts fts ON c.id = fts.rowid
      WHERE conversations_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit) as Conversation[];
  }
  return db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversations_fts fts ON c.id = fts.rowid
    WHERE conversations_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as Conversation[];
}

// Link operations
export function createLink(
  sourceType: Link['source_type'],
  sourceId: number,
  targetType: Link['target_type'],
  targetId: number,
  linkType: Link['link_type']
): Link {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO links (source_type, source_id, target_type, target_id, link_type)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(sourceType, sourceId, targetType, targetId, linkType) as Link;
}

export function getLinksFrom(sourceType: Link['source_type'], sourceId: number): Link[] {
  const db = getDb();
  return db.prepare('SELECT * FROM links WHERE source_type = ? AND source_id = ?').all(sourceType, sourceId) as Link[];
}

export function getLinksTo(targetType: Link['target_type'], targetId: number): Link[] {
  const db = getDb();
  return db.prepare('SELECT * FROM links WHERE target_type = ? AND target_id = ?').all(targetType, targetId) as Link[];
}

// Extraction operations
export function insertExtraction(
  conversationId: number,
  type: Extraction['type'],
  content: string,
  metadata: Record<string, unknown> = {}
): Extraction {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO extractions (conversation_id, type, content, metadata)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(conversationId, type, content, JSON.stringify(metadata)) as Extraction;
}

export function getConversationExtractions(conversationId: number): Extraction[] {
  const db = getDb();
  return db.prepare('SELECT * FROM extractions WHERE conversation_id = ?').all(conversationId) as Extraction[];
}

export function getExtraction(id: number): Extraction | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM extractions WHERE id = ?').get(id) as Extraction | undefined;
}

export function searchExtractions(query: string, limit = 20, projectId?: number): Extraction[] {
  const db = getDb();
  const searchTerm = `%${query}%`;

  if (projectId) {
    return db.prepare(`
      SELECT e.* FROM extractions e
      JOIN conversations c ON e.conversation_id = c.id
      WHERE e.content LIKE ? AND c.project_id = ?
      ORDER BY e.id DESC
      LIMIT ?
    `).all(searchTerm, projectId, limit) as Extraction[];
  }

  return db.prepare(`
    SELECT * FROM extractions
    WHERE content LIKE ?
    ORDER BY id DESC
    LIMIT ?
  `).all(searchTerm, limit) as Extraction[];
}

export function isDuplicateExtraction(
  content: string,
  projectId: number | null,
  windowSeconds: number = 300
): boolean {
  const db = getDb();
  // Check for duplicate extraction content within the last N seconds
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM extractions e
    JOIN conversations c ON e.conversation_id = c.id
    WHERE e.content = ?
    AND (c.project_id = ? OR (c.project_id IS NULL AND ? IS NULL))
    AND datetime(c.timestamp) > datetime('now', '-' || ? || ' seconds')
  `);
  const result = stmt.get(content.trim(), projectId, projectId, windowSeconds) as { count: number };
  return result.count > 0;
}

// Stats
export function getStats(): IndexStats {
  const db = getDb();
  const projects = (db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number }).count;
  const files = (db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }).count;
  const structures = (db.prepare('SELECT COUNT(*) as count FROM structures').get() as { count: number }).count;
  const conversations = (db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }).count;
  const links = (db.prepare('SELECT COUNT(*) as count FROM links').get() as { count: number }).count;
  return { projects, files, structures, conversations, links };
}

// Check if entity exists (for hallucination checking)
export function structureExists(name: string): boolean {
  const db = getDb();
  const result = db.prepare('SELECT 1 FROM structures WHERE name = ? LIMIT 1').get(name);
  return result !== undefined;
}

export function fileExists(path: string): boolean {
  const db = getDb();
  const result = db.prepare('SELECT 1 FROM files WHERE path = ? LIMIT 1').get(path);
  return result !== undefined;
}

// Get a conversation by ID with full content
export function getConversationById(id: number): Conversation | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined;
}

// Get full conversations for a project (for long-term memory)
export function getFullConversations(projectId: number, limit = 50, offset = 0): Conversation[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM conversations
    WHERE project_id = ?
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(projectId, limit, offset) as Conversation[];
}

// Get recent conversations (optionally scoped to project)
export function getRecentConversations(limit = 10, projectId?: number): Conversation[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT * FROM conversations
      WHERE project_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(projectId, limit) as Conversation[];
  }
  return db.prepare(`
    SELECT * FROM conversations
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Conversation[];
}

// Search conversations and return full content
export function searchFullConversations(query: string, limit = 20, projectId?: number): Conversation[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversations_fts fts ON c.id = fts.rowid
      WHERE conversations_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit) as Conversation[];
  }
  return db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversations_fts fts ON c.id = fts.rowid
    WHERE conversations_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as Conversation[];
}

// Structure with file path for visualization
export interface StructureWithFile extends Structure {
  file_path: string;
}

// Get all structures for a project with file paths
export function getAllProjectStructures(projectId: number): StructureWithFile[] {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, f.path as file_path
    FROM structures s
    JOIN files f ON s.file_id = f.id
    WHERE f.project_id = ?
    ORDER BY f.path, s.line_start
  `).all(projectId) as StructureWithFile[];
}

// Get all links for a project
export function getAllProjectLinks(projectId: number): Link[] {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT l.* FROM links l
    LEFT JOIN structures s ON l.source_type = 'structure' AND l.source_id = s.id
    LEFT JOIN files f ON s.file_id = f.id
    LEFT JOIN conversations c ON l.source_type = 'conversation' AND l.source_id = c.id
    WHERE f.project_id = ? OR c.project_id = ?
  `).all(projectId, projectId) as Link[];
}

// Get all extractions for a project
export function getAllProjectExtractions(projectId: number): Extraction[] {
  const db = getDb();
  return db.prepare(`
    SELECT e.* FROM extractions e
    JOIN conversations c ON e.conversation_id = c.id
    WHERE c.project_id = ?
    ORDER BY c.timestamp DESC
  `).all(projectId) as Extraction[];
}

// ============ Git Operations ============

// Commit operations
export function upsertCommit(
  projectId: number,
  hash: string,
  shortHash: string | null,
  authorName: string | null,
  authorEmail: string | null,
  timestamp: string,
  subject: string,
  body: string | null,
  parentHashes: string[] = []
): Commit {
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
  return stmt.get(projectId, hash, shortHash, authorName, authorEmail, timestamp, subject, body, JSON.stringify(parentHashes)) as Commit;
}

export function getCommitByHash(projectId: number, hash: string): Commit | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM commits WHERE project_id = ? AND hash = ?').get(projectId, hash) as Commit | undefined;
}

export function getCommitById(id: number): Commit | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM commits WHERE id = ?').get(id) as Commit | undefined;
}

export function searchCommits(query: string, limit = 20, projectId?: number): Commit[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT c.* FROM commits c
      JOIN commits_fts fts ON c.id = fts.rowid
      WHERE commits_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, projectId, limit) as Commit[];
  }
  return db.prepare(`
    SELECT c.* FROM commits c
    JOIN commits_fts fts ON c.id = fts.rowid
    WHERE commits_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as Commit[];
}

export function getRecentCommits(projectId: number, limit = 50): Commit[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM commits WHERE project_id = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(projectId, limit) as Commit[];
}

// Commit link operations
export function createCommitLink(
  commitId: number,
  targetType: CommitLink['target_type'],
  targetId: number,
  linkType: CommitLink['link_type']
): CommitLink | undefined {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO commit_links (commit_id, target_type, target_id, link_type)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(commitId, targetType, targetId, linkType) as CommitLink | undefined;
}

export function getCommitLinks(commitId: number): CommitLink[] {
  const db = getDb();
  return db.prepare('SELECT * FROM commit_links WHERE commit_id = ?').all(commitId) as CommitLink[];
}

export function getLinksToCommit(targetType: CommitLink['target_type'], targetId: number): CommitLink[] {
  const db = getDb();
  return db.prepare('SELECT * FROM commit_links WHERE target_type = ? AND target_id = ?').all(targetType, targetId) as CommitLink[];
}

export function getCommitsForStructure(structureId: number): Commit[] {
  const db = getDb();
  return db.prepare(`
    SELECT c.* FROM commits c
    JOIN commit_links cl ON c.id = cl.commit_id
    WHERE cl.target_type = 'structure' AND cl.target_id = ?
    ORDER BY c.timestamp DESC
  `).all(structureId) as Commit[];
}

export function getCommitsForExtraction(extractionId: number): Commit[] {
  const db = getDb();
  return db.prepare(`
    SELECT c.* FROM commits c
    JOIN commit_links cl ON c.id = cl.commit_id
    WHERE cl.target_type = 'extraction' AND cl.target_id = ?
    ORDER BY c.timestamp DESC
  `).all(extractionId) as Commit[];
}

// Update structure authorship
export function updateStructureAuthorship(
  structureId: number,
  author: string | null,
  authorEmail: string | null,
  commitHash: string | null
): void {
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
export function getUncommittedExtractions(projectId: number, sinceCommitHash?: string): Extraction[] {
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
    `).all(projectId, projectId, sinceCommitHash) as Extraction[];
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
  `).all(projectId) as Extraction[];
}
