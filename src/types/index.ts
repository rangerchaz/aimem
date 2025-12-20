// Core types for aimem

export interface Project {
  id: number;
  path: string;
  name: string;
  created_at: string;
}

export interface File {
  id: number;
  project_id: number;
  path: string;
  hash: string;
  last_indexed: string;
}

export type StructureType = 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'module';

export interface Structure {
  id: number;
  file_id: number;
  type: StructureType;
  name: string;
  line_start: number;
  line_end: number;
  signature: string | null;
  raw_content: string;
  metadata: Record<string, unknown>;
  // Git authorship (optional, added via migration)
  last_author?: string | null;
  last_author_email?: string | null;
  last_commit_hash?: string | null;
}

export interface Conversation {
  id: number;
  project_id: number | null;
  timestamp: string;
  model: string | null;
  tool: string | null;
  summary: string | null;
  raw_content: string;
}

export type LinkType = 'decision' | 'touched' | 'rejected' | 'calls' | 'called_by' | 'references';
export type NodeType = 'file' | 'structure' | 'conversation' | 'extraction';

export interface Link {
  id: number;
  source_type: NodeType;
  source_id: number;
  target_type: NodeType;
  target_id: number;
  link_type: LinkType;
}

export type ExtractionType = 'decision' | 'pattern' | 'rejection' | 'question';

export interface Extraction {
  id: number;
  conversation_id: number;
  type: ExtractionType;
  content: string;
  metadata: Record<string, unknown>;
}

export interface AimemConfig {
  dataDir: string;
  proxyPort: number;
  watcherEnabled: boolean;
}

export interface IndexStats {
  projects: number;
  files: number;
  structures: number;
  conversations: number;
  links: number;
}

// Git-related types
export interface Commit {
  id: number;
  project_id: number;
  hash: string;
  short_hash: string | null;
  author_name: string | null;
  author_email: string | null;
  timestamp: string;
  subject: string;
  body: string | null;
  parent_hashes: string | null; // JSON array
}

export type CommitLinkType = 'modified' | 'committed_in' | 'introduced';
export type CommitTargetType = 'structure' | 'file' | 'extraction' | 'conversation';

export interface CommitLink {
  id: number;
  commit_id: number;
  target_type: CommitTargetType;
  target_id: number;
  link_type: CommitLinkType;
}
