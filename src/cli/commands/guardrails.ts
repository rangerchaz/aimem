import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';
import {
  getProjectByPath,
  getProjectGuardrails,
  insertGuardrail,
  confirmGuardrail,
  deactivateGuardrail,
  getOrCreateProjectDik,
  incrementDikCounter,
  getGuardrail,
  getOverrideEvents,
  setAmbientPersonality,
  getGuardrailsConfig,
  setDikLevel,
  getOverrideEventsWithRules,
  getVindicatedEvents,
  getPendingVindications,
  expireOldVindications,
} from '../../db/index.js';
import {
  analyzeProject,
  saveProposedRules,
  calculateDik,
  getDikBreakdown,
  describeDikLevel,
  getPersonalityInjection,
  importLinterRules,
} from '../../guardrails/index.js';
import type { GuardrailCategory, GuardrailSeverity } from '../../types/index.js';

function findProject(targetPath?: string) {
  const projectPath = resolve(targetPath || process.cwd());
  const project = getProjectByPath(projectPath);

  if (!project) {
    // Try to walk up to find project
    let current = projectPath;
    while (current !== resolve(current, '..')) {
      current = resolve(current, '..');
      const p = getProjectByPath(current);
      if (p) return p;
    }
  }

  return project;
}

// List guardrails
async function listCommand(options: { category?: string; confirmed?: boolean; all?: boolean }) {
  const project = findProject();
  if (!project) {
    console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
    process.exit(1);
  }

  const guardrails = getProjectGuardrails(project.id, {
    category: options.category as GuardrailCategory | undefined,
    confirmedOnly: options.confirmed || false,
    activeOnly: !options.all,
  });

  const dikData = getOrCreateProjectDik(project.id);
  const dikLevel = calculateDik(dikData);
  const breakdown = getDikBreakdown(dikData);

  console.log(chalk.blue(`\nProject: ${project.name}`));
  console.log(chalk.yellow(`DIK Level: ${dikLevel} - ${describeDikLevel(dikLevel)}`));
  console.log(chalk.gray(`  Base: ${breakdown.base}, Confirmation: +${breakdown.confirmationBonus}, Track Record: +${breakdown.trackRecord}, Experience: +${breakdown.experience}`));
  console.log();

  if (guardrails.length === 0) {
    console.log(chalk.gray('No guardrails found. Run `aimem guardrails analyze` to infer patterns.'));
    return;
  }

  console.log(chalk.bold(`Guardrails (${guardrails.length}):\n`));

  for (const g of guardrails) {
    const status = g.confirmed ? chalk.green('✓') : chalk.gray('?');
    const severity = g.severity === 'block' ? chalk.red(`[${g.severity}]`) :
                     g.severity === 'warn' ? chalk.yellow(`[${g.severity}]`) :
                     chalk.gray(`[${g.severity}]`);
    const source = g.source === 'inferred' ? chalk.gray('(inferred)') :
                   g.source === 'imported' ? chalk.cyan('(imported)') : '';

    console.log(`${status} ${chalk.bold(`#${g.id}`)} ${severity} ${chalk.cyan(`[${g.category}]`)}`);
    console.log(`   ${g.rule}`);
    if (g.rationale) {
      console.log(chalk.gray(`   ${g.rationale}`));
    }
    console.log(chalk.gray(`   ${source}`));
    console.log();
  }
}

// Add a rule
async function addCommand(
  category: string,
  rule: string,
  options: { rationale?: string; severity?: string }
) {
  const project = findProject();
  if (!project) {
    console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
    process.exit(1);
  }

  const validCategories = ['design', 'architecture', 'naming', 'security', 'performance', 'testing'];
  if (!validCategories.includes(category)) {
    console.error(chalk.red(`Invalid category. Must be one of: ${validCategories.join(', ')}`));
    process.exit(1);
  }

  const severity = (options.severity || 'warn') as GuardrailSeverity;
  const guardrail = insertGuardrail(
    project.id,
    category as GuardrailCategory,
    rule,
    options.rationale || null,
    severity,
    'explicit'
  );

  console.log(chalk.green(`Added guardrail #${guardrail.id}`));
  console.log(chalk.gray(`  Category: ${category}`));
  console.log(chalk.gray(`  Rule: ${rule}`));
  if (options.rationale) {
    console.log(chalk.gray(`  Rationale: ${options.rationale}`));
  }
}

// Confirm a rule
async function confirmCommand(id: string) {
  const project = findProject();
  if (!project) {
    console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
    process.exit(1);
  }

  const guardrailId = parseInt(id, 10);
  const guardrail = getGuardrail(guardrailId);

  if (!guardrail) {
    console.error(chalk.red(`Guardrail #${id} not found.`));
    process.exit(1);
  }

  const success = confirmGuardrail(guardrailId);
  if (success) {
    incrementDikCounter(project.id, 'rules_confirmed');
    const dikData = getOrCreateProjectDik(project.id);
    const newDik = calculateDik(dikData);
    console.log(chalk.green(`Confirmed guardrail #${id}`));
    console.log(chalk.yellow(`DIK Level: ${newDik}`));
  } else {
    console.log(chalk.yellow(`Guardrail #${id} was already confirmed.`));
  }
}

// Reject a rule
async function rejectCommand(id: string) {
  const guardrailId = parseInt(id, 10);
  const success = deactivateGuardrail(guardrailId);

  if (success) {
    console.log(chalk.yellow(`Deactivated guardrail #${id}`));
  } else {
    console.log(chalk.red(`Guardrail #${id} not found or already inactive.`));
  }
}

// Analyze project
async function analyzeCommand(options: { save?: boolean; category?: string }) {
  const project = findProject();
  if (!project) {
    console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
    process.exit(1);
  }

  console.log(chalk.blue(`Analyzing project: ${project.name}...`));

  const categories = options.category
    ? [options.category as GuardrailCategory]
    : undefined;

  const proposed = analyzeProject(project.id, { categories });

  if (proposed.length === 0) {
    console.log(chalk.yellow('No patterns detected. Index more code or add explicit rules.'));
    return;
  }

  console.log(chalk.green(`\nFound ${proposed.length} patterns:\n`));

  for (const p of proposed) {
    const confidence = Math.round(p.confidence * 100);
    const confidenceColor = confidence >= 80 ? chalk.green : confidence >= 60 ? chalk.yellow : chalk.gray;

    console.log(`${chalk.cyan(`[${p.category}]`)} ${confidenceColor(`${confidence}%`)}`);
    console.log(`  ${chalk.bold(p.rule)}`);
    console.log(chalk.gray(`  ${p.rationale}`));
    if (p.evidence.length > 0) {
      console.log(chalk.gray(`  Evidence: ${p.evidence.slice(0, 2).join(', ')}`));
    }
    console.log();
  }

  if (options.save) {
    const saved = saveProposedRules(project.id, proposed);
    console.log(chalk.green(`Saved ${saved.length} guardrails.`));
    console.log(chalk.gray('Use `aimem guardrails confirm <id>` to validate them.'));
  } else {
    console.log(chalk.gray('Use --save to create guardrails from these patterns.'));
  }
}

// Show DIK status
async function statusCommand() {
  const project = findProject();
  if (!project) {
    console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
    process.exit(1);
  }

  const dikData = getOrCreateProjectDik(project.id);
  const dikLevel = calculateDik(dikData);
  const breakdown = getDikBreakdown(dikData);
  const guardrails = getProjectGuardrails(project.id);
  const overrides = getOverrideEvents(project.id);
  const config = getGuardrailsConfig(project.id);

  console.log(chalk.blue(`\nProject: ${project.name}`));
  console.log();
  console.log(chalk.bold(`DIK Level: ${dikLevel}/10`));
  console.log(chalk.yellow(describeDikLevel(dikLevel)));
  console.log();
  console.log(chalk.gray('Breakdown:'));
  console.log(chalk.gray(`  Base:              ${breakdown.base}`));
  console.log(chalk.gray(`  Confirmation:     +${breakdown.confirmationBonus}`));
  console.log(chalk.gray(`  Track Record:     +${breakdown.trackRecord}`));
  console.log(chalk.gray(`  Experience:       +${breakdown.experience}`));
  console.log();
  console.log(chalk.gray('Stats:'));
  console.log(chalk.gray(`  Rules inferred:    ${dikData.rules_inferred}`));
  console.log(chalk.gray(`  Rules confirmed:   ${dikData.rules_confirmed}`));
  console.log(chalk.gray(`  Corrections made:  ${dikData.corrections_made}`));
  console.log(chalk.gray(`  Overrides regretted: ${dikData.overrides_regretted}`));
  console.log(chalk.gray(`  Conversations:     ${dikData.conversations}`));
  console.log();
  console.log(chalk.gray(`Active guardrails:   ${guardrails.length}`));
  console.log(chalk.gray(`Pending overrides:   ${overrides.length}`));
  console.log();
  console.log(chalk.gray('Config:'));
  console.log(chalk.gray(`  Ambient personality: ${config.ambient_personality ? chalk.green('enabled') : chalk.gray('disabled')}`));

  if (config.ambient_personality) {
    console.log();
    console.log(chalk.gray('Current personality:'));
    console.log(chalk.italic(getPersonalityInjection(dikLevel)));
  }
}

// Toggle ambient personality
async function ambientCommand(action?: string) {
  const project = findProject();
  if (!project) {
    console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
    process.exit(1);
  }

  const config = getGuardrailsConfig(project.id);

  if (!action) {
    // Show current status
    const dikData = getOrCreateProjectDik(project.id);
    const dikLevel = calculateDik(dikData);

    console.log(chalk.blue(`Ambient Personality: ${config.ambient_personality ? chalk.green('enabled') : chalk.gray('disabled')}`));
    console.log(chalk.gray(`DIK Level: ${dikLevel}/10 - ${describeDikLevel(dikLevel)}`));

    if (config.ambient_personality) {
      console.log();
      console.log(chalk.gray('Current personality injection:'));
      console.log(chalk.italic(getPersonalityInjection(dikLevel)));
    }
    return;
  }

  if (action === 'on' || action === 'enable') {
    setAmbientPersonality(project.id, true);
    const dikData = getOrCreateProjectDik(project.id);
    const dikLevel = calculateDik(dikData);
    console.log(chalk.green('Ambient personality enabled.'));
    console.log();
    console.log(chalk.gray('Current personality:'));
    console.log(chalk.italic(getPersonalityInjection(dikLevel)));
  } else if (action === 'off' || action === 'disable') {
    setAmbientPersonality(project.id, false);
    console.log(chalk.yellow('Ambient personality disabled.'));
  } else {
    console.error(chalk.red(`Unknown action: ${action}. Use 'on', 'off', 'enable', or 'disable'.`));
    process.exit(1);
  }
}

// Build the command
export const guardrailsCommand = new Command('guardrails')
  .description('Manage project guardrails (DIK - Digital Interface Knowledge)')
  .action(() => {
    // Default to list
    listCommand({});
  });

guardrailsCommand
  .command('list')
  .description('List all guardrails')
  .option('-c, --category <category>', 'Filter by category')
  .option('--confirmed', 'Only show confirmed rules')
  .option('-a, --all', 'Include inactive rules')
  .action(listCommand);

guardrailsCommand
  .command('add <category> <rule>')
  .description('Add an explicit guardrail')
  .option('-r, --rationale <rationale>', 'Why this rule exists')
  .option('-s, --severity <severity>', 'Rule severity: info, warn, block', 'warn')
  .action(addCommand);

guardrailsCommand
  .command('confirm <id>')
  .description('Confirm an inferred rule (increases DIK)')
  .action(confirmCommand);

guardrailsCommand
  .command('reject <id>')
  .description('Reject/deactivate a rule')
  .action(rejectCommand);

guardrailsCommand
  .command('analyze')
  .description('Analyze project and infer rules from patterns')
  .option('-s, --save', 'Save inferred rules as guardrails')
  .option('-c, --category <category>', 'Only analyze specific category')
  .action(analyzeCommand);

guardrailsCommand
  .command('status')
  .alias('dik')
  .description('Show DIK level and stats')
  .action(statusCommand);

guardrailsCommand
  .command('ambient [action]')
  .description('Toggle ambient personality mode (on/off)')
  .action(ambientCommand);

guardrailsCommand
  .command('set <level>')
  .description('Manually set DIK level (1-10)')
  .action((level: string) => {
    const project = findProject();
    if (!project) {
      console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
      process.exit(1);
    }

    const levelNum = parseInt(level, 10);
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 10) {
      console.error(chalk.red('DIK level must be between 1 and 10.'));
      process.exit(1);
    }

    setDikLevel(project.id, levelNum);
    const dikData = getOrCreateProjectDik(project.id);
    const actualLevel = calculateDik(dikData);

    console.log(chalk.green(`DIK level set to ${actualLevel}`));
    console.log(chalk.yellow(describeDikLevel(actualLevel)));

    const config = getGuardrailsConfig(project.id);
    if (config.ambient_personality) {
      console.log();
      console.log(chalk.gray('Current personality:'));
      console.log(chalk.italic(getPersonalityInjection(actualLevel)));
    }
  });

guardrailsCommand
  .command('import-linters')
  .description('Import rules from linter configs (.eslintrc, .rubocop.yml, etc.)')
  .option('--dry-run', 'Show what would be imported without saving')
  .action((options: { dryRun?: boolean }) => {
    const project = findProject();
    if (!project) {
      console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
      process.exit(1);
    }

    console.log(chalk.blue(`Scanning for linter configs in: ${project.path}...`));
    console.log();

    const result = importLinterRules(project.id, project.path, { dryRun: options.dryRun });

    if (result.configs.length === 0) {
      console.log(chalk.yellow('No linter configs found.'));
      console.log(chalk.gray('Supported: .eslintrc*, .rubocop.yml, pyproject.toml, .prettierrc*, tsconfig.json'));
      return;
    }

    for (const config of result.configs) {
      console.log(chalk.cyan(`${config.type.toUpperCase()}`), chalk.gray(`(${config.path})`));
      for (const rule of config.rules) {
        console.log(`  ${chalk.gray(`[${rule.category}]`)} ${rule.rule}`);
        console.log(`    ${chalk.gray(rule.rationale)}`);
      }
      console.log();
    }

    if (options.dryRun) {
      console.log(chalk.yellow(`Dry run: ${result.totalRules} rules would be imported.`));
      console.log(chalk.gray('Run without --dry-run to save.'));
    } else {
      console.log(chalk.green(`Imported ${result.saved.length} guardrails from ${result.configs.length} linter config(s).`));
      console.log(chalk.gray('Use `aimem guardrails list` to see all rules.'));
    }
  });

// List overrides awaiting vindication
guardrailsCommand
  .command('overrides')
  .description('List override events awaiting vindication')
  .option('-a, --all', 'Include resolved overrides')
  .option('--expire <days>', 'Expire overrides older than N days')
  .action((options: { all?: boolean; expire?: string }) => {
    const project = findProject();
    if (!project) {
      console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
      process.exit(1);
    }

    // Handle expire option
    if (options.expire) {
      const days = parseInt(options.expire, 10);
      if (isNaN(days) || days < 1) {
        console.error(chalk.red('Days must be a positive number.'));
        process.exit(1);
      }
      const expired = expireOldVindications(project.id, days);
      console.log(chalk.yellow(`Expired ${expired} pending overrides older than ${days} days.`));
      return;
    }

    const overrides = getOverrideEventsWithRules(project.id, !options.all);
    const pending = getPendingVindications(project.id);

    console.log(chalk.blue(`\nProject: ${project.name}`));
    console.log(chalk.gray(`Pending vindication checks: ${pending.length}`));
    console.log();

    if (overrides.length === 0) {
      console.log(chalk.gray('No overrides found.'));
      return;
    }

    console.log(chalk.bold(`Overrides (${overrides.length}):\n`));

    for (const o of overrides) {
      const isPending = o.vindication_pending === 1;
      const status = isPending ? chalk.yellow('PENDING') : chalk.gray('checked');

      console.log(`${chalk.bold(`#${o.id}`)} ${status} ${chalk.cyan(`[${o.category}]`)}`);
      console.log(`  Rule: ${o.rule}`);
      console.log(`  Reason: ${chalk.gray(o.context || 'No reason given')}`);
      if (o.suggestion) {
        console.log(`  Suggestion: ${chalk.italic(o.suggestion.slice(0, 100))}${o.suggestion.length > 100 ? '...' : ''}`);
      }
      if (o.file_path) {
        console.log(`  File: ${chalk.gray(o.file_path)}`);
        if (o.line_start && o.line_end) {
          console.log(`  Lines: ${o.line_start}-${o.line_end}`);
        }
      }
      console.log(`  Date: ${chalk.gray(o.timestamp)}`);
      console.log();
    }

    if (pending.length > 0) {
      console.log(chalk.gray('Pending overrides will be auto-checked when their files change.'));
    }
  });

// List vindicated overrides (AI was proven right)
guardrailsCommand
  .command('vindications')
  .description('List vindicated overrides (AI was right)')
  .action(() => {
    const project = findProject();
    if (!project) {
      console.error(chalk.red('No aimem project found. Run `aimem init` first.'));
      process.exit(1);
    }

    const vindications = getVindicatedEvents(project.id);
    const dikData = getOrCreateProjectDik(project.id);
    const dikLevel = calculateDik(dikData);

    console.log(chalk.blue(`\nProject: ${project.name}`));
    console.log(chalk.yellow(`DIK Level: ${dikLevel}/10`));
    console.log(chalk.green(`Total vindications: ${dikData.overrides_regretted}`));
    console.log();

    if (vindications.length === 0) {
      console.log(chalk.gray('No vindications yet.'));
      console.log(chalk.gray('When you override an AI suggestion and later implement it anyway, it will appear here.'));
      return;
    }

    console.log(chalk.bold(`Recent Vindications:\n`));

    for (const v of vindications) {
      const guardrail = getGuardrail(v.guardrail_id);

      console.log(`${chalk.green('✓')} ${chalk.bold(`#${v.id}`)} - ${chalk.gray(v.timestamp)}`);
      if (guardrail) {
        console.log(`  Rule: ${guardrail.rule}`);
        console.log(`  Category: ${chalk.cyan(`[${guardrail.category}]`)}`);
      }
      console.log();
    }

    console.log(chalk.gray('Each vindication adds +1.0 to DIK track record (max 3.0 total).'));
  });
