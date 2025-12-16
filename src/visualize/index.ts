// Visualization module for generating interactive dashboards
import type { Structure, Link, Extraction, Project, File } from '../types/index.js';
import type { StructureWithFile } from '../db/index.js';
import { generateDashboardHTML } from './template.js';

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
  stats: {
    totalStructures: number;
    totalFiles: number;
    totalLinks: number;
    totalDecisions: number;
    byType: Record<string, number>;
  };
}

// Build graph data from database records
export function buildVisualizationData(
  project: Project,
  structures: StructureWithFile[],
  files: File[],
  links: Link[],
  extractions: Extraction[]
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
    stats: {
      totalStructures: structures.length,
      totalFiles: files.length,
      totalLinks: links.length,
      totalDecisions: extractions.filter(e => e.type === 'decision').length,
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

// Generate HTML dashboard
export function generateDashboard(data: VisualizationData): string {
  return generateDashboardHTML(data);
}
