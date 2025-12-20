import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

const patterns = {
  // fn name(...) or pub fn name(...) or async fn name(...)
  function: /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]+"\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/gm,

  // struct Name or pub struct Name
  struct: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)(?:<[^>]+>)?/gm,

  // impl Name or impl Trait for Name
  impl: /^impl(?:<[^>]+>)?\s+(?:(\w+)\s+for\s+)?(\w+)(?:<[^>]+>)?/gm,

  // trait Name
  trait: /^(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)(?:<[^>]+>)?/gm,

  // enum Name
  enum: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)(?:<[^>]+>)?/gm,

  // type Name = ...
  typeAlias: /^(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/gm,

  // mod name
  module: /^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/gm,
};

function findRustBlockEnd(content: string, startPos: number): number {
  let depth = 0;
  let i = startPos;
  let inString = false;
  let inRawString = false;
  let inLineComment = false;
  let inBlockComment = false;

  // Find opening brace
  while (i < content.length && content[i] !== '{') {
    // Handle semicolon-only declarations (like mod name;)
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
      if (char === 'r' && nextChar === '#') {
        inRawString = true;
        continue;
      }
      if (inRawString && char === '#' && prevChar === '"') {
        inRawString = false;
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

export const rustParser: Parser = {
  extensions: ['.rs'],

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
      const blockEnd = findRustBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);
      const rawContent = extractLines(content, lineStart, lineEnd);

      // Check if it's a method (inside impl block - has indentation)
      const isMethod = indent.length > 0;

      structures.push({
        type: isMethod ? 'method' : 'function',
        name,
        lineStart,
        lineEnd,
        signature: `fn ${name}(${params})`,
        rawContent,
        metadata: { params: params.split(',').map(p => p.trim()).filter(Boolean) },
        calls: extractCalls(rawContent, name),
      });
    }

    // Parse structs
    patterns.struct.lastIndex = 0;
    while ((match = patterns.struct.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findRustBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: `struct ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'struct' },
      });
    }

    // Parse traits
    patterns.trait.lastIndex = 0;
    while ((match = patterns.trait.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findRustBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'interface',
        name,
        lineStart,
        lineEnd,
        signature: `trait ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    // Parse enums
    patterns.enum.lastIndex = 0;
    while ((match = patterns.enum.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findRustBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: `enum ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'enum' },
      });
    }

    // Parse impl blocks
    patterns.impl.lastIndex = 0;
    while ((match = patterns.impl.exec(content)) !== null) {
      const traitName = match[1];
      const typeName = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findRustBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      const name = traitName ? `${traitName} for ${typeName}` : typeName;

      structures.push({
        type: 'class',
        name: `impl ${name}`,
        lineStart,
        lineEnd,
        signature: `impl ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'impl', trait: traitName, type: typeName },
      });
    }

    return structures;
  },
};
