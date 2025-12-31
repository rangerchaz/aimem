// Database schema for aimem

export const SCHEMA = `
-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Files table
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  last_indexed TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, path)
);

-- Structures table (functions, classes, methods, etc.)
CREATE TABLE IF NOT EXISTS structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('function', 'class', 'method', 'interface', 'type', 'variable', 'module')),
  name TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  signature TEXT,
  raw_content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  timestamp TEXT DEFAULT (datetime('now')),
  model TEXT,
  tool TEXT,
  summary TEXT,
  raw_content TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Links table (graph edges)
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('file', 'structure', 'conversation', 'extraction')),
  source_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('file', 'structure', 'conversation', 'extraction')),
  target_id INTEGER NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('decision', 'touched', 'rejected', 'calls', 'called_by', 'references')),
  UNIQUE(source_type, source_id, target_type, target_id, link_type)
);

-- Extractions table (decisions, patterns, rejections from conversations)
CREATE TABLE IF NOT EXISTS extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('decision', 'pattern', 'rejection', 'question')),
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_structures_file ON structures(file_id);
CREATE INDEX IF NOT EXISTS idx_structures_name ON structures(name);
CREATE INDEX IF NOT EXISTS idx_structures_type ON structures(type);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_extractions_conversation ON extractions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_extractions_type ON extractions(type);

-- Full-text search for structures
CREATE VIRTUAL TABLE IF NOT EXISTS structures_fts USING fts5(
  name,
  signature,
  raw_content,
  content='structures',
  content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS structures_ai AFTER INSERT ON structures BEGIN
  INSERT INTO structures_fts(rowid, name, signature, raw_content)
  VALUES (new.id, new.name, new.signature, new.raw_content);
END;

CREATE TRIGGER IF NOT EXISTS structures_ad AFTER DELETE ON structures BEGIN
  INSERT INTO structures_fts(structures_fts, rowid, name, signature, raw_content)
  VALUES ('delete', old.id, old.name, old.signature, old.raw_content);
END;

CREATE TRIGGER IF NOT EXISTS structures_au AFTER UPDATE ON structures BEGIN
  INSERT INTO structures_fts(structures_fts, rowid, name, signature, raw_content)
  VALUES ('delete', old.id, old.name, old.signature, old.raw_content);
  INSERT INTO structures_fts(rowid, name, signature, raw_content)
  VALUES (new.id, new.name, new.signature, new.raw_content);
END;

-- Full-text search for conversations
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
  summary,
  raw_content,
  content='conversations',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
  INSERT INTO conversations_fts(rowid, summary, raw_content)
  VALUES (new.id, new.summary, new.raw_content);
END;

CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, summary, raw_content)
  VALUES ('delete', old.id, old.summary, old.raw_content);
END;

CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, summary, raw_content)
  VALUES ('delete', old.id, old.summary, old.raw_content);
  INSERT INTO conversations_fts(rowid, summary, raw_content)
  VALUES (new.id, new.summary, new.raw_content);
END;

-- Git commits table
CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  hash TEXT NOT NULL,
  short_hash TEXT,
  author_name TEXT,
  author_email TEXT,
  timestamp TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  parent_hashes TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_commits_project ON commits(project_id);
CREATE INDEX IF NOT EXISTS idx_commits_hash ON commits(hash);
CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits(timestamp);

-- Full-text search for commits
CREATE VIRTUAL TABLE IF NOT EXISTS commits_fts USING fts5(
  subject,
  body,
  content='commits',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS commits_ai AFTER INSERT ON commits BEGIN
  INSERT INTO commits_fts(rowid, subject, body)
  VALUES (new.id, new.subject, new.body);
END;

CREATE TRIGGER IF NOT EXISTS commits_ad AFTER DELETE ON commits BEGIN
  INSERT INTO commits_fts(commits_fts, rowid, subject, body)
  VALUES ('delete', old.id, old.subject, old.body);
END;

CREATE TRIGGER IF NOT EXISTS commits_au AFTER UPDATE ON commits BEGIN
  INSERT INTO commits_fts(commits_fts, rowid, subject, body)
  VALUES ('delete', old.id, old.subject, old.body);
  INSERT INTO commits_fts(rowid, subject, body)
  VALUES (new.id, new.subject, new.body);
END;
`;

// Migrations for existing databases
export const MIGRATIONS = [
  // Migration 1: Add git authorship columns to structures
  `ALTER TABLE structures ADD COLUMN last_author TEXT;`,
  `ALTER TABLE structures ADD COLUMN last_author_email TEXT;`,
  `ALTER TABLE structures ADD COLUMN last_commit_hash TEXT;`,
  // Migration 2: Add ambient_personality to project_dik
  `ALTER TABLE project_dik ADD COLUMN ambient_personality INTEGER DEFAULT 0;`,
  // Migration 3: Add vindication tracking columns to guardrail_events
  `ALTER TABLE guardrail_events ADD COLUMN suggestion TEXT;`,
  `ALTER TABLE guardrail_events ADD COLUMN code_context TEXT;`,
  `ALTER TABLE guardrail_events ADD COLUMN file_path TEXT;`,
  `ALTER TABLE guardrail_events ADD COLUMN line_start INTEGER;`,
  `ALTER TABLE guardrail_events ADD COLUMN line_end INTEGER;`,
  `ALTER TABLE guardrail_events ADD COLUMN content_hash TEXT;`,
  `ALTER TABLE guardrail_events ADD COLUMN vindication_pending INTEGER DEFAULT 0;`,
  `ALTER TABLE guardrail_events ADD COLUMN checked_at TEXT;`,
];

// Links between commits and other entities use a separate table to avoid schema migration issues
export const COMMIT_LINKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS commit_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('structure', 'file', 'extraction', 'conversation')),
  target_id INTEGER NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('modified', 'committed_in', 'introduced')),
  FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE,
  UNIQUE(commit_id, target_type, target_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_commit_links_commit ON commit_links(commit_id);
CREATE INDEX IF NOT EXISTS idx_commit_links_target ON commit_links(target_type, target_id);
`;

// Guardrails schema (DIK - Digital Interface Knowledge)
export const GUARDRAILS_SCHEMA = `
-- Guardrails: project rules and patterns
CREATE TABLE IF NOT EXISTS guardrails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('design', 'architecture', 'naming', 'security', 'performance', 'testing')),
  rule TEXT NOT NULL,
  rationale TEXT,
  severity TEXT DEFAULT 'warn' CHECK (severity IN ('info', 'warn', 'block')),
  source TEXT DEFAULT 'inferred' CHECK (source IN ('inferred', 'explicit', 'imported')),
  source_file TEXT,
  confirmed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  active INTEGER DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Guardrail events: track triggers, overrides, vindication
CREATE TABLE IF NOT EXISTS guardrail_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardrail_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('triggered', 'overridden', 'accepted', 'vindicated')),
  context TEXT,
  response TEXT,
  dik_level INTEGER,
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (guardrail_id) REFERENCES guardrails(id) ON DELETE CASCADE
);

-- Project DIK: earned authority per project
CREATE TABLE IF NOT EXISTS project_dik (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  level INTEGER DEFAULT 2,
  rules_confirmed INTEGER DEFAULT 0,
  rules_inferred INTEGER DEFAULT 0,
  conversations INTEGER DEFAULT 0,
  corrections_made INTEGER DEFAULT 0,
  overrides_regretted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_updated TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_guardrails_project ON guardrails(project_id);
CREATE INDEX IF NOT EXISTS idx_guardrails_category ON guardrails(category);
CREATE INDEX IF NOT EXISTS idx_guardrails_active ON guardrails(active);
CREATE INDEX IF NOT EXISTS idx_events_guardrail ON guardrail_events(guardrail_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON guardrail_events(event_type);
CREATE INDEX IF NOT EXISTS idx_project_dik_project ON project_dik(project_id);
`;
