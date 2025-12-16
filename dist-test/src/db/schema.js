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
`;
//# sourceMappingURL=schema.js.map