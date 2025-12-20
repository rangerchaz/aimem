// Visualization module for generating interactive dashboards
import type { Structure, Link, Extraction, Project, File, Conversation } from '../types/index.js';
import type { StructureWithFile } from '../db/index.js';
import { generateDashboardHTML } from './template.js';

// ============================================
// Code Smells Data Types
// ============================================
export interface CodeSmell {
  type: 'large-file' | 'long-function' | 'too-many-callers' | 'too-many-callees' | 'orphan';
  severity: 'high' | 'medium' | 'low';
  structureId?: number;
  filePath: string;
  name: string;
  metric: number;
  threshold: number;
  description: string;
}

export interface CodeSmellsData {
  smells: CodeSmell[];
  summary: { high: number; medium: number; low: number };
  thresholds: {
    largeFile: number;
    longFunction: number;
    tooManyCallers: number;
    tooManyCallees: number;
  };
}

// ============================================
// Hotspots Data Types
// ============================================
export interface HotspotItem {
  id: number;
  name: string;
  file: string;
  type: string;
  lines?: number;
  inbound?: number;
  outbound?: number;
  total?: number;
  structureCount?: number;
}

export interface HotspotsData {
  largestFunctions: HotspotItem[];
  mostConnected: HotspotItem[];
  densestFiles: HotspotItem[];
  hubFunctions: HotspotItem[];
}

// ============================================
// Gallery Data Types
// ============================================
export interface GalleryItem {
  id: number;
  type: 'decision' | 'pattern' | 'rejection';
  content: string;
  timestamp: string;
  affectedCode: Array<{ id: number; name: string; file: string; type: string }>;
}

export interface GalleryData {
  items: GalleryItem[];
  byType: { decision: number; pattern: number; rejection: number };
}

// ============================================
// Timeline Data Types
// ============================================
export interface TimelineEntry {
  id: number;
  timestamp: string;
  summary: string | null;
  model: string | null;
  tool: string | null;
  touchedStructures: Array<{ id: number; name: string; file: string }>;
  extractionCount: number;
}

export interface TimelineData {
  entries: TimelineEntry[];
  dateRange: { start: string; end: string } | null;
}

// ============================================
// Treemap Data Types
// ============================================
export interface TreemapNode {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'structure';
  structureType?: string;
  value: number;
  children?: TreemapNode[];
}

// Cytoscape.js compatible node format
export interface GraphNode {
  data: {
    id: string;
    label: string;
    type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'module' | 'file' | 'decision' | 'pattern' | 'rejection';
    file?: string;
    line?: number;
    lineEnd?: number;
    signature?: string;
    content?: string;
    parent?: string; // For compound nodes (file -> structures)
    weight?: number; // For node sizing (more connections = bigger)
  };
}

// Cytoscape.js compatible edge format
export interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    type: 'calls' | 'called_by' | 'references' | 'decision' | 'touched' | 'rejected' | 'contains';
    label?: string;
  };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VisualizationData {
  project: Project;
  graphs: {
    overview: GraphData;
    callGraph: GraphData;
    dependencies: GraphData;
    classes: GraphData;
    decisions: GraphData;
  };
  // New visualization data
  smells: CodeSmellsData;
  hotspots: HotspotsData;
  gallery: GalleryData;
  timeline: TimelineData;
  treemap: TreemapNode;
  stats: {
    totalStructures: number;
    totalFiles: number;
    totalLinks: number;
    totalDecisions: number;
    totalConversations: number;
    byType: Record<string, number>;
  };
}

// Build graph data from database records
export function buildVisualizationData(
  project: Project,
  structures: StructureWithFile[],
  files: File[],
  links: Link[],
  extractions: Extraction[],
  conversations: Conversation[] = []
): VisualizationData {
  // Count structures by type
  const byType: Record<string, number> = {};
  for (const s of structures) {
    byType[s.type] = (byType[s.type] || 0) + 1;
  }

  return {
    project,
    graphs: {
      overview: buildOverviewGraph(structures, files),
      callGraph: buildCallGraph(structures, links),
      dependencies: buildDependencyGraph(structures, files),
      classes: buildClassGraph(structures, links),
      decisions: buildDecisionGraph(structures, extractions, links),
    },
    // New visualization data
    smells: buildCodeSmellsData(structures, files, links),
    hotspots: buildHotspotsData(structures, links),
    gallery: buildGalleryData(extractions, links, structures, conversations),
    timeline: buildTimelineData(conversations, links, structures, extractions),
    treemap: buildTreemapData(structures),
    stats: {
      totalStructures: structures.length,
      totalFiles: files.length,
      totalLinks: links.length,
      totalDecisions: extractions.filter(e => e.type === 'decision').length,
      totalConversations: conversations.length,
      byType,
    },
  };
}

// Overview: Files only (cleaner view) - structures shown on click via details panel
function buildOverviewGraph(structures: StructureWithFile[], files: File[]): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileMap = new Map<string, { count: number, types: Set<string> }>();

  // Count structures per file
  for (const s of structures) {
    if (!fileMap.has(s.file_path)) {
      fileMap.set(s.file_path, { count: 0, types: new Set() });
    }
    const info = fileMap.get(s.file_path)!;
    info.count++;
    info.types.add(s.type);
  }

  // Group files by directory for edges
  const dirMap = new Map<string, string[]>();
  for (const filePath of fileMap.keys()) {
    const dir = getDirectory(filePath);
    if (!dirMap.has(dir)) {
      dirMap.set(dir, []);
    }
    dirMap.get(dir)!.push(filePath);
  }

  // Add file nodes with structure counts
  for (const [filePath, info] of fileMap) {
    nodes.push({
      data: {
        id: `file:${filePath}`,
        label: `${getFileName(filePath)} (${info.count})`,
        type: 'file',
        file: filePath,
        content: `Contains ${info.count} structures: ${Array.from(info.types).join(', ')}`,
      },
    });
  }

  return { nodes, edges };
}

// Call graph: Function/method call relationships
function buildCallGraph(structures: StructureWithFile[], links: Link[]): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const structureMap = new Map<number, StructureWithFile>();

  // Build lookup map for functions/methods only
  for (const s of structures) {
    if (s.type === 'function' || s.type === 'method') {
      structureMap.set(s.id, s);
    }
  }

  // Collect which structures are involved in calls
  const includedIds = new Set<number>();

  // Find call relationships - only include if both source and target exist
  for (const link of links) {
    if ((link.link_type === 'calls' || link.link_type === 'called_by') &&
        link.source_type === 'structure' && link.target_type === 'structure') {

      const sourceId = link.link_type === 'calls' ? link.source_id : link.target_id;
      const targetId = link.link_type === 'calls' ? link.target_id : link.source_id;

      // Only add edge if both nodes exist in our map
      if (structureMap.has(sourceId) && structureMap.has(targetId) && sourceId !== targetId) {
        includedIds.add(sourceId);
        includedIds.add(targetId);

        edges.push({
          data: {
            id: `call:${sourceId}:${targetId}`,
            source: `structure:${sourceId}`,
            target: `structure:${targetId}`,
            type: 'calls',
            label: 'calls',
          },
        });
      }
    }
  }

  // Calculate connection weights for each node
  const connectionCount = new Map<number, number>();
  for (const edge of edges) {
    const sourceId = parseInt(edge.data.source.replace('structure:', ''));
    const targetId = parseInt(edge.data.target.replace('structure:', ''));
    connectionCount.set(sourceId, (connectionCount.get(sourceId) || 0) + 1);
    connectionCount.set(targetId, (connectionCount.get(targetId) || 0) + 1);
  }

  // Add nodes for structures involved in calls
  for (const id of includedIds) {
    const s = structureMap.get(id)!;
    const connections = connectionCount.get(id) || 0;
    nodes.push({
      data: {
        id: `structure:${s.id}`,
        label: s.name,
        type: s.type,
        file: s.file_path,
        line: s.line_start,
        signature: s.signature || undefined,
        content: s.raw_content,
        weight: connections, // Used for node sizing
      },
    });
  }

  // If no call links, show all functions/methods
  if (nodes.length === 0) {
    for (const s of structures) {
      if (s.type === 'function' || s.type === 'method') {
        nodes.push({
          data: {
            id: `structure:${s.id}`,
            label: s.name,
            type: s.type,
            file: s.file_path,
            line: s.line_start,
            signature: s.signature || undefined,
            content: s.raw_content,
          },
        });
      }
    }
  }

  return { nodes, edges };
}

// Dependency graph: File-level relationships
function buildDependencyGraph(structures: StructureWithFile[], files: File[]): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileSet = new Set<string>();

  // Get unique files from structures
  for (const s of structures) {
    fileSet.add(s.file_path);
  }

  // Add file nodes
  for (const filePath of fileSet) {
    nodes.push({
      data: {
        id: `file:${filePath}`,
        label: getFileName(filePath),
        type: 'file',
        file: filePath,
      },
    });
  }

  // For now, just show files - import analysis would require parsing
  return { nodes, edges };
}

// Class hierarchy: Classes and their methods
function buildClassGraph(structures: StructureWithFile[], links: Link[]): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const classIds = new Set<number>();
  const structureMap = new Map<number, StructureWithFile>();

  for (const s of structures) {
    structureMap.set(s.id, s);
  }

  // Find classes and interfaces
  for (const s of structures) {
    if (s.type === 'class' || s.type === 'interface') {
      classIds.add(s.id);
      nodes.push({
        data: {
          id: `structure:${s.id}`,
          label: s.name,
          type: s.type,
          file: s.file_path,
          line: s.line_start,
          signature: s.signature || undefined,
          content: s.raw_content,
        },
      });
    }
  }

  // Find methods that belong to classes (by file proximity or metadata)
  // This is a simplified approach - methods appear near their class
  for (const s of structures) {
    if (s.type === 'method') {
      nodes.push({
        data: {
          id: `structure:${s.id}`,
          label: s.name,
          type: s.type,
          file: s.file_path,
          line: s.line_start,
          signature: s.signature || undefined,
          content: s.raw_content,
        },
      });
    }
  }

  return { nodes, edges };
}

// Decision graph: Decisions and affected code
function buildDecisionGraph(
  structures: StructureWithFile[],
  extractions: Extraction[],
  links: Link[]
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const structureMap = new Map<number, StructureWithFile>();
  const affectedStructures = new Set<number>();

  for (const s of structures) {
    structureMap.set(s.id, s);
  }

  // Add extraction nodes (decisions, patterns, rejections)
  for (const e of extractions) {
    if (e.type === 'decision' || e.type === 'pattern' || e.type === 'rejection') {
      nodes.push({
        data: {
          id: `extraction:${e.id}`,
          label: truncate(e.content, 50),
          type: e.type,
          content: e.content,
        },
      });
    }
  }

  // Find links between extractions and structures
  for (const link of links) {
    if (link.source_type === 'extraction' && link.target_type === 'structure') {
      affectedStructures.add(link.target_id);
      edges.push({
        data: {
          id: `decision-link:${link.source_id}:${link.target_id}`,
          source: `extraction:${link.source_id}`,
          target: `structure:${link.target_id}`,
          type: link.link_type,
          label: link.link_type,
        },
      });
    }
  }

  // Add structure nodes that are affected by decisions
  for (const id of affectedStructures) {
    const s = structureMap.get(id);
    if (s) {
      nodes.push({
        data: {
          id: `structure:${s.id}`,
          label: s.name,
          type: s.type,
          file: s.file_path,
          line: s.line_start,
          content: s.raw_content,
        },
      });
    }
  }

  return { nodes, edges };
}

// Helper: Get filename from path
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

// Helper: Get directory from path
function getDirectory(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join('/') || '.';
}

// Helper: Truncate string
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ============================================
// Code Smells Builder
// ============================================
function buildCodeSmellsData(
  structures: StructureWithFile[],
  files: File[],
  links: Link[]
): CodeSmellsData {
  const thresholds = {
    largeFile: 10,      // >10 structures in a file
    longFunction: 100,  // >100 lines
    tooManyCallers: 10, // >10 inbound calls
    tooManyCallees: 10, // >10 outbound calls
  };

  const smells: CodeSmell[] = [];

  // Count structures per file
  const structuresPerFile = new Map<string, number>();
  for (const s of structures) {
    structuresPerFile.set(s.file_path, (structuresPerFile.get(s.file_path) || 0) + 1);
  }

  // Check for large files
  for (const [filePath, count] of structuresPerFile) {
    if (count > thresholds.largeFile) {
      const severity = count > thresholds.largeFile * 2 ? 'high' : count > thresholds.largeFile * 1.5 ? 'medium' : 'low';
      smells.push({
        type: 'large-file',
        severity,
        filePath,
        name: getFileName(filePath),
        metric: count,
        threshold: thresholds.largeFile,
        description: `File has ${count} structures (threshold: ${thresholds.largeFile})`,
      });
    }
  }

  // Count inbound/outbound links per structure
  const inboundCount = new Map<number, number>();
  const outboundCount = new Map<number, number>();

  for (const link of links) {
    if (link.link_type === 'calls' && link.source_type === 'structure' && link.target_type === 'structure') {
      outboundCount.set(link.source_id, (outboundCount.get(link.source_id) || 0) + 1);
      inboundCount.set(link.target_id, (inboundCount.get(link.target_id) || 0) + 1);
    }
  }

  // Build structure map for lookups
  const structureMap = new Map<number, StructureWithFile>();
  for (const s of structures) {
    structureMap.set(s.id, s);
  }

  // Check each structure for smells
  for (const s of structures) {
    if (s.type !== 'function' && s.type !== 'method') continue;

    const lines = (s.line_end || s.line_start) - s.line_start + 1;
    const inbound = inboundCount.get(s.id) || 0;
    const outbound = outboundCount.get(s.id) || 0;

    // Long function
    if (lines > thresholds.longFunction) {
      const severity = lines > thresholds.longFunction * 2 ? 'high' : lines > thresholds.longFunction * 1.5 ? 'medium' : 'low';
      smells.push({
        type: 'long-function',
        severity,
        structureId: s.id,
        filePath: s.file_path,
        name: s.name,
        metric: lines,
        threshold: thresholds.longFunction,
        description: `Function has ${lines} lines (threshold: ${thresholds.longFunction})`,
      });
    }

    // Too many callers
    if (inbound > thresholds.tooManyCallers) {
      const severity = inbound > thresholds.tooManyCallers * 2 ? 'high' : inbound > thresholds.tooManyCallers * 1.5 ? 'medium' : 'low';
      smells.push({
        type: 'too-many-callers',
        severity,
        structureId: s.id,
        filePath: s.file_path,
        name: s.name,
        metric: inbound,
        threshold: thresholds.tooManyCallers,
        description: `Function is called by ${inbound} others (threshold: ${thresholds.tooManyCallers})`,
      });
    }

    // Too many callees
    if (outbound > thresholds.tooManyCallees) {
      const severity = outbound > thresholds.tooManyCallees * 2 ? 'high' : outbound > thresholds.tooManyCallees * 1.5 ? 'medium' : 'low';
      smells.push({
        type: 'too-many-callees',
        severity,
        structureId: s.id,
        filePath: s.file_path,
        name: s.name,
        metric: outbound,
        threshold: thresholds.tooManyCallees,
        description: `Function calls ${outbound} others (threshold: ${thresholds.tooManyCallees})`,
      });
    }

    // Orphan code (not called by anything, and not an entry point)
    // Note: Orphan detection has limited accuracy - cross-file and intra-file calls may not be tracked
    const isEntryPoint = outbound > 0 && inbound === 0;
    if (inbound === 0 && outbound === 0) {
      // Skip likely false positives
      const filePath = s.file_path.toLowerCase();
      const funcName = s.name;

      // Skip test files and fixtures
      if (filePath.includes('/test/') || filePath.includes('.test.') || filePath.includes('.spec.') ||
          filePath.includes('/fixtures/') || filePath.includes('/__tests__/')) {
        continue;
      }

      // Skip build output directories (check both /dist/ and paths starting with dist/)
      if (filePath.includes('/dist/') || filePath.includes('/dist-test/') || filePath.includes('/build/') ||
          filePath.includes('/node_modules/') || filePath.startsWith('dist/') || filePath.startsWith('dist-test/')) {
        continue;
      }

      // Skip common framework hooks (mitmproxy, express, etc.)
      const frameworkHooks = ['request', 'response', 'load', 'configure', 'handler', 'middleware', 'setup', 'teardown'];
      if (frameworkHooks.includes(funcName.toLowerCase())) {
        continue;
      }

      // Skip parser artifacts and built-in property names
      const parserArtifacts = ['name', 'return', 'constructor', 'toString', 'valueOf', 'length'];
      if (parserArtifacts.includes(funcName)) {
        continue;
      }

      // Skip Python private helper functions (likely called internally)
      if (funcName.startsWith('_') && !funcName.startsWith('__')) {
        continue;
      }

      // Skip functions with common utility prefixes (likely exported)
      const utilityPrefixes = ['get', 'set', 'is', 'has', 'create', 'build', 'parse', 'format', 'validate', 'extract', 'find', 'ensure', 'init', 'setup', 'open', 'close', 'read', 'write', 'insert', 'update', 'delete', 'start', 'stop', 'store', 'escape', 'clean', 'deduplicate', 'encode', 'decode', 'render', 'load', 'save', 'fetch', 'send', 'handle', 'process', 'transform', 'convert', 'generate', 'calculate', 'compute'];
      const lowerName = funcName.toLowerCase();
      if (utilityPrefixes.some(p => lowerName.startsWith(p))) {
        continue;
      }

      smells.push({
        type: 'orphan',
        severity: 'low',
        structureId: s.id,
        filePath: s.file_path,
        name: s.name,
        metric: 0,
        threshold: 1,
        description: 'No detected callers or callees (may be called dynamically or cross-file)',
      });
    }
  }

  // Sort by severity (high first)
  const severityOrder = { high: 0, medium: 1, low: 2 };
  smells.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    smells,
    summary: {
      high: smells.filter(s => s.severity === 'high').length,
      medium: smells.filter(s => s.severity === 'medium').length,
      low: smells.filter(s => s.severity === 'low').length,
    },
    thresholds,
  };
}

// ============================================
// Hotspots Builder
// ============================================
function buildHotspotsData(
  structures: StructureWithFile[],
  links: Link[]
): HotspotsData {
  // Count inbound/outbound links per structure
  const inboundCount = new Map<number, number>();
  const outboundCount = new Map<number, number>();

  for (const link of links) {
    if (link.link_type === 'calls' && link.source_type === 'structure' && link.target_type === 'structure') {
      outboundCount.set(link.source_id, (outboundCount.get(link.source_id) || 0) + 1);
      inboundCount.set(link.target_id, (inboundCount.get(link.target_id) || 0) + 1);
    }
  }

  // Count structures per file
  const structuresPerFile = new Map<string, number>();
  for (const s of structures) {
    structuresPerFile.set(s.file_path, (structuresPerFile.get(s.file_path) || 0) + 1);
  }

  // Largest functions by line count
  const functionsWithLines = structures
    .filter(s => s.type === 'function' || s.type === 'method')
    .map(s => ({
      id: s.id,
      name: s.name,
      file: s.file_path,
      type: s.type,
      lines: (s.line_end || s.line_start) - s.line_start + 1,
    }))
    .sort((a, b) => b.lines! - a.lines!)
    .slice(0, 10);

  // Most connected functions
  const functionsWithConnections = structures
    .filter(s => s.type === 'function' || s.type === 'method')
    .map(s => ({
      id: s.id,
      name: s.name,
      file: s.file_path,
      type: s.type,
      inbound: inboundCount.get(s.id) || 0,
      outbound: outboundCount.get(s.id) || 0,
      total: (inboundCount.get(s.id) || 0) + (outboundCount.get(s.id) || 0),
    }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total! - a.total!)
    .slice(0, 10);

  // Densest files
  const densestFiles = Array.from(structuresPerFile.entries())
    .map(([file, count]) => ({
      id: 0,
      name: getFileName(file),
      file: file,
      type: 'file',
      structureCount: count,
    }))
    .sort((a, b) => b.structureCount! - a.structureCount!)
    .slice(0, 10);

  // Hub functions (called by many)
  const hubFunctions = structures
    .filter(s => s.type === 'function' || s.type === 'method')
    .map(s => ({
      id: s.id,
      name: s.name,
      file: s.file_path,
      type: s.type,
      inbound: inboundCount.get(s.id) || 0,
    }))
    .filter(s => s.inbound! > 0)
    .sort((a, b) => b.inbound! - a.inbound!)
    .slice(0, 10);

  return {
    largestFunctions: functionsWithLines,
    mostConnected: functionsWithConnections,
    densestFiles,
    hubFunctions,
  };
}

// ============================================
// Gallery Builder
// ============================================
function buildGalleryData(
  extractions: Extraction[],
  links: Link[],
  structures: StructureWithFile[],
  conversations: Conversation[]
): GalleryData {
  const structureMap = new Map<number, StructureWithFile>();
  for (const s of structures) {
    structureMap.set(s.id, s);
  }

  const conversationMap = new Map<number, Conversation>();
  for (const c of conversations) {
    conversationMap.set(c.id, c);
  }

  // Build extraction to structure links
  const extractionLinks = new Map<number, Array<{ id: number; name: string; file: string; type: string }>>();
  for (const link of links) {
    if (link.source_type === 'extraction' && link.target_type === 'structure') {
      const s = structureMap.get(link.target_id);
      if (s) {
        if (!extractionLinks.has(link.source_id)) {
          extractionLinks.set(link.source_id, []);
        }
        extractionLinks.get(link.source_id)!.push({
          id: s.id,
          name: s.name,
          file: s.file_path,
          type: s.type,
        });
      }
    }
  }

  const items: GalleryItem[] = [];
  let decisions = 0, patterns = 0, rejections = 0;

  for (const e of extractions) {
    if (e.type !== 'decision' && e.type !== 'pattern' && e.type !== 'rejection') continue;

    const conv = conversationMap.get(e.conversation_id);

    items.push({
      id: e.id,
      type: e.type as 'decision' | 'pattern' | 'rejection',
      content: e.content,
      timestamp: conv?.timestamp || '',
      affectedCode: extractionLinks.get(e.id) || [],
    });

    if (e.type === 'decision') decisions++;
    else if (e.type === 'pattern') patterns++;
    else if (e.type === 'rejection') rejections++;
  }

  // Sort by timestamp descending
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    items,
    byType: { decision: decisions, pattern: patterns, rejection: rejections },
  };
}

// ============================================
// Timeline Builder
// ============================================
function buildTimelineData(
  conversations: Conversation[],
  links: Link[],
  structures: StructureWithFile[],
  extractions: Extraction[]
): TimelineData {
  if (conversations.length === 0) {
    return { entries: [], dateRange: null };
  }

  const structureMap = new Map<number, StructureWithFile>();
  for (const s of structures) {
    structureMap.set(s.id, s);
  }

  // Build conversation to structure links
  const conversationStructures = new Map<number, Array<{ id: number; name: string; file: string }>>();
  for (const link of links) {
    if (link.source_type === 'conversation' && link.target_type === 'structure') {
      const s = structureMap.get(link.target_id);
      if (s) {
        if (!conversationStructures.has(link.source_id)) {
          conversationStructures.set(link.source_id, []);
        }
        conversationStructures.get(link.source_id)!.push({
          id: s.id,
          name: s.name,
          file: s.file_path,
        });
      }
    }
  }

  // Count extractions per conversation
  const extractionCounts = new Map<number, number>();
  for (const e of extractions) {
    extractionCounts.set(e.conversation_id, (extractionCounts.get(e.conversation_id) || 0) + 1);
  }

  const entries: TimelineEntry[] = conversations.map(c => ({
    id: c.id,
    timestamp: c.timestamp,
    summary: c.summary,
    model: c.model,
    tool: c.tool,
    touchedStructures: conversationStructures.get(c.id) || [],
    extractionCount: extractionCounts.get(c.id) || 0,
  }));

  // Sort by timestamp
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const timestamps = entries.map(e => e.timestamp);
  const dateRange = {
    start: timestamps[0],
    end: timestamps[timestamps.length - 1],
  };

  return { entries, dateRange };
}

// ============================================
// Treemap Builder
// ============================================
function buildTreemapData(structures: StructureWithFile[]): TreemapNode {
  // Build directory tree
  const root: TreemapNode = {
    name: 'root',
    path: '',
    type: 'directory',
    value: 0,
    children: [],
  };

  // Group structures by file, then by directory
  const fileStructures = new Map<string, StructureWithFile[]>();
  for (const s of structures) {
    if (!fileStructures.has(s.file_path)) {
      fileStructures.set(s.file_path, []);
    }
    fileStructures.get(s.file_path)!.push(s);
  }

  // Build tree from file paths
  for (const [filePath, fileStructs] of fileStructures) {
    const parts = filePath.split(/[/\\]/).filter(p => p);
    let current = root;

    // Navigate/create directory nodes
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      const dirPath = parts.slice(0, i + 1).join('/');

      let child = current.children?.find(c => c.name === dirName && c.type === 'directory');
      if (!child) {
        child = {
          name: dirName,
          path: dirPath,
          type: 'directory',
          value: 0,
          children: [],
        };
        current.children = current.children || [];
        current.children.push(child);
      }
      current = child;
    }

    // Add file node
    const fileName = parts[parts.length - 1];
    const fileValue = fileStructs.reduce((sum, s) => sum + ((s.line_end || s.line_start) - s.line_start + 1), 0);

    const fileNode: TreemapNode = {
      name: fileName,
      path: filePath,
      type: 'file',
      value: fileValue,
      children: fileStructs.map(s => ({
        name: s.name,
        path: `${filePath}:${s.line_start}`,
        type: 'structure' as const,
        structureType: s.type,
        value: (s.line_end || s.line_start) - s.line_start + 1,
      })),
    };

    current.children = current.children || [];
    current.children.push(fileNode);
  }

  // Calculate directory values (sum of children)
  function calculateValue(node: TreemapNode): number {
    if (!node.children || node.children.length === 0) {
      return node.value;
    }
    node.value = node.children.reduce((sum, child) => sum + calculateValue(child), 0);
    return node.value;
  }

  calculateValue(root);

  return root;
}

// Generate HTML dashboard
export function generateDashboard(data: VisualizationData): string {
  return generateDashboardHTML(data);
}
