import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { searchStructures, searchConversations, getStructuresByName, structureExists, fileExists, getLinksTo, getConversationExtractions, getExtraction, searchExtractions, getFile, getConversationById, searchFullConversations, findProjectForPath, } from '../db/index.js';
export async function startMcpServer() {
    const server = new Server({
        name: 'aimem',
        version: '0.1.0',
    }, {
        capabilities: {
            tools: {},
        },
    });
    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'aimem_query',
                description: 'Search for code structures (functions, classes, etc.) and past conversations. Use this to find relevant context about the codebase.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query - can be a function name, class name, or keyword',
                        },
                        type: {
                            type: 'string',
                            enum: ['all', 'structures', 'conversations'],
                            description: 'What to search: all, structures, or conversations',
                            default: 'all',
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum number of results',
                            default: 10,
                        },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'aimem_context',
                description: 'Get relevant context for a specific code entity (function, class, file). Returns the structure details plus any related decisions and conversations.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Name of the function, class, or entity to get context for',
                        },
                    },
                    required: ['name'],
                },
            },
            {
                name: 'aimem_decisions',
                description: 'Get all decisions made about a specific code entity. Useful for understanding why something was built a certain way.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        entity: {
                            type: 'string',
                            description: 'Name of the entity to get decisions for',
                        },
                    },
                    required: ['entity'],
                },
            },
            {
                name: 'aimem_verify',
                description: 'Verify that a code entity (function, class, file) exists in the codebase. Use this to check claims before making them.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Name of the function or class to verify',
                        },
                        type: {
                            type: 'string',
                            enum: ['structure', 'file'],
                            description: 'Type of entity to verify',
                            default: 'structure',
                        },
                    },
                    required: ['name'],
                },
            },
            {
                name: 'aimem_conversations',
                description: 'Search and retrieve full conversation history from past Claude/AI sessions. Use this for long-term memory - finding past discussions, decisions, and context about the project.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query to find relevant conversations (keywords, topics, or questions)',
                        },
                        id: {
                            type: 'number',
                            description: 'Get a specific conversation by ID',
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum number of conversations to return',
                            default: 5,
                        },
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
                    const query = args?.query;
                    const type = args?.type || 'all';
                    const limit = args?.limit || 10;
                    const results = {};
                    if (type === 'all' || type === 'structures') {
                        const structures = searchStructures(query, limit);
                        results.structures = structures.map(s => ({
                            type: s.type,
                            name: s.name,
                            file: getFile(s.file_id)?.path,
                            line: s.line_start,
                            signature: s.signature,
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
                    return {
                        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                    };
                }
                case 'aimem_context': {
                    const entityName = args?.name;
                    const structures = getStructuresByName(entityName);
                    if (structures.length === 0) {
                        return {
                            content: [{ type: 'text', text: `No entity found with name: ${entityName}` }],
                        };
                    }
                    const context = structures.map(s => {
                        const file = getFile(s.file_id);
                        const links = getLinksTo('structure', s.id);
                        return {
                            type: s.type,
                            name: s.name,
                            file: file?.path,
                            line: s.line_start,
                            signature: s.signature,
                            content: s.raw_content,
                            relatedConversations: links.filter(l => l.source_type === 'conversation').length,
                            decisions: links.filter(l => l.link_type === 'decision').length,
                        };
                    });
                    return {
                        content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
                    };
                }
                case 'aimem_decisions': {
                    const entity = args?.entity;
                    const structures = getStructuresByName(entity);
                    const decisions = [];
                    if (structures.length > 0) {
                        // Found matching code structures - get linked decisions
                        for (const s of structures) {
                            const links = getLinksTo('structure', s.id);
                            for (const link of links) {
                                if (link.source_type === 'extraction') {
                                    const extraction = getExtraction(link.source_id);
                                    if (extraction) {
                                        decisions.push({
                                            type: extraction.type,
                                            content: extraction.content,
                                            link_type: link.link_type,
                                            source: 'linked',
                                        });
                                    }
                                }
                                else if (link.source_type === 'conversation') {
                                    const extractions = getConversationExtractions(link.source_id);
                                    decisions.push(...extractions
                                        .filter(e => e.type === 'decision' || e.type === 'rejection')
                                        .map(e => ({ ...e, source: 'linked' })));
                                }
                            }
                        }
                    }
                    // Fallback: keyword search in decision content
                    if (decisions.length === 0) {
                        const keywordResults = searchExtractions(entity, 10);
                        for (const ext of keywordResults) {
                            decisions.push({
                                type: ext.type,
                                content: ext.content,
                                source: 'keyword_search',
                            });
                        }
                    }
                    if (decisions.length === 0) {
                        return {
                            content: [{ type: 'text', text: `No decisions found for: ${entity}` }],
                        };
                    }
                    return {
                        content: [{ type: 'text', text: JSON.stringify(decisions, null, 2) }],
                    };
                }
                case 'aimem_verify': {
                    const entityName = args?.name;
                    const entityType = args?.type || 'structure';
                    let exists = false;
                    if (entityType === 'structure') {
                        exists = structureExists(entityName);
                    }
                    else if (entityType === 'file') {
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
                    const query = args?.query;
                    const id = args?.id;
                    const limit = args?.limit || 5;
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
                default:
                    return {
                        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                        isError: true,
                    };
            }
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error.message}` }],
                isError: true,
            };
        }
    });
    // Start server
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
//# sourceMappingURL=server.js.map