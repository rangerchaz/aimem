import { searchStructures, searchConversations, getLinksTo, getConversationExtractions, getFile, getStructuresByName, } from '../db/index.js';
/**
 * Get comprehensive context for a code entity
 */
export function getEntityContext(entityName) {
    const structures = getStructuresByName(entityName);
    const result = {
        structures: [],
        decisions: [],
        rejections: [],
        patterns: [],
        relatedConversations: [],
    };
    for (const structure of structures) {
        const file = getFile(structure.file_id);
        result.structures.push({
            type: structure.type,
            name: structure.name,
            file: file?.path || 'unknown',
            line: structure.line_start,
            signature: structure.signature,
            content: structure.raw_content,
        });
        // Get linked conversations and extractions
        const links = getLinksTo('structure', structure.id);
        for (const link of links) {
            if (link.source_type === 'conversation') {
                const extractions = getConversationExtractions(link.source_id);
                for (const extraction of extractions) {
                    switch (extraction.type) {
                        case 'decision':
                            result.decisions.push(extraction);
                            break;
                        case 'rejection':
                            result.rejections.push(extraction);
                            break;
                        case 'pattern':
                            result.patterns.push(extraction);
                            break;
                    }
                }
            }
        }
    }
    return result;
}
/**
 * Search for relevant context based on a query string
 */
export function searchContext(query, limit = 10) {
    const result = {
        structures: [],
        decisions: [],
        rejections: [],
        patterns: [],
        relatedConversations: [],
    };
    // Search structures
    const structures = searchStructures(query, limit);
    for (const s of structures) {
        const file = getFile(s.file_id);
        result.structures.push({
            type: s.type,
            name: s.name,
            file: file?.path || 'unknown',
            line: s.line_start,
            signature: s.signature,
            content: s.raw_content,
        });
    }
    // Search conversations
    const conversations = searchConversations(query, limit);
    for (const c of conversations) {
        result.relatedConversations.push({
            id: c.id,
            timestamp: c.timestamp,
            summary: c.summary,
        });
        // Get extractions from these conversations
        const extractions = getConversationExtractions(c.id);
        for (const e of extractions) {
            switch (e.type) {
                case 'decision':
                    result.decisions.push(e);
                    break;
                case 'rejection':
                    result.rejections.push(e);
                    break;
                case 'pattern':
                    result.patterns.push(e);
                    break;
            }
        }
    }
    return result;
}
/**
 * Format context for injection into LLM prompts
 */
export function formatContextForInjection(context) {
    const parts = [];
    if (context.structures.length > 0) {
        parts.push('## Relevant Code Structures\n');
        for (const s of context.structures) {
            parts.push(`### ${s.type}: ${s.name}`);
            parts.push(`File: ${s.file}:${s.line}`);
            if (s.signature)
                parts.push(`Signature: ${s.signature}`);
            parts.push('');
        }
    }
    if (context.decisions.length > 0) {
        parts.push('## Past Decisions\n');
        for (const d of context.decisions) {
            parts.push(`- ${d.content}`);
        }
        parts.push('');
    }
    if (context.rejections.length > 0) {
        parts.push('## Previously Rejected Approaches\n');
        for (const r of context.rejections) {
            parts.push(`- ${r.content}`);
        }
        parts.push('');
    }
    if (context.patterns.length > 0) {
        parts.push('## Established Patterns\n');
        for (const p of context.patterns) {
            parts.push(`- ${p.content}`);
        }
        parts.push('');
    }
    return parts.join('\n');
}
//# sourceMappingURL=index.js.map