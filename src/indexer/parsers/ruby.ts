import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

const patterns = {
  // def name(...) or def self.name(...)
  method: /^\s*def\s+(self\.)?(\w+[?!=]?)\s*(?:\(([^)]*)\))?/gm,

  // class Name
  class: /^\s*class\s+(\w+)(?:\s*<\s*\w+)?/gm,

  // module Name
  module: /^\s*module\s+(\w+)/gm,
};

function findRubyBlockEnd(content: string, startLine: number): number {
  const lines = content.split('\n');
  let depth = 1;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    // Count block openers
    if (line.match(/\b(class|module|def|do|if|unless|case|while|until|for|begin)\b/) && !line.match(/\bend\b/)) {
      depth++;
    }

    // Count block closers
    if (line.match(/\bend\b/)) {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return lines.length;
}

export const rubyParser: Parser = {
  extensions: ['.rb', '.rake', '.gemspec'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];

    // Parse methods
    let match;
    patterns.method.lastIndex = 0;
    while ((match = patterns.method.exec(content)) !== null) {
      const isClassMethod = !!match[1];
      const name = match[2];
      const params = match[3] || '';
      const lineStart = getLineNumber(content, match.index);
      const lineEnd = findRubyBlockEnd(content, lineStart);

      const rawContent = extractLines(content, lineStart, lineEnd);
      structures.push({
        type: 'method',
        name: isClassMethod ? `self.${name}` : name,
        lineStart,
        lineEnd,
        signature: `def ${isClassMethod ? 'self.' : ''}${name}(${params})`,
        rawContent,
        metadata: {
          classMethod: isClassMethod,
          params: params.split(',').map(p => p.trim()).filter(Boolean),
        },
        calls: extractCalls(rawContent, name),
      });
    }

    // Parse classes
    patterns.class.lastIndex = 0;
    while ((match = patterns.class.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const lineEnd = findRubyBlockEnd(content, lineStart);

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

    // Parse modules
    patterns.module.lastIndex = 0;
    while ((match = patterns.module.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const lineEnd = findRubyBlockEnd(content, lineStart);

      structures.push({
        type: 'module',
        name,
        lineStart,
        lineEnd,
        signature: `module ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: {},
      });
    }

    return structures;
  },
};
