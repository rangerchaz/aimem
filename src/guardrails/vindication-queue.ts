/**
 * Vindication Queue
 *
 * Manages pending vindication checks for overridden guardrails.
 * When a file changes, we check if any pending vindications exist
 * for that file and queue them for evaluation.
 */

import {
  getPendingVindications,
  getPendingVindicationsForFile,
  markVindicationChecked,
  markVindicated,
  expireOldVindications,
} from '../db/index.js';
import type { VindicationCandidate, VindicationResult } from '../types/index.js';

// In-memory queue for vindication checks to be processed on next LLM request
interface QueuedCheck {
  candidate: VindicationCandidate;
  newCode: string;
  queuedAt: Date;
}

const pendingChecks: Map<number, QueuedCheck> = new Map();

/**
 * Get all pending vindication candidates for a project
 */
export function getAllPending(projectId: number): VindicationCandidate[] {
  return getPendingVindications(projectId);
}

/**
 * Get pending vindication candidates for specific files
 */
export function getPendingForFiles(projectId: number, files: string[]): VindicationCandidate[] {
  const candidates: VindicationCandidate[] = [];
  for (const file of files) {
    candidates.push(...getPendingVindicationsForFile(projectId, file));
  }
  return candidates;
}

/**
 * Queue a vindication check for processing
 */
export function queueCheck(candidate: VindicationCandidate, newCode: string): void {
  pendingChecks.set(candidate.eventId, {
    candidate,
    newCode,
    queuedAt: new Date(),
  });
}

/**
 * Get all queued checks waiting to be processed
 */
export function getQueuedChecks(): QueuedCheck[] {
  return Array.from(pendingChecks.values());
}

/**
 * Get queued checks limited to a max count (for injection)
 */
export function getQueuedChecksLimited(maxChecks: number = 3): QueuedCheck[] {
  const checks = Array.from(pendingChecks.values());
  return checks.slice(0, maxChecks);
}

/**
 * Clear a specific check from the queue
 */
export function dequeueCheck(eventId: number): void {
  pendingChecks.delete(eventId);
}

/**
 * Clear all queued checks
 */
export function clearQueue(): void {
  pendingChecks.clear();
}

/**
 * Record a vindication result
 */
export function recordResult(eventId: number, result: VindicationResult): void {
  if (result.vindicated && result.confidence >= 0.7) {
    markVindicated(eventId);
  } else {
    markVindicationChecked(eventId);
  }
  dequeueCheck(eventId);
}

/**
 * Mark a check as completed (not vindicated)
 */
export function markChecked(eventId: number): void {
  markVindicationChecked(eventId);
  dequeueCheck(eventId);
}

/**
 * Expire old pending vindications
 */
export function expireOld(projectId: number, maxAgeDays: number = 30): number {
  return expireOldVindications(projectId, maxAgeDays);
}

/**
 * Check if there are any queued checks waiting
 */
export function hasQueuedChecks(): boolean {
  return pendingChecks.size > 0;
}

/**
 * Get the count of queued checks
 */
export function getQueuedCount(): number {
  return pendingChecks.size;
}
