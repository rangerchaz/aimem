/**
 * Response Generator
 *
 * Generates DIK-adjusted pushback messages.
 * Single personality: Senior dev who's been on the project too long.
 */

import { getDikTier } from './calculator.js';
import type { GuardrailViolation } from '../types/index.js';

interface ResponseHistory {
  previousOverrides: number;
  wasVindicated: boolean;
}

// Templates by DIK tier
const TEMPLATES = {
  low: [
    "I noticed we usually {pattern}. Is there a reason to do it differently here?",
    "The codebase typically follows {pattern}. Want to match the existing approach?",
    "Just checking - {pattern} seems to be the convention here. Intentional deviation?",
  ],
  medium: [
    "We do {pattern} here. Any particular reason to do it differently?",
    "This breaks our pattern: {pattern}. What's the reasoning?",
    "{pattern} - that's how we do it here. You sure about this?",
  ],
  high: [
    "No. {pattern}. We've been over this.",
    "{pattern}. That's not changing.",
    "I'm not doing that. {pattern}.",
  ],
};

// Escalation additions
const OVERRIDE_ESCALATIONS = [
  "You've overridden this before.",
  "We've had this conversation.",
  "Again?",
];

const VINDICATION_ADDITIONS = [
  "Remember what happened last time you ignored this?",
  "How'd that work out for you last time?",
  "You fixed it last time. Let's not repeat that.",
];

/**
 * Generate a pushback response for a violation.
 */
export function generateResponse(
  violation: GuardrailViolation,
  dikLevel: number,
  history: ResponseHistory = { previousOverrides: 0, wasVindicated: false }
): string {
  const tier = getDikTier(dikLevel);
  const templates = TEMPLATES[tier];

  // Pick a template (deterministic based on violation id)
  const template = templates[violation.id % templates.length];

  // Format the pattern
  let response = template.replace('{pattern}', violation.rule);

  // Add escalation if they've overridden before
  if (history.previousOverrides > 0 && tier !== 'low') {
    const escalation = OVERRIDE_ESCALATIONS[history.previousOverrides % OVERRIDE_ESCALATIONS.length];
    response += ' ' + escalation;
  }

  // Add vindication reference if applicable
  if (history.wasVindicated && tier !== 'low') {
    const vindication = VINDICATION_ADDITIONS[violation.id % VINDICATION_ADDITIONS.length];
    response += ' ' + vindication;
  }

  return response;
}

/**
 * Generate a combined response for multiple violations.
 */
export function generateCombinedResponse(
  violations: Array<{ violation: GuardrailViolation; history: ResponseHistory }>,
  dikLevel: number
): string {
  if (violations.length === 0) return '';

  if (violations.length === 1) {
    return generateResponse(violations[0].violation, dikLevel, violations[0].history);
  }

  const tier = getDikTier(dikLevel);

  // For multiple violations, summarize
  const rules = violations.map(v => v.violation.rule);

  if (tier === 'low') {
    return `I noticed a few patterns we might want to follow:\n${rules.map(r => `- ${r}`).join('\n')}\n\nAny reason to deviate?`;
  }

  if (tier === 'medium') {
    return `Hold up. This breaks ${violations.length} patterns:\n${rules.map(r => `- ${r}`).join('\n')}\n\nWhat's the plan here?`;
  }

  // High tier
  const hasVindication = violations.some(v => v.history.wasVindicated);
  let response = `No. Multiple violations:\n${rules.map(r => `- ${r}`).join('\n')}`;

  if (hasVindication) {
    response += '\n\nWe\'ve been here before. It didn\'t end well.';
  }

  return response;
}

/**
 * Format severity as a prefix.
 */
export function formatSeverityPrefix(severity: 'info' | 'warn' | 'block'): string {
  switch (severity) {
    case 'info':
      return '[Note]';
    case 'warn':
      return '[Warning]';
    case 'block':
      return '[Blocked]';
  }
}
