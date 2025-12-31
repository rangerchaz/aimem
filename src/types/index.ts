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

// Guardrails types (DIK - Digital Interface Knowledge)
export type GuardrailCategory = 'design' | 'architecture' | 'naming' | 'security' | 'performance' | 'testing';
export type GuardrailSeverity = 'info' | 'warn' | 'block';
export type GuardrailSource = 'inferred' | 'explicit' | 'imported';
export type GuardrailEventType = 'triggered' | 'overridden' | 'accepted' | 'vindicated';

export interface Guardrail {
  id: number;
  project_id: number;
  category: GuardrailCategory;
  rule: string;
  rationale: string | null;
  severity: GuardrailSeverity;
  source: GuardrailSource;
  source_file: string | null;
  confirmed: number; // 0 or 1
  created_at: string;
  active: number; // 0 or 1
}

export interface GuardrailEvent {
  id: number;
  guardrail_id: number;
  event_type: GuardrailEventType;
  context: string | null;
  response: string | null;
  dik_level: number | null;
  timestamp: string;
  // Vindication tracking fields (added via migration)
  suggestion?: string | null;
  code_context?: string | null;
  file_path?: string | null;
  line_start?: number | null;
  line_end?: number | null;
  content_hash?: string | null;
  vindication_pending?: number | null;
  checked_at?: string | null;
}

export interface ProjectDik {
  id: number;
  project_id: number;
  level: number;
  rules_confirmed: number;
  rules_inferred: number;
  conversations: number;
  corrections_made: number;
  overrides_regretted: number;
  ambient_personality: number; // 0 or 1
  created_at: string;
  last_updated: string;
}

export interface GuardrailViolation {
  id: number;
  rule: string;
  category: GuardrailCategory;
  severity: GuardrailSeverity;
  rationale: string | null;
}

export interface GuardrailCheckResult {
  violations: GuardrailViolation[];
  dik_level: number;
  response: string;
}

export interface ProposedRule {
  category: GuardrailCategory;
  rule: string;
  rationale: string;
  confidence: number;
  evidence: string[];
}

// Vindication types
export interface VindicationCandidate {
  eventId: number;
  guardrailId: number;
  projectId: number;
  suggestion: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  originalCode: string;
  contentHash: string;
  reason: string;
  timestamp: string;
}

export interface VindicationResult {
  eventId: number;
  vindicated: boolean;
  confidence: number;
  reason: string;
}

export interface VindicationCheckResult {
  candidate: VindicationCandidate;
  result: VindicationResult;
  newDikLevel?: number;
}

export interface OverrideContext {
  suggestion?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
}
