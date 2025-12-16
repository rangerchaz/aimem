import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines } from './base.js';

const patterns = {
  // func name(...) or func (r Receiver) name(...)
  function: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\([^)]*\)|[\w\[\]]+|\*\w+)?/gm,

  // type Name struct
  struct: /^type\s+(\w+)\s+struct\s*\{/gm,

  // type Name interface
  interface: /^type\s+(\w+)\s+interface\s*\{/gm,

  // type Name = ... or type Name ...
  typeAlias: /^type\s+(\w+)\s+(?!=)/gm,
};

function findGoBlockEnd(content: string, startPos: number): number {
  let depth = 0;
  let i = startPos;

  // Find opening brace
  while (i < content.length && content[i] !== '{') i++;
  if (i >= content.length) return content.length;

  // Find matching closing brace
  for (; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return content.length;
}

export const goParser: Parser = {
  extensions: ['.go'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];

    // Parse functions
    let match;
    patterns.function.lastIndex = 0;
    while ((match = patterns.function.exec(content)) !== null) {
      const name = match[1];
      const params = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findGoBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      // Check if it's a method (has receiver)
      const isMethod = match[0].includes(') ' + name);

      structures.push({
        type: isMethod ? 'method' : 'function',
        name,
        lineStart,
        lineEnd,
        signature: match[0].trim(),
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {
          params: params.split(',').map(p => p.trim()).filter(Boolean),
        },
      });
    }

    // Parse structs
    patterns.struct.lastIndex = 0;
    while ((match = patterns.struct.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findGoBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class', // Using 'class' for struct
        name,
        lineStart,
        lineEnd,
        signature: `type ${name} struct`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'struct' },
      });
    }

    // Parse interfaces
    patterns.interface.lastIndex = 0;
    while ((match = patterns.interface.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findGoBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'interface',
        name,
        lineStart,
        lineEnd,
        signature: `type ${name} interface`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    return structures;
  },
};
