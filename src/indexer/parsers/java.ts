import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

const patterns = {
  // class Name or public class Name extends Foo implements Bar
  class: /^(\s*)(?:public\s+|private\s+|protected\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+\w+(?:<[^>]+>)?)?(?:\s+implements\s+[\w,\s<>]+)?/gm,

  // interface Name
  interface: /^(\s*)(?:public\s+|private\s+|protected\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+[\w,\s<>]+)?/gm,

  // enum Name
  enum: /^(\s*)(?:public\s+|private\s+|protected\s+)?enum\s+(\w+)/gm,

  // method: public void name(...) or private static String name(...)
  method: /^(\s+)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?(?:native\s+)?(?:<[^>]+>\s+)?(\w+(?:<[^>]+>)?(?:\[\])?)\s+(\w+)\s*\(([^)]*)\)/gm,

  // record Name (Java 14+)
  record: /^(\s*)(?:public\s+|private\s+|protected\s+)?record\s+(\w+)(?:<[^>]+>)?\s*\(([^)]*)\)/gm,

  // @interface Name (annotation)
  annotation: /^(\s*)(?:public\s+|private\s+|protected\s+)?@interface\s+(\w+)/gm,
};

function findJavaBlockEnd(content: string, startPos: number): number {
  let depth = 0;
  let i = startPos;
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;

  // Find opening brace
  while (i < content.length && content[i] !== '{') {
    // Handle interface/abstract methods with no body
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
    if (!inString && !inChar) {
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

    // Handle strings and chars
    if (!inBlockComment && !inLineComment) {
      if (char === '"' && prevChar !== '\\') {
        inString = !inString;
        continue;
      }
      if (char === "'" && prevChar !== '\\') {
        inChar = !inChar;
        continue;
      }
    }

    if (inString || inChar) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return content.length;
}

export const javaParser: Parser = {
  extensions: ['.java'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];

    // Parse classes
    let match;
    patterns.class.lastIndex = 0;
    while ((match = patterns.class.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findJavaBlockEnd(content, match.index);
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
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findJavaBlockEnd(content, match.index);
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

    // Parse enums
    patterns.enum.lastIndex = 0;
    while ((match = patterns.enum.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findJavaBlockEnd(content, match.index);
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

    // Parse records
    patterns.record.lastIndex = 0;
    while ((match = patterns.record.exec(content)) !== null) {
      const name = match[2];
      const params = match[3];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findJavaBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: `record ${name}(${params})`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'record' },
      });
    }

    // Parse annotations
    patterns.annotation.lastIndex = 0;
    while ((match = patterns.annotation.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findJavaBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'interface',
        name,
        lineStart,
        lineEnd,
        signature: `@interface ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'annotation' },
      });
    }

    // Parse methods
    patterns.method.lastIndex = 0;
    while ((match = patterns.method.exec(content)) !== null) {
      const returnType = match[2];
      const name = match[3];
      const params = match[4];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findJavaBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);
      const rawContent = extractLines(content, lineStart, lineEnd);

      // Skip constructors (return type matches class name pattern)
      if (returnType === name) continue;

      structures.push({
        type: 'method',
        name,
        lineStart,
        lineEnd,
        signature: `${returnType} ${name}(${params})`,
        rawContent,
        metadata: {
          returnType,
          params: params.split(',').map(p => p.trim()).filter(Boolean),
        },
        calls: extractCalls(rawContent, name),
      });
    }

    return structures;
  },
};
