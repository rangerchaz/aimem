/**
 * Pattern Analyzer
 *
 * Scans the codebase and infers guardrails from patterns.
 * This is the "onboarding" for a new project.
 */

import { getAllProjectStructures, insertGuardrail, incrementDikCounter, type StructureWithFile } from '../db/index.js';
import type { ProposedRule, GuardrailCategory, Guardrail } from '../types/index.js';

interface AnalyzeOptions {
  categories?: GuardrailCategory[];
}

interface PatternCount {
  pattern: string;
  count: number;
  files: string[];
}

/**
 * Analyze a project and propose guardrails based on detected patterns.
 */
export function analyzeProject(
  projectId: number,
  options: AnalyzeOptions = {}
): ProposedRule[] {
  const categories = options.categories || ['architecture', 'naming', 'testing', 'security'];
  const structures = getAllProjectStructures(projectId);
  const proposed: ProposedRule[] = [];

  if (structures.length === 0) {
    return proposed;
  }

  for (const category of categories) {
    switch (category) {
      case 'architecture':
        proposed.push(...analyzeArchitecture(structures));
        break;
      case 'naming':
        proposed.push(...analyzeNaming(structures));
        break;
      case 'testing':
        proposed.push(...analyzeTesting(structures));
        break;
      case 'security':
        proposed.push(...analyzeSecurity(structures));
        break;
    }
  }

  return proposed;
}

/**
 * Save proposed rules as inferred guardrails.
 */
export function saveProposedRules(
  projectId: number,
  rules: ProposedRule[]
): Guardrail[] {
  const saved: Guardrail[] = [];

  for (const rule of rules) {
    const guardrail = insertGuardrail(
      projectId,
      rule.category,
      rule.rule,
      rule.rationale,
      'warn',
      'inferred',
      rule.evidence[0] || null
    );
    saved.push(guardrail);
    incrementDikCounter(projectId, 'rules_inferred');
  }

  return saved;
}

// ============ Category-specific analyzers ============

/**
 * Analyze architecture patterns.
 * - Directory conventions
 * - File type locations
 * - Module structure
 */
function analyzeArchitecture(structures: StructureWithFile[]): ProposedRule[] {
  const proposed: ProposedRule[] = [];

  // Group files by directory
  const dirPatterns = new Map<string, Set<string>>();
  for (const s of structures) {
    const parts = s.file_path.split('/');
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join('/');
      if (!dirPatterns.has(dir)) {
        dirPatterns.set(dir, new Set());
      }
      dirPatterns.get(dir)!.add(s.type);
    }
  }

  // Detect directory type conventions
  const typesByDir = new Map<string, { types: Map<string, number>; files: string[] }>();
  for (const s of structures) {
    const parts = s.file_path.split('/');
    if (parts.length > 1) {
      const dir = parts[parts.length - 2]; // Immediate parent dir
      if (!typesByDir.has(dir)) {
        typesByDir.set(dir, { types: new Map(), files: [] });
      }
      const data = typesByDir.get(dir)!;
      data.types.set(s.type, (data.types.get(s.type) || 0) + 1);
      if (!data.files.includes(s.file_path)) {
        data.files.push(s.file_path);
      }
    }
  }

  // Find directories with consistent patterns
  for (const [dir, data] of typesByDir) {
    const total = Array.from(data.types.values()).reduce((a, b) => a + b, 0);
    for (const [type, count] of data.types) {
      const ratio = count / total;
      if (ratio > 0.7 && count >= 3) {
        proposed.push({
          category: 'architecture',
          rule: `${type}s belong in the \`${dir}/\` directory`,
          rationale: `${Math.round(ratio * 100)}% of structures in ${dir}/ are ${type}s`,
          confidence: ratio,
          evidence: data.files.slice(0, 3),
        });
      }
    }
  }

  return proposed;
}

/**
 * Analyze naming patterns.
 * - Case conventions
 * - Prefix/suffix patterns
 * - File naming
 */
function analyzeNaming(structures: StructureWithFile[]): ProposedRule[] {
  const proposed: ProposedRule[] = [];

  // Analyze function naming conventions
  const functions = structures.filter(s => s.type === 'function' || s.type === 'method');

  if (functions.length >= 5) {
    const casePatterns = detectCasePatterns(functions.map(f => f.name));

    if (casePatterns.dominant && casePatterns.ratio > 0.7) {
      proposed.push({
        category: 'naming',
        rule: `Functions use ${casePatterns.dominant} naming`,
        rationale: `${Math.round(casePatterns.ratio * 100)}% of functions follow this pattern`,
        confidence: casePatterns.ratio,
        evidence: functions.slice(0, 3).map(f => f.file_path),
      });
    }
  }

  // Analyze class naming conventions
  const classes = structures.filter(s => s.type === 'class');

  if (classes.length >= 3) {
    const casePatterns = detectCasePatterns(classes.map(c => c.name));

    if (casePatterns.dominant && casePatterns.ratio > 0.8) {
      proposed.push({
        category: 'naming',
        rule: `Classes use ${casePatterns.dominant} naming`,
        rationale: `${Math.round(casePatterns.ratio * 100)}% of classes follow this pattern`,
        confidence: casePatterns.ratio,
        evidence: classes.slice(0, 3).map(c => c.file_path),
      });
    }
  }

  // Detect common prefixes
  const prefixGroups = detectPrefixes(functions.map(f => f.name));
  for (const [prefix, data] of prefixGroups) {
    if (data.count >= 5 && prefix.length >= 2) {
      proposed.push({
        category: 'naming',
        rule: `Functions that ${describePrefix(prefix)} should start with \`${prefix}\``,
        rationale: `${data.count} functions use the ${prefix} prefix`,
        confidence: 0.6,
        evidence: data.examples.slice(0, 3),
      });
    }
  }

  return proposed;
}

/**
 * Analyze testing patterns.
 * - Test file locations
 * - Test naming
 * - Setup/teardown patterns
 */
function analyzeTesting(structures: StructureWithFile[]): ProposedRule[] {
  const proposed: ProposedRule[] = [];

  // Find test files
  const testFiles = new Set<string>();
  const testPatterns = new Map<string, number>();

  for (const s of structures) {
    const path = s.file_path.toLowerCase();
    if (path.includes('test') || path.includes('spec')) {
      testFiles.add(s.file_path);

      // Detect test location pattern
      if (path.includes('__tests__')) {
        testPatterns.set('__tests__/', (testPatterns.get('__tests__/') || 0) + 1);
      } else if (path.includes('/test/')) {
        testPatterns.set('test/', (testPatterns.get('test/') || 0) + 1);
      } else if (path.includes('/tests/')) {
        testPatterns.set('tests/', (testPatterns.get('tests/') || 0) + 1);
      } else if (path.includes('.test.') || path.includes('.spec.')) {
        testPatterns.set('colocated', (testPatterns.get('colocated') || 0) + 1);
      }
    }
  }

  // Find dominant test location pattern
  let maxPattern = '';
  let maxCount = 0;
  for (const [pattern, count] of testPatterns) {
    if (count > maxCount) {
      maxPattern = pattern;
      maxCount = count;
    }
  }

  if (maxCount >= 3 && testFiles.size > 0) {
    const rule = maxPattern === 'colocated'
      ? 'Tests are colocated with source files (*.test.* or *.spec.*)'
      : `Tests belong in the \`${maxPattern}\` directory`;

    proposed.push({
      category: 'testing',
      rule,
      rationale: `${maxCount} test files follow this pattern`,
      confidence: maxCount / testFiles.size,
      evidence: Array.from(testFiles).slice(0, 3),
    });
  }

  return proposed;
}

/**
 * Analyze security patterns.
 * - Auth patterns
 * - Input validation
 * - Secrets handling
 */
function analyzeSecurity(structures: StructureWithFile[]): ProposedRule[] {
  const proposed: ProposedRule[] = [];

  // Look for auth middleware patterns
  const authPatterns = structures.filter(s => {
    const name = s.name.toLowerCase();
    const content = s.raw_content.toLowerCase();
    return name.includes('auth') || name.includes('middleware') ||
           content.includes('authenticate') || content.includes('authorize');
  });

  if (authPatterns.length >= 2) {
    proposed.push({
      category: 'security',
      rule: 'Authentication must use the established auth middleware pattern',
      rationale: `Found ${authPatterns.length} auth-related structures to match`,
      confidence: 0.7,
      evidence: authPatterns.slice(0, 3).map(s => s.file_path),
    });
  }

  // Look for validation patterns
  const validationPatterns = structures.filter(s => {
    const name = s.name.toLowerCase();
    const content = s.raw_content.toLowerCase();
    return name.includes('validat') || name.includes('sanitiz') ||
           content.includes('validate') || content.includes('sanitize');
  });

  if (validationPatterns.length >= 3) {
    proposed.push({
      category: 'security',
      rule: 'User input must be validated using the existing validation patterns',
      rationale: `Found ${validationPatterns.length} validation structures`,
      confidence: 0.6,
      evidence: validationPatterns.slice(0, 3).map(s => s.file_path),
    });
  }

  return proposed;
}

// ============ Helper functions ============

function detectCasePatterns(names: string[]): { dominant: string | null; ratio: number } {
  const patterns = {
    camelCase: 0,
    snake_case: 0,
    PascalCase: 0,
    'kebab-case': 0,
  };

  for (const name of names) {
    if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) {
      patterns.camelCase++;
    } else if (/^[a-z][a-z0-9_]*$/.test(name) && name.includes('_')) {
      patterns.snake_case++;
    } else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      patterns.PascalCase++;
    } else if (/^[a-z][a-z0-9-]*$/.test(name) && name.includes('-')) {
      patterns['kebab-case']++;
    }
  }

  let dominant: string | null = null;
  let maxCount = 0;

  for (const [pattern, count] of Object.entries(patterns)) {
    if (count > maxCount) {
      dominant = pattern;
      maxCount = count;
    }
  }

  return {
    dominant,
    ratio: names.length > 0 ? maxCount / names.length : 0,
  };
}

function detectPrefixes(names: string[]): Map<string, { count: number; examples: string[] }> {
  const prefixes = new Map<string, { count: number; examples: string[] }>();
  const commonPrefixes = ['get', 'set', 'is', 'has', 'can', 'should', 'create', 'delete', 'update', 'fetch', 'load', 'save', 'find', 'handle', 'on', 'use'];

  for (const name of names) {
    for (const prefix of commonPrefixes) {
      if (name.toLowerCase().startsWith(prefix) && name.length > prefix.length) {
        const nextChar = name[prefix.length];
        // Check if it's a proper prefix (followed by uppercase or underscore)
        if (nextChar === nextChar.toUpperCase() || nextChar === '_') {
          if (!prefixes.has(prefix)) {
            prefixes.set(prefix, { count: 0, examples: [] });
          }
          const data = prefixes.get(prefix)!;
          data.count++;
          if (data.examples.length < 5) {
            data.examples.push(name);
          }
          break;
        }
      }
    }
  }

  return prefixes;
}

function describePrefix(prefix: string): string {
  const descriptions: Record<string, string> = {
    get: 'retrieve data',
    set: 'set values',
    is: 'check boolean conditions',
    has: 'check existence',
    can: 'check permissions',
    should: 'check conditions',
    create: 'create new entities',
    delete: 'remove entities',
    update: 'modify entities',
    fetch: 'fetch remote data',
    load: 'load data',
    save: 'persist data',
    find: 'search for entities',
    handle: 'handle events',
    on: 'respond to events',
    use: 'are React hooks',
  };
  return descriptions[prefix] || `perform ${prefix} operations`;
}
