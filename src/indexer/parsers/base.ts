import type { StructureType } from '../../types/index.js';

export interface ParsedStructure {
  type: StructureType;
  name: string;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  rawContent: string;
  metadata: Record<string, unknown>;
  calls?: string[];  // Function/method names called within this structure
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

// Helper to extract function calls from code
// This is a language-agnostic approach that finds identifier(...) patterns
export function extractCalls(code: string, ownName: string): string[] {
  const calls = new Set<string>();

  // Match function calls: identifier( or identifier.method(
  // Excludes: keywords, string literals, comments
  const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;

  // Common keywords to exclude (cross-language)
  const keywords = new Set([
    // JS/TS
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch', 'finally',
    'function', 'async', 'await', 'return', 'throw', 'new', 'typeof', 'instanceof',
    'class', 'interface', 'type', 'enum', 'import', 'export', 'from', 'as',
    // Python
    'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally',
    'with', 'as', 'import', 'from', 'return', 'yield', 'raise', 'pass', 'lambda',
    'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None', 'assert', 'print',
    // Go
    'func', 'if', 'else', 'for', 'switch', 'case', 'select', 'go', 'defer',
    'return', 'break', 'continue', 'goto', 'fallthrough', 'range', 'type', 'struct',
    'interface', 'map', 'chan', 'make', 'new', 'append', 'len', 'cap', 'panic', 'recover',
    // Ruby
    'def', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'case', 'when',
    'while', 'until', 'for', 'do', 'begin', 'rescue', 'ensure', 'end', 'return',
    'yield', 'raise', 'require', 'include', 'extend', 'attr_reader', 'attr_writer',
  ]);

  let match;
  while ((match = callPattern.exec(code)) !== null) {
    const name = match[1];
    // Exclude keywords, the function's own name, and very short names
    if (!keywords.has(name) && name !== ownName && name.length > 1) {
      calls.add(name);
    }
  }

  return Array.from(calls);
}
