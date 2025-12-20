import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

const patterns = {
  // fun name(...) or suspend fun name(...)
  function: /^(\s*)(?:private\s+|public\s+|protected\s+|internal\s+)?(?:inline\s+)?(?:suspend\s+)?(?:override\s+)?fun\s+(?:<[^>]+>\s+)?(\w+)\s*\(([^)]*)\)/gm,

  // class Name or data class Name
  class: /^(\s*)(?:private\s+|public\s+|protected\s+|internal\s+)?(?:abstract\s+|open\s+|sealed\s+|data\s+|inner\s+|enum\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s*\([^)]*\))?(?:\s*:\s*[\w<>,\s()]+)?/gm,

  // interface Name
  interface: /^(\s*)(?:private\s+|public\s+|protected\s+|internal\s+)?(?:sealed\s+)?interface\s+(\w+)(?:<[^>]+>)?/gm,

  // object Name
  object: /^(\s*)(?:private\s+|public\s+|protected\s+|internal\s+)?(?:companion\s+)?object\s+(\w+)?/gm,

  // typealias Name = ...
  typeAlias: /^(\s*)(?:private\s+|public\s+|protected\s+|internal\s+)?typealias\s+(\w+)(?:<[^>]+>)?\s*=/gm,

  // val/var name: Type (property)
  property: /^(\s*)(?:private\s+|public\s+|protected\s+|internal\s+)?(?:override\s+)?(?:lateinit\s+)?(?:val|var)\s+(\w+)\s*:/gm,
};

function findKotlinBlockEnd(content: string, startPos: number): number {
  let depth = 0;
  let i = startPos;
  let inString = false;
  let inRawString = false;
  let inLineComment = false;
  let inBlockComment = false;

  // Find opening brace or check for expression body
  while (i < content.length && content[i] !== '{') {
    // Handle expression bodies (fun foo() = expr)
    if (content[i] === '=' && content[i - 1] === ')') {
      // Find end of expression (next newline not in parens)
      let parenDepth = 0;
      for (let j = i + 1; j < content.length; j++) {
        if (content[j] === '(') parenDepth++;
        if (content[j] === ')') parenDepth--;
        if (content[j] === '\n' && parenDepth === 0) return j;
      }
      return content.length;
    }
    i++;
  }
  if (i >= content.length) return content.length;

  // Find matching closing brace
  for (; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1] || '';
    const prevChar = content[i - 1] || '';

    // Handle comments
    if (!inString && !inRawString) {
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
      if (char === '/' && nextChar === '/') {
        inLineComment = true;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        continue;
      }
    }

    // Handle strings
    if (!inBlockComment && !inLineComment) {
      if (char === '"' && nextChar === '"' && content[i + 2] === '"') {
        inRawString = !inRawString;
        i += 2;
        continue;
      }
      if (!inRawString && char === '"' && prevChar !== '\\') {
        inString = !inString;
        continue;
      }
    }

    if (inString || inRawString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return content.length;
}

export const kotlinParser: Parser = {
  extensions: ['.kt', '.kts'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];

    // Parse functions
    let match;
    patterns.function.lastIndex = 0;
    while ((match = patterns.function.exec(content)) !== null) {
      const indent = match[1];
      const name = match[2];
      const params = match[3];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findKotlinBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);
      const rawContent = extractLines(content, lineStart, lineEnd);

      // Check if it's a method (inside class - has indentation)
      const isMethod = indent.length > 0;

      structures.push({
        type: isMethod ? 'method' : 'function',
        name,
        lineStart,
        lineEnd,
        signature: `fun ${name}(${params})`,
        rawContent,
        metadata: { params: params.split(',').map(p => p.trim()).filter(Boolean) },
        calls: extractCalls(rawContent, name),
      });
    }

    // Parse classes
    patterns.class.lastIndex = 0;
    while ((match = patterns.class.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findKotlinBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      const isDataClass = match[0].includes('data class');
      const isEnumClass = match[0].includes('enum class');

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: match[0].trim().split(/\s*[({:]/)[0],
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {
          kind: isDataClass ? 'data' : isEnumClass ? 'enum' : 'class',
        },
      });
    }

    // Parse interfaces
    patterns.interface.lastIndex = 0;
    while ((match = patterns.interface.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findKotlinBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'interface',
        name,
        lineStart,
        lineEnd,
        signature: `interface ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    // Parse objects
    patterns.object.lastIndex = 0;
    while ((match = patterns.object.exec(content)) !== null) {
      const name = match[2] || 'companion';
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findKotlinBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      const isCompanion = match[0].includes('companion');

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: isCompanion ? 'companion object' : `object ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'object', companion: isCompanion },
      });
    }

    return structures;
  },
};
