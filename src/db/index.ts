import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { SCHEMA, MIGRATIONS, COMMIT_LINKS_SCHEMA, GUARDRAILS_SCHEMA } from './schema.js';
import type { Project, File, Structure, Conversation, Link, Extraction, IndexStats, Commit, CommitLink, Guardrail, GuardrailEvent, ProjectDik, GuardrailCategory, GuardrailSeverity, GuardrailSource, GuardrailEventType } from '../types/index.js';

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
  // Apply guardrails schema
  database.exec(GUARDRAILS_SCHEMA);
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

// ============ Guardrails Operations (DIK) ============

// Guardrail CRUD
export function insertGuardrail(
  projectId: number,
  category: GuardrailCategory,
  rule: string,
  rationale: string | null = null,
  severity: GuardrailSeverity = 'warn',
  source: GuardrailSource = 'explicit',
  sourceFile: string | null = null
): Guardrail {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO guardrails (project_id, category, rule, rationale, severity, source, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(projectId, category, rule, rationale, severity, source, sourceFile) as Guardrail;
}

export function getGuardrail(id: number): Guardrail | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM guardrails WHERE id = ?').get(id) as Guardrail | undefined;
}

export function getProjectGuardrails(
  projectId: number,
  options: { category?: GuardrailCategory; confirmedOnly?: boolean; activeOnly?: boolean } = {}
): Guardrail[] {
  const db = getDb();
  const { category, confirmedOnly = false, activeOnly = true } = options;

  let sql = 'SELECT * FROM guardrails WHERE project_id = ?';
  const params: (number | string)[] = [projectId];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (confirmedOnly) {
    sql += ' AND confirmed = 1';
  }
  if (activeOnly) {
    sql += ' AND active = 1';
  }

  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params) as Guardrail[];
}

export function confirmGuardrail(id: number): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE guardrails SET confirmed = 1 WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deactivateGuardrail(id: number): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE guardrails SET active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteGuardrail(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM guardrails WHERE id = ?').run(id);
  return result.changes > 0;
}

// Guardrail events
export function insertGuardrailEvent(
  guardrailId: number,
  eventType: GuardrailEventType,
  context: string | null = null,
  response: string | null = null,
  dikLevel: number | null = null
): GuardrailEvent {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO guardrail_events (guardrail_id, event_type, context, response, dik_level)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(guardrailId, eventType, context, response, dikLevel) as GuardrailEvent;
}

export function getGuardrailEvents(guardrailId: number): GuardrailEvent[] {
  const db = getDb();
  return db.prepare('SELECT * FROM guardrail_events WHERE guardrail_id = ? ORDER BY timestamp DESC').all(guardrailId) as GuardrailEvent[];
}

export function getGuardrailEvent(id: number): GuardrailEvent | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM guardrail_events WHERE id = ?').get(id) as GuardrailEvent | undefined;
}

export function getOverrideEvents(projectId: number): GuardrailEvent[] {
  const db = getDb();
  return db.prepare(`
    SELECT e.* FROM guardrail_events e
    JOIN guardrails g ON e.guardrail_id = g.id
    WHERE g.project_id = ? AND e.event_type = 'overridden'
    ORDER BY e.timestamp DESC
  `).all(projectId) as GuardrailEvent[];
}

// Project DIK
export function getOrCreateProjectDik(projectId: number): ProjectDik {
  const db = getDb();
  let dik = db.prepare('SELECT * FROM project_dik WHERE project_id = ?').get(projectId) as ProjectDik | undefined;

  if (!dik) {
    dik = db.prepare(`
      INSERT INTO project_dik (project_id) VALUES (?) RETURNING *
    `).get(projectId) as ProjectDik;
  }

  return dik;
}

export function updateProjectDik(projectId: number, updates: Partial<Omit<ProjectDik, 'id' | 'project_id' | 'created_at'>>): ProjectDik {
  const db = getDb();

  // Build dynamic update query
  const fields: string[] = [];
  const values: (number | string)[] = [];

  if (updates.level !== undefined) {
    fields.push('level = ?');
    values.push(updates.level);
  }
  if (updates.rules_confirmed !== undefined) {
    fields.push('rules_confirmed = ?');
    values.push(updates.rules_confirmed);
  }
  if (updates.rules_inferred !== undefined) {
    fields.push('rules_inferred = ?');
    values.push(updates.rules_inferred);
  }
  if (updates.conversations !== undefined) {
    fields.push('conversations = ?');
    values.push(updates.conversations);
  }
  if (updates.corrections_made !== undefined) {
    fields.push('corrections_made = ?');
    values.push(updates.corrections_made);
  }
  if (updates.overrides_regretted !== undefined) {
    fields.push('overrides_regretted = ?');
    values.push(updates.overrides_regretted);
  }

  fields.push("last_updated = datetime('now')");
  values.push(projectId);

  const sql = `UPDATE project_dik SET ${fields.join(', ')} WHERE project_id = ? RETURNING *`;
  return db.prepare(sql).get(...values) as ProjectDik;
}

export function incrementDikCounter(projectId: number, counter: 'rules_confirmed' | 'rules_inferred' | 'conversations' | 'corrections_made' | 'overrides_regretted'): void {
  const db = getDb();
  // Ensure project_dik exists
  getOrCreateProjectDik(projectId);
  db.prepare(`UPDATE project_dik SET ${counter} = ${counter} + 1, last_updated = datetime('now') WHERE project_id = ?`).run(projectId);
}

// Get guardrail history for a specific rule (for response generation)
export function getGuardrailHistory(guardrailId: number): { overrides: number; vindicated: boolean } {
  const db = getDb();
  const events = db.prepare(`
    SELECT event_type, COUNT(*) as count FROM guardrail_events
    WHERE guardrail_id = ?
    GROUP BY event_type
  `).all(guardrailId) as { event_type: string; count: number }[];

  let overrides = 0;
  let vindicated = false;

  for (const e of events) {
    if (e.event_type === 'overridden') overrides = e.count;
    if (e.event_type === 'vindicated') vindicated = true;
  }

  return { overrides, vindicated };
}

// Toggle ambient personality mode
export function setAmbientPersonality(projectId: number, enabled: boolean): void {
  const db = getDb();
  // Ensure project_dik exists
  getOrCreateProjectDik(projectId);
  db.prepare(`UPDATE project_dik SET ambient_personality = ?, last_updated = datetime('now') WHERE project_id = ?`).run(enabled ? 1 : 0, projectId);
}

// Get guardrails config for a project
export function getGuardrailsConfig(projectId: number): { enabled: boolean; ambient_personality: boolean } {
  const dik = getOrCreateProjectDik(projectId);
  return {
    enabled: true, // Guardrails always enabled if project_dik exists
    ambient_personality: dik.ambient_personality === 1,
  };
}

// Manually set DIK level (overrides calculated value)
export function setDikLevel(projectId: number, level: number): void {
  const db = getDb();
  const clampedLevel = Math.max(1, Math.min(10, level));
  getOrCreateProjectDik(projectId);
  db.prepare(`UPDATE project_dik SET level = ?, last_updated = datetime('now') WHERE project_id = ?`).run(clampedLevel, projectId);
}

// Check if DIK level is manually set (level != 2 default and stats don't match)
export function isDikManuallySet(projectId: number): boolean {
  const dik = getOrCreateProjectDik(projectId);
  // If level is non-default but stats are zero, it's manually set
  return dik.level !== 2 && dik.rules_confirmed === 0 && dik.corrections_made === 0 && dik.overrides_regretted === 0 && dik.conversations === 0;
}
