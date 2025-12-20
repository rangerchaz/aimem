/**
 * Git hooks for aimem integration
 */

import { existsSync, writeFileSync, readFileSync, chmodSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getGitRoot } from './index.js';

const HOOK_MARKER = '# aimem hook';

/**
 * Generate post-commit hook content
 */
export function generatePostCommitHook(): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Auto-link decisions to commits after each commit

# Only run if aimem is available
if command -v aimem >/dev/null 2>&1; then
  aimem git link --auto 2>/dev/null || true
fi
`;
}

/**
 * Generate pre-push hook content
 */
export function generatePrePushHook(): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Import commits before push

# Only run if aimem is available
if command -v aimem >/dev/null 2>&1; then
  aimem git import --limit 50 2>/dev/null || true
fi
`;
}

/**
 * Check if a hook is installed by aimem
 */
export function isAimemHook(hookPath: string): boolean {
  if (!existsSync(hookPath)) return false;
  try {
    const content = readFileSync(hookPath, 'utf-8');
    return content.includes(HOOK_MARKER);
  } catch {
    return false;
  }
}

/**
 * Install a git hook
 */
export function installHook(
  projectPath: string,
  hookName: 'post-commit' | 'pre-push',
  options: { force?: boolean } = {}
): { success: boolean; message: string } {
  const gitRoot = getGitRoot(projectPath);
  if (!gitRoot) {
    return { success: false, message: 'Not a git repository' };
  }

  const hooksDir = join(gitRoot, '.git', 'hooks');
  const hookPath = join(hooksDir, hookName);

  // Check if hook already exists
  if (existsSync(hookPath)) {
    if (isAimemHook(hookPath)) {
      return { success: true, message: `Hook ${hookName} already installed` };
    }
    if (!options.force) {
      return { success: false, message: `Hook ${hookName} already exists (use --force to overwrite)` };
    }
  }

  // Ensure hooks directory exists
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  // Generate hook content
  let content: string;
  switch (hookName) {
    case 'post-commit':
      content = generatePostCommitHook();
      break;
    case 'pre-push':
      content = generatePrePushHook();
      break;
    default:
      return { success: false, message: `Unknown hook: ${hookName}` };
  }

  // Write hook
  try {
    writeFileSync(hookPath, content);
    chmodSync(hookPath, 0o755);
    return { success: true, message: `Installed ${hookName} hook` };
  } catch (err) {
    return { success: false, message: `Failed to write hook: ${(err as Error).message}` };
  }
}

/**
 * Remove a git hook installed by aimem
 */
export function removeHook(
  projectPath: string,
  hookName: 'post-commit' | 'pre-push'
): { success: boolean; message: string } {
  const gitRoot = getGitRoot(projectPath);
  if (!gitRoot) {
    return { success: false, message: 'Not a git repository' };
  }

  const hookPath = join(gitRoot, '.git', 'hooks', hookName);

  if (!existsSync(hookPath)) {
    return { success: true, message: `Hook ${hookName} not installed` };
  }

  if (!isAimemHook(hookPath)) {
    return { success: false, message: `Hook ${hookName} was not installed by aimem` };
  }

  try {
    unlinkSync(hookPath);
    return { success: true, message: `Removed ${hookName} hook` };
  } catch (err) {
    return { success: false, message: `Failed to remove hook: ${(err as Error).message}` };
  }
}

/**
 * Get status of installed hooks
 */
export function getHooksStatus(projectPath: string): Record<string, 'installed' | 'not-installed' | 'other'> {
  const gitRoot = getGitRoot(projectPath);
  if (!gitRoot) {
    return {};
  }

  const hooks = ['post-commit', 'pre-push'] as const;
  const status: Record<string, 'installed' | 'not-installed' | 'other'> = {};

  for (const hook of hooks) {
    const hookPath = join(gitRoot, '.git', 'hooks', hook);
    if (!existsSync(hookPath)) {
      status[hook] = 'not-installed';
    } else if (isAimemHook(hookPath)) {
      status[hook] = 'installed';
    } else {
      status[hook] = 'other';
    }
  }

  return status;
}
