import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

const patterns = {
  // def name(...):
  function: /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?:/gm,

  // class Name:
  class: /^(\s*)class\s+(\w+)(?:\s*\([^)]*\))?:/gm,
};

function findPythonBlockEnd(content: string, startLine: number, indent: string): number {
  const lines = content.split('\n');
  const indentLevel = indent.length;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Check if this line has less or equal indentation (and is not empty)
    const lineIndent = line.match(/^(\s*)/)?.[1] || '';
    if (lineIndent.length <= indentLevel && line.trim() !== '') {
      return i; // Return the line number (0-indexed) where block ends
    }
  }

  return lines.length;
}

export const pythonParser: Parser = {
  extensions: ['.py', '.pyw'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];
    const lines = content.split('\n');

    // Parse functions
    let match;
    patterns.function.lastIndex = 0;
    while ((match = patterns.function.exec(content)) !== null) {
      const indent = match[1];
      const name = match[2];
      const params = match[3];
      const lineStart = getLineNumber(content, match.index);
      const lineEnd = findPythonBlockEnd(content, lineStart, indent);

      // Skip methods (inside classes) - they have indentation
      if (indent.length > 0) {
        // Check if this is a method by looking for a class above
        const linesAbove = content.slice(0, match.index).split('\n');
        let isMethod = false;
        for (let i = linesAbove.length - 1; i >= 0; i--) {
          const line = linesAbove[i];
          if (line.match(/^class\s+\w+/)) {
            isMethod = true;
            break;
          }
          // If we hit a non-indented non-empty line that's not a class, stop
          if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
            break;
          }
        }

        if (isMethod) {
          const rawContent = extractLines(content, lineStart, lineEnd);
          structures.push({
            type: 'method',
            name,
            lineStart,
            lineEnd,
            signature: `def ${name}(${params})`,
            rawContent,
            metadata: { params: params.split(',').map(p => p.trim()).filter(Boolean) },
            calls: extractCalls(rawContent, name),
          });
          continue;
        }
      }

      const rawContent = extractLines(content, lineStart, lineEnd);
      structures.push({
        type: 'function',
        name,
        lineStart,
        lineEnd,
        signature: `def ${name}(${params})`,
        rawContent,
        metadata: { params: params.split(',').map(p => p.trim()).filter(Boolean) },
        calls: extractCalls(rawContent, name),
      });
    }

    // Parse classes
    patterns.class.lastIndex = 0;
    while ((match = patterns.class.exec(content)) !== null) {
      const indent = match[1];
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const lineEnd = findPythonBlockEnd(content, lineStart, indent);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: `class ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    return structures;
  },
};
