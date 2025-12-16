import type { StructureType } from '../../types/index.js';

export interface ParsedStructure {
  type: StructureType;
  name: string;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  rawContent: string;
  metadata: Record<string, unknown>;
}

export interface Parser {
  extensions: string[];
  parse(content: string, filePath: string): ParsedStructure[];
}

// Helper to find line numbers from character positions
export function getLineNumber(content: string, position: number): number {
  return content.slice(0, position).split('\n').length;
}

// Helper to extract raw content between lines
export function extractLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  return lines.slice(startLine - 1, endLine).join('\n');
}
