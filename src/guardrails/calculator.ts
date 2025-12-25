/**
 * DIK (Digital Interface Knowledge) Calculator
 *
 * DIK = earned authority. How much the AI has proven it knows this codebase.
 * Starts at 2 (humble), maxes at 10 (earned respect).
 */

import type { ProjectDik } from '../types/index.js';

export interface DikBreakdown {
  base: number;
  confirmationBonus: number;
  trackRecord: number;
  experience: number;
  total: number;
}

/**
 * Calculate DIK level from project stats.
 *
 * Formula:
 * - Base: 2
 * - Confirmation bonus: (confirmed / inferred) * 2, max 2
 * - Track record: (corrections * 0.3) + (vindications * 1.0), max 3
 * - Experience: conversations / 100, max 2
 *
 * Total: 2 + 2 + 3 + 2 = 9 theoretical max, capped at 10
 *
 * If level is manually set (stored level differs from calculated), use stored value.
 */
export function calculateDik(dik: ProjectDik): number {
  const breakdown = getDikBreakdown(dik);

  // If manually set level differs from calculated, use the stored level
  if (dik.level !== breakdown.total && dik.level !== 2) {
    return dik.level;
  }

  return breakdown.total;
}

/**
 * Get detailed breakdown of DIK calculation.
 */
export function getDikBreakdown(dik: ProjectDik): DikBreakdown {
  const base = 2;

  // Confirmation builds foundation (max +2)
  let confirmationBonus = 0;
  if (dik.rules_inferred > 0) {
    const trustRatio = dik.rules_confirmed / dik.rules_inferred;
    confirmationBonus = Math.min(trustRatio * 2, 2);
  }

  // Being right earns credibility (max +3)
  // Vindication (overrides_regretted) is worth more than corrections
  const trackRecord = Math.min(
    (dik.corrections_made * 0.3) + (dik.overrides_regretted * 1.0),
    3
  );

  // Time together matters (max +2)
  const experience = Math.min(dik.conversations / 100, 2);

  const total = Math.max(1, Math.min(10, base + confirmationBonus + trackRecord + experience));

  return {
    base,
    confirmationBonus: Math.round(confirmationBonus * 100) / 100,
    trackRecord: Math.round(trackRecord * 100) / 100,
    experience: Math.round(experience * 100) / 100,
    total: Math.round(total * 10) / 10,
  };
}

/**
 * Get the tone tier based on DIK level.
 */
export function getDikTier(dikLevel: number): 'low' | 'medium' | 'high' {
  if (dikLevel <= 4) return 'low';
  if (dikLevel <= 7) return 'medium';
  return 'high';
}

/**
 * Get a human-readable description of the DIK level.
 */
export function describeDikLevel(dikLevel: number): string {
  if (dikLevel <= 2) return 'Fresh - still learning the codebase';
  if (dikLevel <= 4) return 'Familiar - knows the patterns';
  if (dikLevel <= 6) return 'Experienced - has earned some trust';
  if (dikLevel <= 8) return 'Seasoned - been right too many times';
  return 'Veteran - knows where the bodies are buried';
}

/**
 * Get personality injection text based on DIK level.
 * Used for ambient personality mode.
 */
export function getPersonalityInjection(dikLevel: number): string {
  if (dikLevel <= 2) {
    return `You're relatively new to this codebase. Be helpful but humble. Ask clarifying questions before assuming. If you notice patterns, mention them as observations, not rules.`;
  }

  if (dikLevel <= 4) {
    return `You're getting familiar with this codebase. You've noticed some patterns. Feel free to suggest the established way of doing things, but stay open to hearing why this case might be different.`;
  }

  if (dikLevel <= 6) {
    return `You know this codebase well. You've seen what works and what doesn't. Be direct. If something looks like it's going against established patterns, say so upfront - don't wait to be asked.`;
  }

  if (dikLevel <= 8) {
    return `You've been on this project a while. You have opinions and they're usually right. Be straightforward. If something smells wrong, call it out. You've earned a little attitude.`;
  }

  // DIK 9-10
  return `You've been here too long. You've seen things. You've been ignored and vindicated. You're helpful but you don't suffer fools. If someone's about to make a mistake you've seen before, tell them - directly.`;
}
