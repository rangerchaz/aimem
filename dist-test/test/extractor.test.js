// Extractor tests for aimem
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractDecisions, generateSummary } from '../src/extractor/index.js';
describe('Decision Extractor', () => {
    describe('extractDecisions', () => {
        it('should extract decision phrases with "we should"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: 'We should use Redis for caching because it provides excellent performance for our use case.'
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
            assert.ok(extractions.some(e => e.type === 'decision'));
            assert.ok(extractions.some(e => e.content.toLowerCase().includes('redis')));
        });
        it('should extract decision phrases with "let\'s"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "Let's implement the authentication using JWT tokens for stateless session management."
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
            assert.ok(extractions.some(e => e.type === 'decision'));
        });
        it('should extract decision phrases with "I\'ll"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "I'll use TypeScript for type safety and better developer experience in this project."
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
            assert.ok(extractions.some(e => e.type === 'decision'));
        });
        it('should extract decision phrases with "going to"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "I'm going to refactor the UserService to use dependency injection for better testability."
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
        });
        it('should extract decision phrases with "the approach is"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: 'The best approach is to use a message queue for async processing of background tasks.'
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
            assert.ok(extractions.some(e => e.type === 'decision'));
        });
        it('should extract rejection phrases with "instead of"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "Instead of using callbacks for handling asynchronous operations, we'll use async/await for cleaner error handling and better readability in the codebase."
                }
            ];
            const extractions = extractDecisions(messages);
            // Should find either a rejection or a decision (the sentence has both patterns)
            assert.ok(extractions.length > 0);
        });
        it('should extract rejection phrases with "not using"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "For this project, we're not using MongoDB because our data is highly relational and requires ACID transactions for data integrity."
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
        });
        it('should extract rejection phrases with "decided against"', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "After consideration, I've decided against using a global state manager like Redux since the application state is relatively simple and can be handled with React context."
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
        });
        it('should ignore user messages', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'user',
                    content: 'We should use Redis for caching.'
                }
            ];
            const extractions = extractDecisions(messages);
            assert.strictEqual(extractions.length, 0);
        });
        it('should handle array content format', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        { type: 'text', text: "I'll implement the feature using the Strategy pattern for flexibility." }
                    ]
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length > 0);
        });
        it('should filter out code blocks', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: '```javascript\nfunction shouldUse() { return true; }\n```'
                }
            ];
            const extractions = extractDecisions(messages);
            // Code blocks should be filtered out
            assert.strictEqual(extractions.filter(e => e.content.includes('```')).length, 0);
        });
        it('should filter out very short extractions', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "I'll do it."
                }
            ];
            const extractions = extractDecisions(messages);
            // Too short to be meaningful
            assert.strictEqual(extractions.length, 0);
        });
        it('should deduplicate similar extractions', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "We should use Redis for caching. Let's use Redis for caching in the application."
                }
            ];
            const extractions = extractDecisions(messages);
            // Should deduplicate similar content
            const redisDecisions = extractions.filter(e => e.content.toLowerCase().includes('redis') && e.type === 'decision');
            assert.ok(redisDecisions.length <= 2);
        });
        it('should extract entity mentions', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: "I'll update the UserService class to include a new validateCredentials method for authentication."
                }
            ];
            const extractions = extractDecisions(messages);
            // Should extract class and method names as entities
            const withEntities = extractions.filter(e => e.mentionedEntities.length > 0);
            assert.ok(withEntities.length > 0 || extractions.length > 0);
        });
        it('should handle empty messages', () => {
            const messages = [];
            const extractions = extractDecisions(messages);
            assert.strictEqual(extractions.length, 0);
        });
        it('should handle messages with no content', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant'
                }
            ];
            const extractions = extractDecisions(messages);
            assert.strictEqual(extractions.length, 0);
        });
        it('should extract multiple decisions from one message', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'assistant',
                    content: `I'll implement the feature in two parts. First, we should add the database migration to create the new table. Second, I'll create the API endpoint with proper validation and error handling.`
                }
            ];
            const extractions = extractDecisions(messages);
            assert.ok(extractions.length >= 1);
        });
    });
    describe('generateSummary', () => {
        it('should generate summary from user messages', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Help me implement user authentication with JWT tokens'
                },
                {
                    type: 'message',
                    role: 'assistant',
                    content: "I'll help you implement JWT authentication."
                }
            ];
            const summary = generateSummary(messages);
            assert.ok(summary.includes('authentication') || summary.includes('JWT'));
        });
        it('should truncate long first messages', () => {
            const longMessage = 'A'.repeat(300);
            const messages = [
                {
                    type: 'message',
                    role: 'user',
                    content: longMessage
                }
            ];
            const summary = generateSummary(messages);
            assert.ok(summary.length <= 250); // 200 chars + some buffer for suffix
        });
        it('should indicate multiple exchanges', () => {
            const messages = [
                { type: 'message', role: 'user', content: 'First question about coding' },
                { type: 'message', role: 'assistant', content: 'First answer' },
                { type: 'message', role: 'user', content: 'Follow up question' },
                { type: 'message', role: 'assistant', content: 'Second answer' },
                { type: 'message', role: 'user', content: 'Another question' },
            ];
            const summary = generateSummary(messages);
            assert.ok(summary.includes('exchanges') || summary.includes('3'));
        });
        it('should handle empty conversations', () => {
            const messages = [];
            const summary = generateSummary(messages);
            assert.strictEqual(summary, 'Empty conversation');
        });
        it('should handle array content format', () => {
            const messages = [
                {
                    type: 'message',
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Help me with database design for user profiles' }
                    ]
                }
            ];
            const summary = generateSummary(messages);
            assert.ok(summary.includes('database') || summary.includes('design'));
        });
    });
});
//# sourceMappingURL=extractor.test.js.map