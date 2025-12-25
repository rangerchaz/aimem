/**
 * Linter Import
 *
 * Imports rules from existing linter configurations and converts them to guardrails.
 * Supports: ESLint, RuboCop, Ruff/Black/isort (pyproject.toml), Prettier
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { insertGuardrail, incrementDikCounter } from '../db/index.js';
import type { Guardrail, GuardrailCategory } from '../types/index.js';

export interface LinterConfig {
  type: string;
  path: string;
  rules: ImportedRule[];
}

export interface ImportedRule {
  category: GuardrailCategory;
  rule: string;
  rationale: string;
  source: string;
}

interface ImportResult {
  configs: LinterConfig[];
  totalRules: number;
  saved: Guardrail[];
}

/**
 * Scan project for linter configs and import rules.
 */
export function importLinterRules(
  projectId: number,
  projectPath: string,
  options: { dryRun?: boolean } = {}
): ImportResult {
  const configs: LinterConfig[] = [];

  // ESLint
  const eslintConfig = findAndParseEslint(projectPath);
  if (eslintConfig) configs.push(eslintConfig);

  // RuboCop
  const rubocopConfig = findAndParseRubocop(projectPath);
  if (rubocopConfig) configs.push(rubocopConfig);

  // Python (pyproject.toml)
  const pythonConfig = findAndParsePyproject(projectPath);
  if (pythonConfig) configs.push(pythonConfig);

  // Prettier
  const prettierConfig = findAndParsePrettier(projectPath);
  if (prettierConfig) configs.push(prettierConfig);

  // TSConfig
  const tsConfig = findAndParseTsconfig(projectPath);
  if (tsConfig) configs.push(tsConfig);

  const totalRules = configs.reduce((sum, c) => sum + c.rules.length, 0);
  const saved: Guardrail[] = [];

  if (!options.dryRun) {
    for (const config of configs) {
      for (const rule of config.rules) {
        const guardrail = insertGuardrail(
          projectId,
          rule.category,
          rule.rule,
          rule.rationale,
          'warn',
          'imported',
          rule.source
        );
        saved.push(guardrail);
        incrementDikCounter(projectId, 'rules_inferred');
      }
    }
  }

  return { configs, totalRules, saved };
}

// ============ ESLint ============

function findAndParseEslint(projectPath: string): LinterConfig | null {
  const files = [
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    '.eslintrc',
    'eslint.config.js',
    'eslint.config.mjs',
  ];

  for (const file of files) {
    const filePath = join(projectPath, file);
    if (existsSync(filePath)) {
      try {
        const rules = parseEslintConfig(filePath, file);
        if (rules.length > 0) {
          return { type: 'eslint', path: filePath, rules };
        }
      } catch {
        // Skip unparseable configs
      }
    }
  }

  // Check package.json for eslintConfig
  const packagePath = join(projectPath, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
      if (pkg.eslintConfig) {
        const rules = extractEslintRules(pkg.eslintConfig, packagePath);
        if (rules.length > 0) {
          return { type: 'eslint', path: packagePath, rules };
        }
      }
    } catch {
      // Skip
    }
  }

  return null;
}

function parseEslintConfig(filePath: string, fileName: string): ImportedRule[] {
  if (fileName.endsWith('.json') || fileName === '.eslintrc') {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);
      return extractEslintRules(config, filePath);
    } catch {
      return [];
    }
  }

  if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) {
    // Basic YAML parsing for simple configs
    try {
      const content = readFileSync(filePath, 'utf-8');
      const config = parseSimpleYaml(content);
      return extractEslintRules(config, filePath);
    } catch {
      return [];
    }
  }

  // For JS configs, we can't easily parse them, but we note their existence
  return [{
    category: 'design',
    rule: 'Follow ESLint configuration',
    rationale: `ESLint config exists at ${fileName}`,
    source: filePath,
  }];
}

function extractEslintRules(config: Record<string, unknown>, source: string): ImportedRule[] {
  const rules: ImportedRule[] = [];
  const eslintRules = config.rules as Record<string, unknown> | undefined;

  if (!eslintRules) {
    // Just note that ESLint is configured
    if (config.extends || config.plugins) {
      rules.push({
        category: 'design',
        rule: 'Follow ESLint configuration',
        rationale: `Extends: ${JSON.stringify(config.extends || config.plugins)}`,
        source,
      });
    }
    return rules;
  }

  // Map important ESLint rules to guardrails
  const ruleMapping: Record<string, { category: GuardrailCategory; description: string }> = {
    'no-console': { category: 'design', description: 'Avoid console.log in production code' },
    'no-debugger': { category: 'design', description: 'No debugger statements' },
    'no-unused-vars': { category: 'design', description: 'No unused variables' },
    'no-var': { category: 'design', description: 'Use const/let instead of var' },
    'prefer-const': { category: 'design', description: 'Use const when variable is not reassigned' },
    'eqeqeq': { category: 'design', description: 'Use === and !== instead of == and !=' },
    'curly': { category: 'design', description: 'Use curly braces for all control statements' },
    'no-eval': { category: 'security', description: 'Never use eval()' },
    'no-implied-eval': { category: 'security', description: 'No implied eval via setTimeout/setInterval strings' },
    'no-new-func': { category: 'security', description: 'No Function constructor' },
    'camelcase': { category: 'naming', description: 'Use camelCase for identifiers' },
    'new-cap': { category: 'naming', description: 'Constructors must start with capital letter' },
    '@typescript-eslint/naming-convention': { category: 'naming', description: 'Follow TypeScript naming conventions' },
    '@typescript-eslint/no-explicit-any': { category: 'design', description: 'Avoid using `any` type' },
    '@typescript-eslint/explicit-function-return-type': { category: 'design', description: 'Functions must have explicit return types' },
  };

  for (const [ruleName, ruleValue] of Object.entries(eslintRules)) {
    // Check if rule is enabled (not 'off' or 0)
    const isEnabled = Array.isArray(ruleValue)
      ? ruleValue[0] !== 'off' && ruleValue[0] !== 0
      : ruleValue !== 'off' && ruleValue !== 0;

    if (isEnabled && ruleMapping[ruleName]) {
      const mapping = ruleMapping[ruleName];
      rules.push({
        category: mapping.category,
        rule: mapping.description,
        rationale: `ESLint rule: ${ruleName}`,
        source,
      });
    }
  }

  return rules;
}

// ============ RuboCop ============

function findAndParseRubocop(projectPath: string): LinterConfig | null {
  const filePath = join(projectPath, '.rubocop.yml');
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const rules = parseRubocopConfig(content, filePath);
    if (rules.length > 0) {
      return { type: 'rubocop', path: filePath, rules };
    }
  } catch {
    // Skip
  }

  return null;
}

function parseRubocopConfig(content: string, source: string): ImportedRule[] {
  const rules: ImportedRule[] = [];

  // Parse key cops from RuboCop config
  const copMapping: Record<string, { category: GuardrailCategory; description: string }> = {
    'Style/StringLiterals': { category: 'design', description: 'Use consistent string quote style' },
    'Style/FrozenStringLiteralComment': { category: 'design', description: 'Include frozen_string_literal comment' },
    'Style/Documentation': { category: 'design', description: 'Document classes and modules' },
    'Naming/MethodName': { category: 'naming', description: 'Follow Ruby method naming conventions' },
    'Naming/VariableName': { category: 'naming', description: 'Follow Ruby variable naming conventions' },
    'Naming/ClassAndModuleCamelCase': { category: 'naming', description: 'Use CamelCase for classes and modules' },
    'Security/Eval': { category: 'security', description: 'Never use eval' },
    'Security/Open': { category: 'security', description: 'Be careful with Kernel#open' },
    'Security/YAMLLoad': { category: 'security', description: 'Use YAML.safe_load instead of YAML.load' },
    'Metrics/MethodLength': { category: 'design', description: 'Keep methods short' },
    'Metrics/ClassLength': { category: 'architecture', description: 'Keep classes focused and small' },
  };

  for (const [cop, mapping] of Object.entries(copMapping)) {
    // Check if cop is mentioned and enabled
    const copPattern = new RegExp(`^${cop.replace('/', '/')}:`, 'm');
    if (copPattern.test(content)) {
      // Check if it's not disabled
      const disabledPattern = new RegExp(`${cop.replace('/', '/')}:[\\s\\S]*?Enabled:\\s*false`, 'm');
      if (!disabledPattern.test(content)) {
        rules.push({
          category: mapping.category,
          rule: mapping.description,
          rationale: `RuboCop cop: ${cop}`,
          source,
        });
      }
    }
  }

  // If no specific cops found but file exists, add general rule
  if (rules.length === 0) {
    rules.push({
      category: 'design',
      rule: 'Follow RuboCop configuration',
      rationale: 'RuboCop config exists',
      source,
    });
  }

  return rules;
}

// ============ Python (pyproject.toml) ============

function findAndParsePyproject(projectPath: string): LinterConfig | null {
  const filePath = join(projectPath, 'pyproject.toml');
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const rules = parsePyprojectConfig(content, filePath);
    if (rules.length > 0) {
      return { type: 'python', path: filePath, rules };
    }
  } catch {
    // Skip
  }

  return null;
}

function parsePyprojectConfig(content: string, source: string): ImportedRule[] {
  const rules: ImportedRule[] = [];

  // Check for ruff
  if (content.includes('[tool.ruff]')) {
    rules.push({
      category: 'design',
      rule: 'Follow Ruff linting rules',
      rationale: 'Ruff configured in pyproject.toml',
      source,
    });

    // Check for specific ruff rules
    if (content.includes('select') && content.includes('"E"')) {
      rules.push({
        category: 'design',
        rule: 'Fix pycodestyle errors',
        rationale: 'Ruff E rules enabled',
        source,
      });
    }
    if (content.includes('"F"')) {
      rules.push({
        category: 'design',
        rule: 'Fix Pyflakes errors',
        rationale: 'Ruff F rules enabled',
        source,
      });
    }
    if (content.includes('"S"')) {
      rules.push({
        category: 'security',
        rule: 'Follow Bandit security rules',
        rationale: 'Ruff S (security) rules enabled',
        source,
      });
    }
    if (content.includes('"N"')) {
      rules.push({
        category: 'naming',
        rule: 'Follow PEP8 naming conventions',
        rationale: 'Ruff N (naming) rules enabled',
        source,
      });
    }
  }

  // Check for black
  if (content.includes('[tool.black]')) {
    rules.push({
      category: 'design',
      rule: 'Format code with Black',
      rationale: 'Black configured in pyproject.toml',
      source,
    });

    // Extract line length if specified
    const lineLengthMatch = content.match(/line-length\s*=\s*(\d+)/);
    if (lineLengthMatch) {
      rules.push({
        category: 'design',
        rule: `Maximum line length is ${lineLengthMatch[1]} characters`,
        rationale: 'Black line-length setting',
        source,
      });
    }
  }

  // Check for isort
  if (content.includes('[tool.isort]')) {
    rules.push({
      category: 'design',
      rule: 'Sort imports with isort',
      rationale: 'isort configured in pyproject.toml',
      source,
    });
  }

  // Check for mypy
  if (content.includes('[tool.mypy]')) {
    rules.push({
      category: 'design',
      rule: 'Code must pass mypy type checking',
      rationale: 'mypy configured in pyproject.toml',
      source,
    });

    if (content.includes('strict = true') || content.includes('strict=true')) {
      rules.push({
        category: 'design',
        rule: 'Use strict type annotations',
        rationale: 'mypy strict mode enabled',
        source,
      });
    }
  }

  return rules;
}

// ============ Prettier ============

function findAndParsePrettier(projectPath: string): LinterConfig | null {
  const files = [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    'prettier.config.js',
    'prettier.config.cjs',
  ];

  for (const file of files) {
    const filePath = join(projectPath, file);
    if (existsSync(filePath)) {
      try {
        const rules = parsePrettierConfig(filePath, file);
        if (rules.length > 0) {
          return { type: 'prettier', path: filePath, rules };
        }
      } catch {
        // Skip
      }
    }
  }

  // Check package.json for prettier config
  const packagePath = join(projectPath, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
      if (pkg.prettier) {
        const rules = extractPrettierRules(pkg.prettier, packagePath);
        if (rules.length > 0) {
          return { type: 'prettier', path: packagePath, rules };
        }
      }
    } catch {
      // Skip
    }
  }

  return null;
}

function parsePrettierConfig(filePath: string, fileName: string): ImportedRule[] {
  if (fileName.endsWith('.json') || fileName === '.prettierrc') {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);
      return extractPrettierRules(config, filePath);
    } catch {
      return [];
    }
  }

  // For JS/YML configs, just note existence
  return [{
    category: 'design',
    rule: 'Format code with Prettier',
    rationale: `Prettier config exists at ${fileName}`,
    source: filePath,
  }];
}

function extractPrettierRules(config: Record<string, unknown>, source: string): ImportedRule[] {
  const rules: ImportedRule[] = [];

  rules.push({
    category: 'design',
    rule: 'Format code with Prettier',
    rationale: 'Prettier is configured',
    source,
  });

  if (config.semi === false) {
    rules.push({
      category: 'design',
      rule: 'No semicolons',
      rationale: 'Prettier semi: false',
      source,
    });
  }

  if (config.singleQuote === true) {
    rules.push({
      category: 'design',
      rule: 'Use single quotes for strings',
      rationale: 'Prettier singleQuote: true',
      source,
    });
  }

  if (typeof config.printWidth === 'number') {
    rules.push({
      category: 'design',
      rule: `Maximum line length is ${config.printWidth} characters`,
      rationale: `Prettier printWidth: ${config.printWidth}`,
      source,
    });
  }

  if (typeof config.tabWidth === 'number') {
    rules.push({
      category: 'design',
      rule: `Use ${config.tabWidth}-space indentation`,
      rationale: `Prettier tabWidth: ${config.tabWidth}`,
      source,
    });
  }

  return rules;
}

// ============ TypeScript ============

function findAndParseTsconfig(projectPath: string): LinterConfig | null {
  const filePath = join(projectPath, 'tsconfig.json');
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    // Remove comments for JSON parsing
    const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const config = JSON.parse(cleanContent);
    const rules = extractTsconfigRules(config, filePath);
    if (rules.length > 0) {
      return { type: 'typescript', path: filePath, rules };
    }
  } catch {
    // Skip
  }

  return null;
}

function extractTsconfigRules(config: Record<string, unknown>, source: string): ImportedRule[] {
  const rules: ImportedRule[] = [];
  const compilerOptions = config.compilerOptions as Record<string, unknown> | undefined;

  if (!compilerOptions) return rules;

  if (compilerOptions.strict === true) {
    rules.push({
      category: 'design',
      rule: 'TypeScript strict mode is enabled',
      rationale: 'tsconfig strict: true',
      source,
    });
  }

  if (compilerOptions.noImplicitAny === true) {
    rules.push({
      category: 'design',
      rule: 'No implicit any types',
      rationale: 'tsconfig noImplicitAny: true',
      source,
    });
  }

  if (compilerOptions.strictNullChecks === true) {
    rules.push({
      category: 'design',
      rule: 'Handle null and undefined explicitly',
      rationale: 'tsconfig strictNullChecks: true',
      source,
    });
  }

  if (compilerOptions.noUnusedLocals === true) {
    rules.push({
      category: 'design',
      rule: 'No unused local variables',
      rationale: 'tsconfig noUnusedLocals: true',
      source,
    });
  }

  if (compilerOptions.noUnusedParameters === true) {
    rules.push({
      category: 'design',
      rule: 'No unused function parameters',
      rationale: 'tsconfig noUnusedParameters: true',
      source,
    });
  }

  return rules;
}

// ============ Helpers ============

/**
 * Very basic YAML parser for simple key-value configs.
 * Only handles flat structures and simple nested objects.
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');

  let currentKey = '';
  let currentObject: Record<string, unknown> = result;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    const indent = line.match(/^(\s*)/)?.[1].length || 0;

    if (indent === 0 && line.includes(':')) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      currentKey = key.trim();

      if (value) {
        result[currentKey] = value;
      } else {
        result[currentKey] = {};
        currentObject = result[currentKey] as Record<string, unknown>;
      }
    } else if (indent > 0 && line.includes(':')) {
      const [key, ...valueParts] = line.trim().split(':');
      const value = valueParts.join(':').trim();
      currentObject[key.trim()] = value || true;
    }
  }

  return result;
}
