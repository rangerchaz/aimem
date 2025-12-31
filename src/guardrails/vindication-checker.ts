/**
 * Vindication Checker
 *
 * Heuristic-based detection of when user's code converges
 * toward an AI suggestion they previously overrode.
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import {
  getPendingVindicationsForFile,
  markVindicated,
  markVindicationChecked,
  incrementDikCounter,
  getGuardrailEvent,
} from '../db/index.js';
import { vindicateOverride } from './enforcer.js';
import type { VindicationCandidate, VindicationResult, VindicationCheckResult } from '../types/index.js';

/**
 * Check a single candidate for vindication using heuristics
 */
export function checkForVindication(
  candidate: VindicationCandidate,
  newCode: string
): VindicationResult {
  // Calculate new hash
  const newHash = createHash('md5').update(newCode).digest('hex');

  // If hash is the same, no change - not vindicated
  if (newHash === candidate.contentHash) {
    return {
      eventId: candidate.eventId,
      vindicated: false,
      confidence: 0,
      reason: 'Code has not changed',
    };
  }

  // Extract keywords from suggestion
  const suggestionKeywords = extractKeywords(candidate.suggestion);

  // Count how many suggestion keywords appear in new code
  const newCodeLower = newCode.toLowerCase();
  let matchedKeywords = 0;
  const matchedWords: string[] = [];

  for (const keyword of suggestionKeywords) {
    if (newCodeLower.includes(keyword.toLowerCase())) {
      matchedKeywords++;
      matchedWords.push(keyword);
    }
  }

  // Calculate confidence based on keyword match ratio
  const keywordConfidence = suggestionKeywords.length > 0
    ? matchedKeywords / suggestionKeywords.length
    : 0;

  // Check for pattern reversal (user undid what they did)
  const patternConfidence = checkPatternReversal(
    candidate.originalCode,
    newCode,
    candidate.suggestion
  );

  // Combined confidence
  const confidence = Math.max(keywordConfidence, patternConfidence);

  // Determine if vindicated
  const vindicated = confidence >= 0.7;

  let reason: string;
  if (vindicated) {
    reason = `Code now includes: ${matchedWords.slice(0, 3).join(', ')}`;
  } else if (confidence >= 0.4) {
    reason = `Partial match (${Math.round(confidence * 100)}%): ${matchedWords.slice(0, 2).join(', ')}`;
  } else {
    reason = 'Code changed but does not match suggestion';
  }

  return {
    eventId: candidate.eventId,
    vindicated,
    confidence,
    reason,
  };
}

/**
 * Check all pending vindications for a specific file
 */
export function checkFileForVindications(
  projectId: number,
  filePath: string
): VindicationCheckResult[] {
  const candidates = getPendingVindicationsForFile(projectId, filePath);
  const results: VindicationCheckResult[] = [];

  if (candidates.length === 0) {
    return results;
  }

  // Read current file content
  if (!existsSync(filePath)) {
    return results;
  }

  const fileContent = readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n');

  for (const candidate of candidates) {
    // Extract relevant lines
    const startLine = Math.max(0, (candidate.lineStart || 1) - 1);
    const endLine = Math.min(lines.length, candidate.lineEnd || lines.length);
    const relevantCode = lines.slice(startLine, endLine).join('\n');

    const result = checkForVindication(candidate, relevantCode);

    if (result.vindicated) {
      // Auto-vindicate!
      const newDikLevel = vindicateOverride(candidate.eventId, projectId);
      results.push({
        candidate,
        result,
        newDikLevel,
      });
    } else {
      // Mark as checked but not vindicated
      markVindicationChecked(candidate.eventId);
      results.push({
        candidate,
        result,
      });
    }
  }

  return results;
}

/**
 * Extract meaningful keywords from suggestion text
 */
function extractKeywords(suggestion: string): string[] {
  const keywords: string[] = [];

  // Extract quoted strings
  const quotedMatches = suggestion.match(/"[^"]+"|'[^']+'/g) || [];
  for (const match of quotedMatches) {
    keywords.push(match.slice(1, -1));
  }

  // Extract code snippets (backticks)
  const codeMatches = suggestion.match(/`[^`]+`/g) || [];
  for (const match of codeMatches) {
    keywords.push(match.slice(1, -1));
  }

  // Extract identifiers (camelCase, PascalCase, snake_case)
  const identifierPattern = /\b([a-z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*|[a-z]+_[a-z_]+)\b/g;
  const identifierMatches = suggestion.match(identifierPattern) || [];

  // Filter out common words
  const commonWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
    'those', 'it', 'its', 'to', 'of', 'in', 'for', 'on', 'with', 'as',
    'at', 'by', 'from', 'or', 'and', 'but', 'if', 'then', 'else', 'when',
    'use', 'using', 'used', 'instead', 'rather', 'than', 'not', 'should',
    'you', 'we', 'they', 'your', 'our', 'their', 'my', 'i', 'me',
  ]);

  for (const match of identifierMatches) {
    if (match.length >= 3 && !commonWords.has(match.toLowerCase())) {
      keywords.push(match);
    }
  }

  // Deduplicate
  return [...new Set(keywords)];
}

/**
 * Check if the code change represents a pattern reversal
 */
function checkPatternReversal(
  originalCode: string,
  newCode: string,
  suggestion: string
): number {
  const suggestionLower = suggestion.toLowerCase();
  const originalLower = originalCode.toLowerCase();
  const newLower = newCode.toLowerCase();

  // Pattern: "Use X instead of Y"
  const useInsteadMatch = suggestionLower.match(/use\s+(\w+)\s+instead\s+of\s+(\w+)/);
  if (useInsteadMatch) {
    const [, preferred, deprecated] = useInsteadMatch;
    const hadDeprecated = originalLower.includes(deprecated);
    const hasPreferred = newLower.includes(preferred);
    const removedDeprecated = !newLower.includes(deprecated);

    if (hadDeprecated && hasPreferred && removedDeprecated) {
      return 0.9; // Strong indicator
    }
    if (hasPreferred) {
      return 0.6; // Moderate indicator
    }
  }

  // Pattern: "Add X" or "Include X"
  const addMatch = suggestionLower.match(/(?:add|include|implement)\s+(\w+)/);
  if (addMatch) {
    const [, feature] = addMatch;
    const hadFeature = originalLower.includes(feature);
    const hasFeature = newLower.includes(feature);

    if (!hadFeature && hasFeature) {
      return 0.8; // Strong indicator - added what was suggested
    }
  }

  // Pattern: "Remove X" or "Delete X"
  const removeMatch = suggestionLower.match(/(?:remove|delete|drop)\s+(\w+)/);
  if (removeMatch) {
    const [, feature] = removeMatch;
    const hadFeature = originalLower.includes(feature);
    const hasFeature = newLower.includes(feature);

    if (hadFeature && !hasFeature) {
      return 0.8; // Strong indicator - removed what was suggested
    }
  }

  return 0;
}

/**
 * Compute content hash for a code snippet
 */
export function computeContentHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Read code from file at specified line range
 */
export function readCodeAtLines(
  filePath: string,
  lineStart: number,
  lineEnd: number
): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, lineStart - 1);
    const end = Math.min(lines.length, lineEnd);
    return lines.slice(start, end).join('\n');
  } catch {
    return null;
  }
}
