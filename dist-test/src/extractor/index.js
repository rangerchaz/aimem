// Decision and pattern extraction from conversation transcripts
/**
 * Extract decisions, rejections, and patterns from conversation messages.
 * Uses pattern matching - no LLM required.
 */
export function extractDecisions(messages) {
    const extractions = [];
    // Decision patterns - phrases that indicate a choice was made
    const decisionPatterns = [
        /(?:we should|let's|I'll|I will|going to|decided to|will use|using|chose|choosing|the best approach is|recommend using)\s+(.+?)(?:\.|$)/gi,
        /(?:the approach|the solution|the fix|the implementation|the strategy)\s+(?:is|will be|should be)\s+(.+?)(?:\.|$)/gi,
        /(?:because|since|the reason is|this is because)\s+(.+?)(?:\.|$)/gi,
        /(?:I've implemented|I've added|I've created|I've updated)\s+(.+?)(?:\.|$)/gi,
    ];
    // Rejection patterns - phrases that indicate something was ruled out
    const rejectionPatterns = [
        /(?:instead of|rather than|not using|won't use|shouldn't use|avoid using|don't use)\s+(.+?)(?:\.|$)/gi,
        /(?:rejected|ruled out|decided against|not recommended|wouldn't work)\s+(.+?)(?:\.|$)/gi,
        /(?:the problem with|the issue with|doesn't work because)\s+(.+?)(?:\.|$)/gi,
    ];
    // Entity patterns for linking to code structures
    const classPattern = /\b([A-Z][a-zA-Z0-9]*(?:Service|Controller|Model|Helper|Manager|Handler|Factory|Builder|Provider|Middleware|Client|Server|Worker|Job|Task|Command|Query|Event|Listener|Observer|Strategy|Adapter|Decorator|Proxy|Repository|Gateway|Validator|Serializer|Parser|Formatter|Renderer|Component|Module|Plugin|Extension)?)\b/g;
    const functionPattern = /\b([a-z_][a-z0-9_]*)\s*\(/g;
    const methodPattern = /(?:def|function|const|let|var)\s+([a-z_][a-z0-9_]*)/g;
    const filePattern = /(?:in|from|file|at)\s+[`"']?([a-zA-Z0-9_/.-]+\.[a-z]+)[`"']?/gi;
    for (const msg of messages) {
        if (msg.role !== 'assistant')
            continue;
        const content = getMessageContent(msg);
        if (!content)
            continue;
        // Extract decisions
        for (const pattern of decisionPatterns) {
            pattern.lastIndex = 0; // Reset regex state
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const sentence = getSentenceAround(content, match.index);
                if (isValidExtraction(sentence)) {
                    const entities = extractEntities(sentence, classPattern, functionPattern, methodPattern);
                    extractions.push({
                        type: 'decision',
                        content: cleanSentence(sentence),
                        mentionedEntities: entities,
                        metadata: {
                            patternType: 'decision',
                            originalMatch: match[0].slice(0, 100)
                        }
                    });
                }
            }
        }
        // Extract rejections
        for (const pattern of rejectionPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const sentence = getSentenceAround(content, match.index);
                if (isValidExtraction(sentence)) {
                    const entities = extractEntities(sentence, classPattern, functionPattern, methodPattern);
                    extractions.push({
                        type: 'rejection',
                        content: cleanSentence(sentence),
                        mentionedEntities: entities,
                        metadata: {
                            patternType: 'rejection',
                            originalMatch: match[0].slice(0, 100)
                        }
                    });
                }
            }
        }
    }
    // Deduplicate and return
    return deduplicateExtractions(extractions);
}
/**
 * Get text content from a message, handling different content formats
 */
function getMessageContent(msg) {
    if (typeof msg.content === 'string') {
        return msg.content;
    }
    if (Array.isArray(msg.content)) {
        return msg.content
            .map(c => c.text)
            .filter(Boolean)
            .join('\n');
    }
    return '';
}
/**
 * Get the sentence containing the match index
 */
function getSentenceAround(text, index) {
    // Find sentence boundaries (., !, ?, or newlines)
    const sentenceEnders = /[.!?]\s|\n\n/g;
    let start = 0;
    let end = text.length;
    // Find start of sentence
    const beforeText = text.slice(0, index);
    const lastEnder = beforeText.search(/[.!?]\s[^.!?]*$/);
    if (lastEnder !== -1) {
        start = lastEnder + 2;
    }
    const lastNewline = beforeText.lastIndexOf('\n\n');
    if (lastNewline > start) {
        start = lastNewline + 2;
    }
    // Find end of sentence
    const afterText = text.slice(index);
    const nextEnderMatch = afterText.match(/[.!?](?:\s|$)/);
    if (nextEnderMatch && nextEnderMatch.index !== undefined) {
        end = index + nextEnderMatch.index + 1;
    }
    const nextNewline = afterText.indexOf('\n\n');
    if (nextNewline !== -1 && index + nextNewline < end) {
        end = index + nextNewline;
    }
    return text.slice(start, end).trim();
}
/**
 * Check if extraction is valid (not too short, not too long, not code)
 */
function isValidExtraction(sentence) {
    // Too short or too long
    if (sentence.length < 30 || sentence.length > 500) {
        return false;
    }
    // Looks like code (too many special characters)
    const codeIndicators = sentence.match(/[{}()\[\];=<>]/g);
    if (codeIndicators && codeIndicators.length > 5) {
        return false;
    }
    // Is a code block
    if (sentence.includes('```') || sentence.startsWith('  ') || sentence.startsWith('\t')) {
        return false;
    }
    // Is just a list item number or bullet
    if (/^[\d\-*•]\s/.test(sentence) && sentence.length < 50) {
        return false;
    }
    return true;
}
/**
 * Clean up a sentence for storage
 */
function cleanSentence(sentence) {
    return sentence
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/^[-*•]\s*/, '') // Remove list markers
        .replace(/^\d+\.\s*/, '') // Remove numbered list markers
        .trim();
}
/**
 * Extract entity names from text using patterns
 */
function extractEntities(text, ...patterns) {
    const entities = new Set();
    for (const pattern of patterns) {
        const p = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = p.exec(text)) !== null) {
            const entity = match[1];
            // Filter out common false positives
            if (entity && entity.length > 2 && !isCommonWord(entity)) {
                entities.add(entity);
            }
        }
    }
    return [...entities];
}
/**
 * Check if a word is too common to be a meaningful entity
 */
function isCommonWord(word) {
    const commonWords = new Set([
        'the', 'this', 'that', 'these', 'those', 'then', 'than',
        'will', 'would', 'should', 'could', 'can', 'may', 'might',
        'have', 'has', 'had', 'get', 'set', 'let', 'var', 'const',
        'function', 'class', 'def', 'return', 'true', 'false', 'null',
        'undefined', 'new', 'for', 'while', 'if', 'else', 'try', 'catch',
        'import', 'export', 'from', 'require', 'module', 'use', 'using',
        'not', 'and', 'but', 'with', 'was', 'were', 'are', 'been',
        'being', 'does', 'done', 'doing', 'did', 'make', 'made', 'making',
        'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Error',
        'Promise', 'Map', 'Set', 'JSON', 'Math', 'console', 'process',
    ]);
    return commonWords.has(word) || commonWords.has(word.toLowerCase());
}
/**
 * Remove duplicate or very similar extractions
 */
function deduplicateExtractions(extractions) {
    const seen = new Set();
    const result = [];
    for (const ext of extractions) {
        // Create a normalized key for comparison
        const key = ext.content
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .slice(0, 80);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(ext);
        }
    }
    return result;
}
/**
 * Generate a summary of the conversation for storage
 */
export function generateSummary(messages) {
    const userMessages = messages
        .filter(m => m.role === 'user')
        .map(m => getMessageContent(m))
        .filter(c => c.length > 0);
    if (userMessages.length === 0) {
        return 'Empty conversation';
    }
    // Use first user message as base for summary
    const firstMessage = userMessages[0].slice(0, 200);
    const topicHint = userMessages.length > 1
        ? ` (${userMessages.length} exchanges)`
        : '';
    return `${firstMessage}${topicHint}`;
}
//# sourceMappingURL=index.js.map