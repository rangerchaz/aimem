import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  searchStructures,
  searchConversations,
  structureExists,
  fileExists,
  searchExtractions,
  getStructuresByName,
  getLinksTo,
  getExtraction,
  getFile,
  getConversationById,
  searchFullConversations,
  getRecentConversations,
  findProjectForPath,
  searchCommits,
  getProjectGuardrails,
  insertGuardrail,
  confirmGuardrail,
  deactivateGuardrail,
  getOrCreateProjectDik,
  incrementDikCounter,
  setAmbientPersonality,
  getGuardrailsConfig,
  setDikLevel,
} from '../db/index.js';
import {
  checkGuardrails,
  overrideGuardrail,
  vindicateOverride,
  analyzeProject,
  saveProposedRules,
  calculateDik,
  getDikBreakdown,
  describeDikLevel,
  getPersonalityInjection,
} from '../guardrails/index.js';
import type { GuardrailCategory, GuardrailSeverity } from '../types/index.js';

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: 'aimem',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define base tools (always available)
  const baseTools = [
    {
      name: 'aimem_query',
      description: 'Search code, conversations, decisions, and commits',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Function name, class name, or keyword' },
          type: { type: 'string', enum: ['all', 'structures', 'conversations', 'decisions', 'commits'], default: 'all' },
          limit: { type: 'number', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'aimem_verify',
      description: 'Check if a function, class, or file exists',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to verify' },
          type: { type: 'string', enum: ['structure', 'file'], default: 'structure' },
        },
        required: ['name'],
      },
    },
    {
      name: 'aimem_conversations',
      description: 'Search past AI conversation history',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords' },
          id: { type: 'number', description: 'Get by ID' },
          limit: { type: 'number', default: 5 },
        },
      },
    },
  ];

  // Define guardrails tools (conditionally included)
  const guardrailsTools = [
    {
      name: 'aimem_guardrails_check',
      description: 'Check if a proposed action violates any project rules. Returns DIK-adjusted pushback if violations found.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'What the user wants to do' },
          context: { type: 'string', description: 'Additional context (file being modified, etc.)' },
        },
        required: ['action'],
      },
    },
    {
      name: 'aimem_guardrails_add',
      description: 'Add an explicit rule to the project guardrails',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['design', 'architecture', 'naming', 'security', 'performance', 'testing'], description: 'Rule category' },
          rule: { type: 'string', description: 'The actual rule' },
          rationale: { type: 'string', description: 'Why this rule exists' },
          severity: { type: 'string', enum: ['info', 'warn', 'block'], default: 'warn' },
        },
        required: ['category', 'rule'],
      },
    },
    {
      name: 'aimem_guardrails_list',
      description: 'List guardrails for current project',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['design', 'architecture', 'naming', 'security', 'performance', 'testing'], description: 'Filter by category' },
          confirmed_only: { type: 'boolean', description: 'Only show user-confirmed rules', default: false },
          active_only: { type: 'boolean', description: 'Only show active rules', default: true },
        },
      },
    },
    {
      name: 'aimem_guardrails_respond',
      description: 'Respond to a guardrail: confirm, reject, override, or vindicate',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['confirm', 'reject', 'override', 'vindicate'], description: 'Action to take' },
          id: { type: 'number', description: 'Guardrail ID (for confirm/reject/override) or event ID (for vindicate)' },
          reason: { type: 'string', description: 'Required for reject/override: why' },
        },
        required: ['action', 'id'],
      },
    },
    {
      name: 'aimem_guardrails_analyze',
      description: 'Scan current project and infer rules from patterns. Use this to onboard a new project.',
      inputSchema: {
        type: 'object',
        properties: {
          categories: {
            type: 'array',
            items: { type: 'string', enum: ['design', 'architecture', 'naming', 'security', 'performance', 'testing'] },
            description: 'Which categories to analyze (default: all)',
          },
          save: { type: 'boolean', description: 'Save proposed rules as inferred guardrails', default: false },
        },
      },
    },
    {
      name: 'aimem_guardrails_config',
      description: 'Get or set guardrails config. Returns status, DIK level, and personality.',
      inputSchema: {
        type: 'object',
        properties: {
          set_dik: { type: 'number', description: 'Set DIK level (1-10)', minimum: 1, maximum: 10 },
          ambient_personality: { type: 'boolean', description: 'Enable/disable ambient personality mode' },
        },
      },
    },
  ];

  // List available tools - conditionally include guardrails if project uses them
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const project = findProjectForPath(process.cwd());

    // Check if project has guardrails configured (any rules or DIK level set)
    let includeGuardrails = false;
    if (project) {
      const guardrails = getProjectGuardrails(project.id, { activeOnly: true });
      const dikData = getOrCreateProjectDik(project.id);
      includeGuardrails = guardrails.length > 0 || dikData.level > 1;
    }

    return {
      tools: includeGuardrails ? [...baseTools, ...guardrailsTools] : baseTools,
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'aimem_query': {
          const query = args?.query as string;
          const type = (args?.type as string) || 'all';
          const limit = (args?.limit as number) || 10;

          const results: { structures?: unknown[]; conversations?: unknown[]; decisions?: unknown[]; commits?: unknown[] } = {};

          if (type === 'all' || type === 'structures') {
            const structures = searchStructures(query, limit);
            results.structures = structures.map(s => ({
              type: s.type,
              name: s.name,
              file: getFile(s.file_id)?.path,
              line: s.line_start,
              signature: s.signature,
              author: s.last_author || undefined,
              commit: s.last_commit_hash?.slice(0, 7) || undefined,
            }));
          }

          if (type === 'all' || type === 'conversations') {
            const conversations = searchConversations(query, limit);
            results.conversations = conversations.map(c => ({
              id: c.id,
              timestamp: c.timestamp,
              model: c.model,
              summary: c.summary || c.raw_content.slice(0, 200),
            }));
          }

          if (type === 'all' || type === 'decisions') {
            const decisions: Array<{ type: string; content: string; source: string }> = [];
            const seen = new Set<string>();

            // First: try to find linked decisions via structure graph
            const structures = getStructuresByName(query);
            for (const s of structures) {
              const links = getLinksTo('structure', s.id);
              for (const link of links) {
                if (link.source_type === 'extraction') {
                  const extraction = getExtraction(link.source_id);
                  if (extraction && !seen.has(extraction.content)) {
                    seen.add(extraction.content);
                    decisions.push({
                      type: extraction.type,
                      content: extraction.content,
                      source: 'linked',
                    });
                  }
                }
              }
            }

            // Fallback: keyword search in extraction content
            const keywordResults = searchExtractions(query, limit);
            for (const e of keywordResults) {
              if (!seen.has(e.content)) {
                seen.add(e.content);
                decisions.push({
                  type: e.type,
                  content: e.content,
                  source: 'keyword',
                });
              }
            }

            results.decisions = decisions.slice(0, limit);
          }

          if (type === 'all' || type === 'commits') {
            const project = findProjectForPath(process.cwd());
            const commits = searchCommits(query, limit, project?.id);
            results.commits = commits.map(c => ({
              hash: c.short_hash || c.hash.slice(0, 7),
              author: c.author_name,
              date: c.timestamp.split('T')[0],
              subject: c.subject,
            }));
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        }

        case 'aimem_verify': {
          const entityName = args?.name as string;
          const entityType = (args?.type as string) || 'structure';

          let exists = false;
          if (entityType === 'structure') {
            exists = structureExists(entityName);
          } else if (entityType === 'file') {
            exists = fileExists(entityName);
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                name: entityName,
                type: entityType,
                exists,
                message: exists
                  ? `${entityType} "${entityName}" exists in the codebase`
                  : `${entityType} "${entityName}" was NOT found in the codebase`,
              }, null, 2),
            }],
          };
        }

        case 'aimem_conversations': {
          const query = args?.query as string | undefined;
          const id = args?.id as number | undefined;
          const limit = (args?.limit as number) || 5;

          // Get specific conversation by ID
          if (id !== undefined) {
            const conversation = getConversationById(id);
            if (!conversation) {
              return {
                content: [{ type: 'text', text: `No conversation found with ID: ${id}` }],
              };
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  id: conversation.id,
                  timestamp: conversation.timestamp,
                  model: conversation.model,
                  tool: conversation.tool,
                  summary: conversation.summary,
                  content: conversation.raw_content,
                }, null, 2),
              }],
            };
          }

          // Try to scope to current project
          const cwd = process.cwd();
          const project = findProjectForPath(cwd);
          const projectId = project?.id;

          // Get recent conversations if no query provided
          const conversations = query
            ? searchFullConversations(query, limit, projectId)
            : getRecentConversations(limit, projectId);

          if (conversations.length === 0) {
            return {
              content: [{ type: 'text', text: query ? `No conversations found matching: ${query}` : 'No conversations found' }],
            };
          }

          const results = conversations.map(c => ({
            id: c.id,
            timestamp: c.timestamp,
            model: c.model,
            tool: c.tool,
            summary: c.summary,
            content: c.raw_content.length > 2000
              ? c.raw_content.slice(0, 2000) + '... [truncated - use id to get full content]'
              : c.raw_content,
          }));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                mode: query ? 'search' : 'recent',
                query: query || undefined,
                count: results.length,
                conversations: results,
              }, null, 2),
            }],
          };
        }

        // ============ Guardrails tools (DIK) ============

        case 'aimem_guardrails_check': {
          const action = args?.action as string;
          const context = args?.context as string | undefined;

          const project = findProjectForPath(process.cwd());
          if (!project) {
            return {
              content: [{ type: 'text', text: 'No aimem project found for current directory. Run `aimem init` first.' }],
              isError: true,
            };
          }

          const result = checkGuardrails(project.id, action, context);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                violations: result.violations,
                dik_level: result.dik_level,
                response: result.response || null,
                clean: result.violations.length === 0,
              }, null, 2),
            }],
          };
        }

        case 'aimem_guardrails_add': {
          const category = args?.category as GuardrailCategory;
          const rule = args?.rule as string;
          const rationale = args?.rationale as string | undefined;
          const severity = (args?.severity as GuardrailSeverity) || 'warn';

          const project = findProjectForPath(process.cwd());
          if (!project) {
            return {
              content: [{ type: 'text', text: 'No aimem project found for current directory.' }],
              isError: true,
            };
          }

          const guardrail = insertGuardrail(project.id, category, rule, rationale || null, severity, 'explicit');

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ id: guardrail.id, success: true }, null, 2),
            }],
          };
        }

        case 'aimem_guardrails_list': {
          const category = args?.category as GuardrailCategory | undefined;
          const confirmedOnly = args?.confirmed_only as boolean || false;
          const activeOnly = args?.active_only !== false;

          const project = findProjectForPath(process.cwd());
          if (!project) {
            return {
              content: [{ type: 'text', text: 'No aimem project found for current directory.' }],
              isError: true,
            };
          }

          const guardrails = getProjectGuardrails(project.id, { category, confirmedOnly, activeOnly });
          const dikData = getOrCreateProjectDik(project.id);
          const dikLevel = calculateDik(dikData);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                rules: guardrails.map(g => ({
                  id: g.id,
                  category: g.category,
                  rule: g.rule,
                  rationale: g.rationale,
                  severity: g.severity,
                  source: g.source,
                  confirmed: g.confirmed === 1,
                })),
                dik_level: dikLevel,
                dik_description: describeDikLevel(dikLevel),
              }, null, 2),
            }],
          };
        }

        case 'aimem_guardrails_respond': {
          const action = args?.action as 'confirm' | 'reject' | 'override' | 'vindicate';
          const id = args?.id as number;
          const reason = args?.reason as string | undefined;

          const project = findProjectForPath(process.cwd());
          if (!project) {
            return {
              content: [{ type: 'text', text: 'No aimem project found for current directory.' }],
              isError: true,
            };
          }

          switch (action) {
            case 'confirm': {
              const success = confirmGuardrail(id);
              if (success) {
                incrementDikCounter(project.id, 'rules_confirmed');
              }
              const dikData = getOrCreateProjectDik(project.id);
              const newDikLevel = calculateDik(dikData);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success, action, new_dik_level: newDikLevel }, null, 2) }],
              };
            }
            case 'reject': {
              const success = deactivateGuardrail(id);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success, action }, null, 2) }],
              };
            }
            case 'override': {
              if (!reason) {
                return {
                  content: [{ type: 'text', text: 'Reason is required for override action' }],
                  isError: true,
                };
              }
              const eventId = overrideGuardrail(id, project.id, reason);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true, action, event_id: eventId }, null, 2) }],
              };
            }
            case 'vindicate': {
              const newDikLevel = vindicateOverride(id, project.id);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true, action, new_dik_level: newDikLevel }, null, 2) }],
              };
            }
            default:
              return {
                content: [{ type: 'text', text: `Unknown action: ${action}` }],
                isError: true,
              };
          }
        }

        case 'aimem_guardrails_analyze': {
          const categories = args?.categories as GuardrailCategory[] | undefined;
          const save = args?.save as boolean || false;

          const project = findProjectForPath(process.cwd());
          if (!project) {
            return {
              content: [{ type: 'text', text: 'No aimem project found for current directory.' }],
              isError: true,
            };
          }

          const proposed = analyzeProject(project.id, { categories });

          if (save && proposed.length > 0) {
            const saved = saveProposedRules(project.id, proposed);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  proposed_rules: proposed,
                  saved: saved.length,
                  message: `Saved ${saved.length} inferred guardrails. Use aimem_guardrails_confirm to validate them.`,
                }, null, 2),
              }],
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                proposed_rules: proposed,
                message: proposed.length > 0
                  ? `Found ${proposed.length} patterns. Use save=true to create guardrails from them.`
                  : 'No patterns detected. Index more code or add explicit rules.',
              }, null, 2),
            }],
          };
        }

        case 'aimem_guardrails_config': {
          const ambientPersonality = args?.ambient_personality as boolean | undefined;
          const setDikParam = args?.set_dik as number | undefined;

          const project = findProjectForPath(process.cwd());
          if (!project) {
            return {
              content: [{ type: 'text', text: 'No aimem project found for current directory.' }],
              isError: true,
            };
          }

          // Apply settings if provided
          if (ambientPersonality !== undefined) {
            setAmbientPersonality(project.id, ambientPersonality);
          }
          if (setDikParam !== undefined) {
            setDikLevel(project.id, setDikParam);
          }

          // Get current state
          const config = getGuardrailsConfig(project.id);
          const dikData = getOrCreateProjectDik(project.id);
          const dikLevel = calculateDik(dikData);
          const breakdown = getDikBreakdown(dikData);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                config: {
                  enabled: config.enabled,
                  ambient_personality: config.ambient_personality,
                },
                dik: {
                  level: dikLevel,
                  description: describeDikLevel(dikLevel),
                  breakdown,
                },
                personality: config.ambient_personality ? getPersonalityInjection(dikLevel) : null,
              }, null, 2),
            }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
