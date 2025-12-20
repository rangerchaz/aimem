import type { Parser, ParsedStructure } from './base.js';
import { getLineNumber, extractLines, extractCalls } from './base.js';

const patterns = {
  // Function: returnType name(...) or returnType Class::name(...)
  // Matches: void foo(), int* bar(int x), std::string baz()
  function: /^(\s*)(?:static\s+|inline\s+|virtual\s+|explicit\s+|constexpr\s+|extern\s+)*(?:const\s+)?(?:[\w:*&<>]+\s+)+(\w+)\s*\(([^)]*)\)\s*(?:const)?\s*(?:override)?\s*(?:noexcept)?\s*(?:->[\w:*&<>\s]+)?\s*(?=\{|;)/gm,

  // class Name or struct Name
  classOrStruct: /^(\s*)(?:template\s*<[^>]+>\s*)?(?:class|struct)\s+(?:\[\[[^\]]+\]\]\s*)?(\w+)(?:\s*final)?(?:\s*:\s*(?:public|private|protected)?\s*[\w:,\s<>]+)?/gm,

  // namespace name
  namespace: /^namespace\s+(\w+)/gm,

  // enum Name or enum class Name
  enum: /^(\s*)enum\s+(?:class\s+)?(\w+)(?:\s*:\s*\w+)?/gm,

  // typedef ... name; or using name = ...
  typeAlias: /^(\s*)(?:typedef\s+.+\s+(\w+)\s*;|using\s+(\w+)\s*=)/gm,

  // #define NAME
  macro: /^#define\s+(\w+)(?:\([^)]*\))?\s/gm,
};

function findCppBlockEnd(content: string, startPos: number): number {
  let depth = 0;
  let i = startPos;
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;

  // Find opening brace
  while (i < content.length && content[i] !== '{') {
    // Handle forward declarations and prototypes
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

export const cppParser: Parser = {
  extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hxx', '.hh'],

  parse(content: string, filePath: string): ParsedStructure[] {
    const structures: ParsedStructure[] = [];
    const isHeader = /\.(h|hpp|hxx|hh)$/.test(filePath);

    // Parse classes and structs
    let match;
    patterns.classOrStruct.lastIndex = 0;
    while ((match = patterns.classOrStruct.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findCppBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      const isStruct = match[0].includes('struct');

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: match[0].trim().split(/\s*[{:]/)[0],
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: isStruct ? 'struct' : 'class' },
      });
    }

    // Parse namespaces
    patterns.namespace.lastIndex = 0;
    while ((match = patterns.namespace.exec(content)) !== null) {
      const name = match[1];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findCppBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: `namespace ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'namespace' },
      });
    }

    // Parse enums
    patterns.enum.lastIndex = 0;
    while ((match = patterns.enum.exec(content)) !== null) {
      const name = match[2];
      const lineStart = getLineNumber(content, match.index);
      const blockEnd = findCppBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);

      const isEnumClass = match[0].includes('enum class');

      structures.push({
        type: 'class',
        name,
        lineStart,
        lineEnd,
        signature: isEnumClass ? `enum class ${name}` : `enum ${name}`,
        rawContent: extractLines(content, lineStart, lineEnd),
        metadata: { kind: 'enum' },
      });
    }

    // Parse functions (more carefully to avoid false positives)
    patterns.function.lastIndex = 0;
    while ((match = patterns.function.exec(content)) !== null) {
      const indent = match[1];
      const name = match[2];
      const params = match[3];
      const lineStart = getLineNumber(content, match.index);

      // Skip if this looks like a control structure
      if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) continue;

      // Check if this is a definition (has body) or declaration (ends with ;)
      const afterMatch = content.slice(match.index + match[0].length).trim();
      const isDefinition = afterMatch.startsWith('{');

      if (!isDefinition && !isHeader) continue; // Skip declarations in source files

      const blockEnd = findCppBlockEnd(content, match.index);
      const lineEnd = getLineNumber(content, blockEnd);
      const rawContent = extractLines(content, lineStart, lineEnd);

      // Check if it's a method (has :: or indentation)
      const isMethod = indent.length > 0 || name.includes('::');

      structures.push({
        type: isMethod ? 'method' : 'function',
        name: name.includes('::') ? name.split('::').pop()! : name,
        lineStart,
        lineEnd,
        signature: `${name}(${params})`,
        rawContent,
        metadata: {
          params: params.split(',').map(p => p.trim()).filter(Boolean),
          declaration: !isDefinition,
        },
        calls: isDefinition ? extractCalls(rawContent, name) : undefined,
      });
    }

    return structures;
  },
};
