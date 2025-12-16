import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

// Patterns for JavaScript/TypeScript
const patterns = {
  // function name(...) or async function name(...)
  function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,

  // const/let/var name = function(...) or arrow function
  arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g,

  // class Name
  class: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/g,

  // Method inside class: name(...) or async name(...)
  method: /^\s*(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+)?\s*\{/gm,

  // interface Name
  interface: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?/g,

  // type Name =
  typeAlias: /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=/g,
};

function findBlockEnd(content: string, startPos: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let i = startPos;

  // Find opening brace
  while (i < content.length && content[i] !== '{') i++;
  if (i >= content.length) return content.length;

  // Find matching closing brace
  for (; i < content.length; i++) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : '';

    if (inString) {
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return content.length;
}

export const javascriptParser: Parser = {
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];
    const lines = content.split('\n');

    // Parse functions
    let match;
    patterns.function.lastIndex = 0;
    while ((match = patterns.function.exec(content)) !== null) {
      const name = match[1];
      const params = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);
      const rawContent = extractLines(content, lineStart, lineEnd);

      structures.push({
        type: 'function',
        name,
        lineStart,
        lineEnd,
        signature: `function ${name}(${params})`,
        rawContent,
        metadata: { params: params.split(',').map(p => p.trim()).filter(Boolean) },
        calls: extractCalls(rawContent, name),
      });
    }

    // Parse arrow functions
    patterns.arrowFunction.lastIndex = 0;
    while ((match = patterns.arrowFunction.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);
      const rawContent = extractLines(content, lineStart, lineEnd);

      structures.push({
        type: 'function',
        name,
        lineStart,
        lineEnd,
        signature: `const ${name} = () => ...`,
        rawContent,
        metadata: { arrow: true },
        calls: extractCalls(rawContent, name),
      });
    }

    // Parse classes
    patterns.class.lastIndex = 0;
    while ((match = patterns.class.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: match[0].trim(),
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    // Parse interfaces
    patterns.interface.lastIndex = 0;
    while ((match = patterns.interface.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'interface',
        name,
        lineStart,
        lineEnd,
        signature: match[0].trim(),
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    // Parse type aliases
    patterns.typeAlias.lastIndex = 0;
    while ((match = patterns.typeAlias.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      // Type aliases end at semicolon or next line with different indent
      let lineEnd = lineStart;
      for (let i = lineStart; i < lines.length; i++) {
        if (lines[i].includes(';') || (i > lineStart && !lines[i].startsWith(' ') && !lines[i].startsWith('\t'))) {
          lineEnd = i + 1;
          break;
        }
      }

      structures.push({
        type: 'type',
        name,
        lineStart,
        lineEnd,
        signature: `type ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    return structures;
  },
};
