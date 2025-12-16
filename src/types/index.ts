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
