/**
 * Violation Checker / Enforcer
 *
 * Checks if proposed actions violate any guardrails.
 */

import {
  getProjectGuardrails,
  getOrCreateProjectDik,
  getGuardrailHistory,
  insertGuardrailEvent,
  incrementDikCounter,
  getGuardrailEvent,
} from '../db/index.js';
import { calculateDik } from './calculator.js';
import { generateCombinedResponse } from './responder.js';
import type { Guardrail, GuardrailViolation, GuardrailCheckResult, GuardrailCategory } from '../types/index.js';

/**
 * Check if an action violates any guardrails.
 *
 * This does keyword/pattern matching against the action text.
 * For more sophisticated matching, the analyzer should pre-tag
 * guardrails with keywords.
 */
export function checkGuardrails(
  projectId: number,
  action: string,
  context?: string
): GuardrailCheckResult {
  const guardrails = getProjectGuardrails(projectId, { activeOnly: true });
  const dikData = getOrCreateProjectDik(projectId);
  const dikLevel = calculateDik(dikData);

  const violations: GuardrailViolation[] = [];
  const violationHistories: Array<{ violation: GuardrailViolation; history: { previousOverrides: number; wasVindicated: boolean } }> = [];

  const actionLower = action.toLowerCase();
  const contextLower = context?.toLowerCase() || '';
  const combined = actionLower + ' ' + contextLower;

  for (const guardrail of guardrails) {
    if (matchesGuardrail(combined, guardrail)) {
      const violation: GuardrailViolation = {
        id: guardrail.id,
        rule: guardrail.rule,
        category: guardrail.category,
        severity: guardrail.severity,
        rationale: guardrail.rationale,
      };
      violations.push(violation);

      const history = getGuardrailHistory(guardrail.id);
      violationHistories.push({
        violation,
        history: {
          previousOverrides: history.overrides,
          wasVindicated: history.vindicated,
        },
      });

      // Log the trigger event
      insertGuardrailEvent(
        guardrail.id,
        'triggered',
        action.slice(0, 500), // Truncate for storage
        null,
        dikLevel
      );
    }
  }

  // Increment conversation count
  incrementDikCounter(projectId, 'conversations');

  // Generate response
  const response = generateCombinedResponse(violationHistories, dikLevel);

  return {
    violations,
    dik_level: dikLevel,
    response,
  };
}

/**
 * Check if the action text matches a guardrail.
 *
 * This uses simple keyword matching. Rules can contain:
 * - Exact phrases to look for
 * - Category-specific patterns
 */
function matchesGuardrail(text: string, guardrail: Guardrail): boolean {
  // Extract keywords from the rule
  const keywords = extractKeywords(guardrail.rule, guardrail.category);

  // Check if any keyword matches
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Extract keywords from a rule for matching.
 */
function extractKeywords(rule: string, category: GuardrailCategory): string[] {
  const keywords: string[] = [];

  // Extract quoted phrases
  const quotedMatches = rule.match(/"[^"]+"/g) || [];
  for (const match of quotedMatches) {
    keywords.push(match.slice(1, -1)); // Remove quotes
  }

  // Extract backtick-wrapped code
  const codeMatches = rule.match(/`[^`]+`/g) || [];
  for (const match of codeMatches) {
    keywords.push(match.slice(1, -1)); // Remove backticks
  }

  // Category-specific keyword extraction
  switch (category) {
    case 'naming':
      // Look for case patterns mentioned
      if (rule.includes('snake_case')) keywords.push('snake_case');
      if (rule.includes('camelCase')) keywords.push('camelCase');
      if (rule.includes('PascalCase')) keywords.push('PascalCase');
      if (rule.includes('kebab-case')) keywords.push('kebab-case');
      break;

    case 'architecture':
      // Look for path patterns
      const pathMatches = rule.match(/\/[a-zA-Z_-]+\//g) || [];
      keywords.push(...pathMatches);
      break;

    case 'security':
      // Common security keywords
      if (rule.toLowerCase().includes('auth')) keywords.push('password', 'token', 'secret', 'credential');
      if (rule.toLowerCase().includes('sanitiz')) keywords.push('sanitize', 'escape', 'validate');
      break;
  }

  return keywords;
}

/**
 * Record that a user accepted a triggered guardrail.
 */
export function acceptGuardrail(guardrailId: number, projectId: number): void {
  const dikData = getOrCreateProjectDik(projectId);
  const dikLevel = calculateDik(dikData);

  insertGuardrailEvent(guardrailId, 'accepted', null, null, dikLevel);
  incrementDikCounter(projectId, 'corrections_made');
}

/**
 * Record that a user overrode a triggered guardrail.
 */
export function overrideGuardrail(
  guardrailId: number,
  projectId: number,
  reason: string
): number {
  const dikData = getOrCreateProjectDik(projectId);
  const dikLevel = calculateDik(dikData);

  const event = insertGuardrailEvent(guardrailId, 'overridden', reason, null, dikLevel);
  return event.id;
}

/**
 * Mark an override as vindicated (user regretted it).
 * This is gold for DIK.
 */
export function vindicateOverride(eventId: number, projectId: number): number {
  const dikData = getOrCreateProjectDik(projectId);

  // Get the event to find the guardrail
  const event = getGuardrailEvent(eventId);

  if (event && event.event_type === 'overridden') {
    insertGuardrailEvent(event.guardrail_id, 'vindicated', null, null, calculateDik(dikData));
    incrementDikCounter(projectId, 'overrides_regretted');
  }

  // Recalculate and return new DIK level
  const updatedDik = getOrCreateProjectDik(projectId);
  return calculateDik(updatedDik);
}
