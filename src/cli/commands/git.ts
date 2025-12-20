/**
 * Git integration commands for aimem
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getProjectByPath, upsertCommit, createCommitLink, getUncommittedExtractions, getCommitByHash, searchCommits, getRecentCommits } from '../../db/index.js';
import { isGitRepo, getCommits, getHeadCommit, getBlame, getGitRoot, type GitCommit } from '../../git/index.js';
import { extractFromCommit, hasDecisionContent } from '../../git/extractor.js';
import { installHook, removeHook, getHooksStatus } from '../../git/hooks.js';

export const gitCommand = new Command('git')
  .description('Git integration commands');

// aimem git import
gitCommand
  .command('import')
  .description('Import git commit history')
  .option('-n, --limit <count>', 'Maximum commits to import', '100')
  .option('-s, --since <date>', 'Import commits since date')
  .option('--dry-run', 'Show what would be imported')
  .action(async (options) => {
    const cwd = process.cwd();

    if (!isGitRepo(cwd)) {
      console.log(chalk.red('Not a git repository'));
      process.exit(1);
    }

    const project = getProjectByPath(cwd);
    if (!project) {
      console.log(chalk.red('Not an aimem project. Run `aimem init` first.'));
      process.exit(1);
    }

    console.log(chalk.bold('Importing git history...\n'));

    const commits = await getCommits(cwd, {
      limit: parseInt(options.limit, 10),
      since: options.since,
    });

    if (commits.length === 0) {
      console.log(chalk.yellow('No commits found'));
      return;
    }

    let imported = 0;
    let extracted = 0;

    for (const commit of commits) {
      if (options.dryRun) {
        const hasContent = hasDecisionContent(commit);
        console.log(`${commit.shortHash} ${commit.subject.slice(0, 60)}${hasContent ? chalk.green(' [decision]') : ''}`);
        if (hasContent) extracted++;
        imported++;
        continue;
      }

      // Upsert commit
      const dbCommit = upsertCommit(
        project.id,
        commit.hash,
        commit.shortHash,
        commit.authorName,
        commit.authorEmail,
        commit.timestamp,
        commit.subject,
        commit.body,
        commit.parentHashes
      );

      // Extract decisions from commit message
      const extractions = extractFromCommit(commit);
      if (extractions.length > 0) {
        extracted += extractions.length;
        console.log(`${chalk.green('✓')} ${commit.shortHash} - ${extractions.length} extraction(s)`);
      }

      imported++;
    }

    console.log(chalk.gray(`\nImported ${imported} commits, found ${extracted} extractions`));

    if (options.dryRun) {
      console.log(chalk.yellow('\nDry run - no changes made'));
    }
  });

// aimem git link
gitCommand
  .command('link')
  .description('Link decisions to commits')
  .option('-c, --commit <hash>', 'Link to specific commit')
  .option('-r, --recent <n>', 'Link last N uncommitted decisions to HEAD')
  .option('--auto', 'Auto-detect uncommitted decisions and link to HEAD')
  .action(async (options) => {
    const cwd = process.cwd();

    if (!isGitRepo(cwd)) {
      console.log(chalk.red('Not a git repository'));
      process.exit(1);
    }

    const project = getProjectByPath(cwd);
    if (!project) {
      console.log(chalk.red('Not an aimem project. Run `aimem init` first.'));
      process.exit(1);
    }

    const headHash = getHeadCommit(cwd);
    if (!headHash) {
      console.log(chalk.red('No commits in repository'));
      process.exit(1);
    }

    const targetHash = options.commit || headHash;
    let commit = getCommitByHash(project.id, targetHash);

    // Import commit if not in DB
    if (!commit) {
      const gitCommit = (await getCommits(cwd, { limit: 1 }))[0];
      if (!gitCommit || gitCommit.hash !== targetHash) {
        console.log(chalk.red(`Commit ${targetHash} not found`));
        process.exit(1);
      }
      commit = upsertCommit(
        project.id,
        gitCommit.hash,
        gitCommit.shortHash,
        gitCommit.authorName,
        gitCommit.authorEmail,
        gitCommit.timestamp,
        gitCommit.subject,
        gitCommit.body,
        gitCommit.parentHashes
      );
    }

    // Get uncommitted extractions
    const extractions = getUncommittedExtractions(project.id);

    if (extractions.length === 0) {
      console.log(chalk.yellow('No uncommitted decisions to link'));
      return;
    }

    const limit = options.recent ? parseInt(options.recent, 10) : extractions.length;
    const toLink = extractions.slice(0, limit);

    console.log(chalk.bold(`Linking ${toLink.length} decision(s) to ${commit.short_hash}...\n`));

    let linked = 0;
    for (const ext of toLink) {
      const link = createCommitLink(commit.id, 'extraction', ext.id, 'committed_in');
      if (link) {
        console.log(`${chalk.green('✓')} ${ext.content.slice(0, 60)}...`);
        linked++;
      }
    }

    console.log(chalk.gray(`\nLinked ${linked} decisions to commit ${commit.short_hash}`));
  });

// aimem git search
gitCommand
  .command('search <query>')
  .description('Search commit history')
  .option('-n, --limit <count>', 'Maximum results', '20')
  .action(async (query, options) => {
    const cwd = process.cwd();
    const project = getProjectByPath(cwd);
    const projectId = project?.id;

    const commits = searchCommits(query, parseInt(options.limit, 10), projectId);

    if (commits.length === 0) {
      console.log(chalk.yellow('No commits found'));
      return;
    }

    for (const commit of commits) {
      console.log(`${chalk.cyan(commit.short_hash || commit.hash.slice(0, 7))} ${commit.subject}`);
      console.log(chalk.gray(`  ${commit.author_name} <${commit.author_email}> - ${commit.timestamp}`));
    }
  });

// aimem git recent
gitCommand
  .command('recent')
  .description('Show recent commits')
  .option('-n, --limit <count>', 'Number of commits', '10')
  .action(async (options) => {
    const cwd = process.cwd();
    const project = getProjectByPath(cwd);

    if (!project) {
      console.log(chalk.red('Not an aimem project'));
      process.exit(1);
    }

    const commits = getRecentCommits(project.id, parseInt(options.limit, 10));

    if (commits.length === 0) {
      console.log(chalk.yellow('No commits in database. Run `aimem git import` first.'));
      return;
    }

    for (const commit of commits) {
      console.log(`${chalk.cyan(commit.short_hash || commit.hash.slice(0, 7))} ${commit.subject}`);
    }
  });

// aimem git blame <file>
gitCommand
  .command('blame <file>')
  .description('Show git blame with aimem context')
  .option('-L, --lines <range>', 'Line range (e.g., 10,20)')
  .action(async (file, options) => {
    const cwd = process.cwd();

    if (!isGitRepo(cwd)) {
      console.log(chalk.red('Not a git repository'));
      process.exit(1);
    }

    const blameData = await getBlame(cwd, file);

    if (blameData.length === 0) {
      console.log(chalk.yellow('No blame data available'));
      return;
    }

    // Group consecutive lines by the same commit
    let currentHash = '';
    let count = 0;

    for (const blame of blameData) {
      if (blame.hash !== currentHash) {
        if (currentHash) console.log();
        currentHash = blame.hash;
        count = 1;
        console.log(chalk.cyan(`${blame.hash.slice(0, 7)} (${blame.author}, ${blame.timestamp.split('T')[0]})`));
      } else {
        count++;
      }
      // Only show first few lines per commit
      if (count <= 3) {
        console.log(chalk.gray(`  ${blame.lineNumber}`));
      } else if (count === 4) {
        console.log(chalk.gray(`  ... more lines`));
      }
    }
  });

// aimem git hooks
const hooksCommand = new Command('hooks')
  .description('Manage git hooks');

hooksCommand
  .command('install')
  .description('Install git hooks')
  .option('--post-commit', 'Install post-commit hook (auto-link decisions)')
  .option('--pre-push', 'Install pre-push hook (auto-import commits)')
  .option('-a, --all', 'Install all hooks')
  .option('-f, --force', 'Overwrite existing hooks')
  .action((options) => {
    const cwd = process.cwd();

    if (!isGitRepo(cwd)) {
      console.log(chalk.red('Not a git repository'));
      process.exit(1);
    }

    const hooks: Array<'post-commit' | 'pre-push'> = [];
    if (options.all || options.postCommit) hooks.push('post-commit');
    if (options.all || options.prePush) hooks.push('pre-push');

    if (hooks.length === 0) {
      hooks.push('post-commit'); // Default to post-commit
    }

    for (const hook of hooks) {
      const result = installHook(cwd, hook, { force: options.force });
      if (result.success) {
        console.log(chalk.green(`✓ ${result.message}`));
      } else {
        console.log(chalk.red(`✗ ${result.message}`));
      }
    }
  });

hooksCommand
  .command('remove')
  .description('Remove git hooks')
  .option('--post-commit', 'Remove post-commit hook')
  .option('--pre-push', 'Remove pre-push hook')
  .option('-a, --all', 'Remove all hooks')
  .action((options) => {
    const cwd = process.cwd();

    if (!isGitRepo(cwd)) {
      console.log(chalk.red('Not a git repository'));
      process.exit(1);
    }

    const hooks: Array<'post-commit' | 'pre-push'> = [];
    if (options.all) {
      hooks.push('post-commit', 'pre-push');
    } else {
      if (options.postCommit) hooks.push('post-commit');
      if (options.prePush) hooks.push('pre-push');
    }

    if (hooks.length === 0) {
      console.log(chalk.yellow('Specify a hook to remove (--post-commit, --pre-push, or --all)'));
      return;
    }

    for (const hook of hooks) {
      const result = removeHook(cwd, hook);
      if (result.success) {
        console.log(chalk.green(`✓ ${result.message}`));
      } else {
        console.log(chalk.red(`✗ ${result.message}`));
      }
    }
  });

hooksCommand
  .command('status')
  .description('Show status of installed hooks')
  .action(() => {
    const cwd = process.cwd();

    if (!isGitRepo(cwd)) {
      console.log(chalk.red('Not a git repository'));
      process.exit(1);
    }

    const status = getHooksStatus(cwd);

    console.log(chalk.bold('Git hooks status:\n'));
    for (const [hook, state] of Object.entries(status)) {
      let icon: string;
      let color: (s: string) => string;
      switch (state) {
        case 'installed':
          icon = '✓';
          color = chalk.green;
          break;
        case 'other':
          icon = '?';
          color = chalk.yellow;
          break;
        default:
          icon = '✗';
          color = chalk.gray;
      }
      console.log(`${color(icon)} ${hook}: ${state}`);
    }
  });

gitCommand.addCommand(hooksCommand);
