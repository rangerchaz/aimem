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
  findProjectForPath,
  searchCommits,
  getRecentCommits,
  getCommitById,
} from '../db/index.js';

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

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'aimem_query',
        description: 'Search code, conversations, and decisions',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Function name, class name, or keyword' },
            type: { type: 'string', enum: ['all', 'structures', 'conversations', 'decisions'], default: 'all' },
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
      {
        name: 'aimem_commits',
        description: 'Search git commit history',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search commit messages' },
            limit: { type: 'number', default: 10 },
          },
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'aimem_query': {
          const query = args?.query as string;
          const type = (args?.type as string) || 'all';
          const limit = (args?.limit as number) || 10;

          const results: { structures?: unknown[]; conversations?: unknown[]; decisions?: unknown[] } = {};

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

          // Search conversations
          if (!query) {
            return {
              content: [{ type: 'text', text: 'Please provide a query to search conversations, or an id to get a specific conversation' }],
            };
          }

          // Try to scope to current project
          const cwd = process.cwd();
          const project = findProjectForPath(cwd);
          const projectId = project?.id;

          const conversations = searchFullConversations(query, limit, projectId);

          if (conversations.length === 0) {
            return {
              content: [{ type: 'text', text: `No conversations found matching: ${query}` }],
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
                query,
                count: results.length,
                conversations: results,
              }, null, 2),
            }],
          };
        }

        case 'aimem_commits': {
          const query = args?.query as string | undefined;
          const limit = (args?.limit as number) || 10;

          const cwd = process.cwd();
          const project = findProjectForPath(cwd);
          const projectId = project?.id;

          let commits;
          if (query) {
            commits = searchCommits(query, limit, projectId);
          } else if (projectId) {
            commits = getRecentCommits(projectId, limit);
          } else {
            return {
              content: [{ type: 'text', text: 'Please provide a query or run from within a project' }],
            };
          }

          if (commits.length === 0) {
            return {
              content: [{ type: 'text', text: query ? `No commits found matching: ${query}` : 'No commits in database. Run `aimem git import` first.' }],
            };
          }

          const results = commits.map(c => ({
            hash: c.short_hash || c.hash.slice(0, 7),
            author: c.author_name,
            date: c.timestamp.split('T')[0],
            subject: c.subject,
          }));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ count: results.length, commits: results }, null, 2),
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
