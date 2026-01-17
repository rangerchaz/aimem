/**
 * Guardrails Module - DIK (Digital Interface Knowledge)
 *
 * A rules enforcement system that earns authority over time.
 * The AI doesn't just remember - it has opinions, and those opinions are earned.
 */

// Calculator exports
export {
  calculateDik,
  getDikBreakdown,
  getDikTier,
  describeDikLevel,
  getPersonalityInjection,
  type DikBreakdown,
} from './calculator.js';

// Analyzer exports
export {
  analyzeProject,
  saveProposedRules,
} from './analyzer.js';

// Enforcer exports
export {
  checkGuardrails,
  acceptGuardrail,
  overrideGuardrail,
  vindicateOverride,
} from './enforcer.js';

// Responder exports
export {
  generateResponse,
  generateCombinedResponse,
  formatSeverityPrefix,
} from './responder.js';

// Linter import exports
export {
  importLinterRules,
  type LinterConfig,
  type ImportedRule,
} from './linter-import.js';

// Vindication queue exports
export {
  getAllPending,
  getPendingForFiles,
  queueCheck,
  getQueuedChecks,
  getQueuedChecksLimited,
  dequeueCheck,
  clearQueue,
  recordResult,
  markChecked,
  expireOld,
  hasQueuedChecks,
  getQueuedCount,
} from './vindication-queue.js';

// Vindication checker exports
export {
  checkForVindication,
  checkFileForVindications,
  computeContentHash,
  readCodeAtLines,
} from './vindication-checker.js';
