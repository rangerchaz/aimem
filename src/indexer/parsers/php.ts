import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

const patterns = {
  // function name(...) or public function name(...)
  function: /^(\s*)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:final\s+)?(?:abstract\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm,

  // class Name or abstract class Name
  class: /^(\s*)(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s\\]+)?/gm,

  // interface Name
  interface: /^(\s*)interface\s+(\w+)(?:\s+extends\s+[\w,\s\\]+)?/gm,

  // trait Name
  trait: /^(\s*)trait\s+(\w+)/gm,

  // enum Name (PHP 8.1+)
  enum: /^(\s*)enum\s+(\w+)(?:\s*:\s*\w+)?(?:\s+implements\s+[\w,\s\\]+)?/gm,

  // namespace Name\Space
  namespace: /^namespace\s+([\w\\]+)\s*;/gm,

  // const NAME = ...
  constant: /^(\s*)(?:public\s+|private\s+|protected\s+)?const\s+(\w+)\s*=/gm,
};

function findPhpBlockEnd(content: string, startPos: number): number {
  let depth = 0;
  let i = startPos;
  let inString = false;
  let inHeredoc = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  // Find opening brace
  while (i < content.length && content[i] !== '{') {
    // Handle abstract methods with no body
    if (content[i] === ';') return i + 1;
    i++;
  }
  if (i >= content.length) return content.length;

  // Find matching closing brace
  for (; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1] || '';
    const prevChar = content[i - 1] || '';

    // Handle comments
    if (!inString && !inHeredoc) {
      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if ((char === '/' && nextChar === '/') || char === '#') {
        inLineComment = true;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        continue;
      }
    }

    // Handle strings
    if (!inBlockComment && !inLineComment && !inHeredoc) {
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }
    }

    if (inString || inHeredoc) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return content.length;
}

export const phpParser: Parser = {
  extensions: ['.php', '.phtml', '.php5', '.php7', '.php8'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];

    // Parse classes
    let match;
    patterns.class.lastIndex = 0;
    while ((match = patterns.class.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findPhpBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      const isAbstract = match[0].includes('abstract');

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: match[0].trim(),
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { abstract: isAbstract },
      });
    }

    // Parse interfaces
    patterns.interface.lastIndex = 0;
    while ((match = patterns.interface.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findPhpBlockEnd(content, match.index);
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

    // Parse traits
    patterns.trait.lastIndex = 0;
    while ((match = patterns.trait.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findPhpBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: `trait ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'trait' },
      });
    }

    // Parse enums
    patterns.enum.lastIndex = 0;
    while ((match = patterns.enum.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findPhpBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: match[0].trim(),
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'enum' },
      });
    }

    // Parse functions
    patterns.function.lastIndex = 0;
    while ((match = patterns.function.exec(content)) !== null) {
      const indent = match[1];
      const name = match[2];
      const params = match[3];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findPhpBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);
      const rawContent = extractLines(content, lineStart, lineEnd);

      // Check if it's a method (inside class - has indentation)
      const isMethod = indent.length > 0;

      // Skip magic methods for cleaner output (optional)
      // if (name.startsWith('__')) continue;

      structures.push({
        type: isMethod ? 'method' : 'function',
        name,
        lineStart,
        lineEnd,
        signature: `function ${name}(${params})`,
        rawContent,
        metadata: { params: params.split(',').map(p => p.trim()).filter(Boolean) },
        calls: extractCalls(rawContent, name),
      });
    }

    return structures;
  },
};
