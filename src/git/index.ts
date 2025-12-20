/**
 * Git operations using shell commands (no dependencies)
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
  subject: string;
  body: string;
  parentHashes: string[];
}

export interface GitBlame {
  lineNumber: number;
  hash: string;
  author: string;
  authorEmail: string;
  timestamp: string;
}

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | string;
}

/**
 * Check if a path is a git repository
 */
export function isGitRepo(path: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: path, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(path: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: path, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the HEAD commit hash
 */
export function getHeadCommit(path: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: path, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Get commits from git log
 */
export async function getCommits(
  path: string,
  options: { limit?: number; since?: string; until?: string } = {}
): Promise<GitCommit[]> {
  const { limit = 100, since, until } = options;

  // Use a unique separator that won't appear in commit messages
  const SEP = '<<<AIMEM_SEP>>>';
  const END = '<<<AIMEM_END>>>';

  // Format: hash, short hash, author name, author email, timestamp, parent hashes, subject, body
  const format = `%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%aI${SEP}%P${SEP}%s${SEP}%b${END}`;

  let cmd = `git log --format="${format}" -n ${limit}`;
  if (since) cmd += ` --since="${since}"`;
  if (until) cmd += ` --until="${until}"`;

  try {
    const { stdout } = await execAsync(cmd, { cwd: path, maxBuffer: 10 * 1024 * 1024 });
    const commits: GitCommit[] = [];

    for (const entry of stdout.split(END)) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(SEP);
      if (parts.length < 7) continue;

      commits.push({
        hash: parts[0],
        shortHash: parts[1],
        authorName: parts[2],
        authorEmail: parts[3],
        timestamp: parts[4],
        parentHashes: parts[5] ? parts[5].split(' ') : [],
        subject: parts[6],
        body: parts[7] || '',
      });
    }

    return commits;
  } catch {
    return [];
  }
}

/**
 * Get a single commit by hash
 */
export async function getCommit(path: string, hash: string): Promise<GitCommit | null> {
  const commits = await getCommits(path, { limit: 1 });
  // Actually need to get specific commit
  const SEP = '<<<AIMEM_SEP>>>';
  const format = `%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%aI${SEP}%P${SEP}%s${SEP}%b`;

  try {
    const { stdout } = await execAsync(`git show -s --format="${format}" ${hash}`, { cwd: path });
    const parts = stdout.trim().split(SEP);
    if (parts.length < 7) return null;

    return {
      hash: parts[0],
      shortHash: parts[1],
      authorName: parts[2],
      authorEmail: parts[3],
      timestamp: parts[4],
      parentHashes: parts[5] ? parts[5].split(' ') : [],
      subject: parts[6],
      body: parts[7] || '',
    };
  } catch {
    return null;
  }
}

/**
 * Get files changed in a commit
 */
export async function getChangedFiles(path: string, hash: string): Promise<ChangedFile[]> {
  try {
    const { stdout } = await execAsync(`git diff-tree --no-commit-id --name-status -r ${hash}`, { cwd: path });
    const files: ChangedFile[] = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [status, ...pathParts] = trimmed.split('\t');
      files.push({
        status: status as ChangedFile['status'],
        path: pathParts.join('\t'), // Handle paths with tabs (rare)
      });
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Get git blame for a file
 */
export async function getBlame(path: string, filePath: string): Promise<GitBlame[]> {
  try {
    // Use porcelain format for easier parsing
    const { stdout } = await execAsync(`git blame --porcelain "${filePath}"`, { cwd: path, maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.split('\n');
    const blames: GitBlame[] = [];

    let currentHash = '';
    let currentAuthor = '';
    let currentEmail = '';
    let currentTimestamp = '';
    let lineNumber = 0;

    for (const line of lines) {
      if (line.match(/^[0-9a-f]{40}/)) {
        // New blame entry: hash origLine finalLine [numLines]
        const parts = line.split(' ');
        currentHash = parts[0];
        lineNumber = parseInt(parts[2], 10);
      } else if (line.startsWith('author ')) {
        currentAuthor = line.slice(7);
      } else if (line.startsWith('author-mail ')) {
        currentEmail = line.slice(12).replace(/[<>]/g, '');
      } else if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.slice(12), 10);
        currentTimestamp = new Date(timestamp * 1000).toISOString();
      } else if (line.startsWith('\t')) {
        // This is the actual line content - entry is complete
        blames.push({
          lineNumber,
          hash: currentHash,
          author: currentAuthor,
          authorEmail: currentEmail,
          timestamp: currentTimestamp,
        });
      }
    }

    return blames;
  } catch {
    return [];
  }
}

/**
 * Get blame for a specific line range
 */
export async function getBlameForLines(
  path: string,
  filePath: string,
  startLine: number,
  endLine: number
): Promise<GitBlame[]> {
  try {
    const { stdout } = await execAsync(
      `git blame --porcelain -L ${startLine},${endLine} "${filePath}"`,
      { cwd: path, maxBuffer: 10 * 1024 * 1024 }
    );

    const lines = stdout.split('\n');
    const blames: GitBlame[] = [];

    let currentHash = '';
    let currentAuthor = '';
    let currentEmail = '';
    let currentTimestamp = '';
    let lineNumber = 0;

    for (const line of lines) {
      if (line.match(/^[0-9a-f]{40}/)) {
        const parts = line.split(' ');
        currentHash = parts[0];
        lineNumber = parseInt(parts[2], 10);
      } else if (line.startsWith('author ')) {
        currentAuthor = line.slice(7);
      } else if (line.startsWith('author-mail ')) {
        currentEmail = line.slice(12).replace(/[<>]/g, '');
      } else if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.slice(12), 10);
        currentTimestamp = new Date(timestamp * 1000).toISOString();
      } else if (line.startsWith('\t')) {
        blames.push({
          lineNumber,
          hash: currentHash,
          author: currentAuthor,
          authorEmail: currentEmail,
          timestamp: currentTimestamp,
        });
      }
    }

    return blames;
  } catch {
    return [];
  }
}

/**
 * Get the root directory of the git repository
 */
export function getGitRoot(path: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: path, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(path: string): boolean {
  try {
    const status = execSync('git status --porcelain', { cwd: path, encoding: 'utf-8' });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}
