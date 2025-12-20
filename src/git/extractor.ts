/**
 * Extract decisions and context from git commit messages
 */

import type { GitCommit } from './index.js';

export interface ConventionalCommit {
  type: string;           // feat, fix, refactor, docs, chore, test, etc.
  scope: string | null;   // Optional scope in parentheses
  breaking: boolean;      // Has breaking change indicator
  description: string;    // The commit description
  body: string | null;    // Commit body
  footers: Record<string, string>; // Key-value footers
}

export interface CommitExtraction {
  type: 'decision' | 'pattern' | 'rejection';
  content: string;
  source: 'commit';
}

// Conventional commit regex: type(scope)!: description
const CONVENTIONAL_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

// Patterns that indicate decisions in commit messages
const DECISION_PATTERNS = [
  /\bdecid(?:e|ed|ing)\s+to\b/i,
  /\bchoos(?:e|ing)\s+to\b/i,
  /\bswitch(?:ed|ing)?\s+(?:to|from)\b/i,
  /\bmigrat(?:e|ed|ing)\s+(?:to|from)\b/i,
  /\breplace(?:d|ing)?\s+.+\s+with\b/i,
  /\buse\s+.+\s+instead\s+of\b/i,
  /\badopt(?:ed|ing)?\b/i,
  /\bimplement(?:ed|ing)?\s+.+\s+using\b/i,
];

// Patterns that indicate rejections
const REJECTION_PATTERNS = [
  /\bremov(?:e|ed|ing)\s+.+\s+(?:because|due\s+to)\b/i,
  /\bdeprecate(?:d|ing)?\b/i,
  /\brevert(?:ed|ing)?\b/i,
  /\bdon't\s+use\b/i,
  /\bavoid(?:ed|ing)?\b/i,
  /\bstop(?:ped|ping)?\s+using\b/i,
];

/**
 * Parse a conventional commit message
 */
export function parseConventionalCommit(subject: string, body?: string): ConventionalCommit | null {
  const match = subject.match(CONVENTIONAL_REGEX);
  if (!match) return null;

  const [, type, scope, breaking, description] = match;
  const footers: Record<string, string> = {};

  // Parse footers from body (lines matching "Key: Value" or "Key #value")
  if (body) {
    const lines = body.split('\n');
    for (const line of lines) {
      const footerMatch = line.match(/^([\w-]+)(?::\s*|\s+#)(.+)$/);
      if (footerMatch) {
        footers[footerMatch[1].toLowerCase()] = footerMatch[2];
      }
    }
  }

  return {
    type: type.toLowerCase(),
    scope: scope || null,
    breaking: !!breaking || 'breaking-change' in footers || 'breaking change' in footers,
    description,
    body: body || null,
    footers,
  };
}

/**
 * Extract decisions from a commit message
 */
export function extractFromCommit(commit: GitCommit): CommitExtraction[] {
  const extractions: CommitExtraction[] = [];
  const fullMessage = `${commit.subject}\n${commit.body || ''}`;

  // Check for decision patterns
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(fullMessage)) {
      extractions.push({
        type: 'decision',
        content: `[${commit.shortHash}] ${commit.subject}`,
        source: 'commit',
      });
      break;
    }
  }

  // Check for rejection patterns
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(fullMessage)) {
      extractions.push({
        type: 'rejection',
        content: `[${commit.shortHash}] ${commit.subject}`,
        source: 'commit',
      });
      break;
    }
  }

  // Check for conventional commits with specific types
  const conventional = parseConventionalCommit(commit.subject, commit.body);
  if (conventional) {
    // feat and refactor often represent decisions
    if (['feat', 'refactor'].includes(conventional.type) && extractions.length === 0) {
      extractions.push({
        type: 'decision',
        content: `[${commit.shortHash}] ${conventional.type}${conventional.scope ? `(${conventional.scope})` : ''}: ${conventional.description}`,
        source: 'commit',
      });
    }

    // Breaking changes are important decisions
    if (conventional.breaking && !extractions.some(e => e.content.includes('BREAKING'))) {
      extractions.push({
        type: 'decision',
        content: `[${commit.shortHash}] BREAKING: ${conventional.description}`,
        source: 'commit',
      });
    }
  }

  return extractions;
}

/**
 * Check if a commit message contains decision-related content
 */
export function hasDecisionContent(commit: GitCommit): boolean {
  const fullMessage = `${commit.subject}\n${commit.body || ''}`;

  // Check decision patterns
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(fullMessage)) return true;
  }

  // Check rejection patterns
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(fullMessage)) return true;
  }

  // Check for conventional commit with meaningful type
  const conventional = parseConventionalCommit(commit.subject);
  if (conventional && ['feat', 'refactor', 'fix'].includes(conventional.type)) {
    return true;
  }

  return false;
}
