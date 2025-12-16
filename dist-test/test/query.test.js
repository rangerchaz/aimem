// Query engine tests for aimem
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, createTestProject, createTestFile, createTestStructure, createTestConversation, createTestExtraction, createTestLink } from './helpers.js';
import { formatContextForInjection } from '../src/query/index.js';
describe('Query Engine', () => {
    let testDb;
    before(() => {
        testDb = createTestDb();
    });
    after(() => {
        testDb.cleanup();
    });
    describe('Structure Search', () => {
        it('should find structures by name using FTS', () => {
            const project = createTestProject(testDb.db, '/query/struct', 'query-struct');
            const file = createTestFile(testDb.db, project.id, 'service.ts', 'hash');
            createTestStructure(testDb.db, file.id, 'function', 'processPayment', 1, 20, 'processPayment(amount: number)', 'function processPayment(amount: number) { /* ... */ }');
            createTestStructure(testDb.db, file.id, 'function', 'validateCard', 21, 40, 'validateCard(cardNumber: string)', 'function validateCard(cardNumber: string) { /* ... */ }');
            // FTS5 matches full tokens - use the exact function name
            const results = testDb.db.prepare(`
        SELECT s.* FROM structures s
        JOIN structures_fts fts ON s.id = fts.rowid
        WHERE structures_fts MATCH ?
        ORDER BY rank
        LIMIT 10
      `).all('processPayment');
            assert.ok(results.length > 0);
            assert.ok(results.some(r => r.name === 'processPayment'));
        });
        it('should search by content', () => {
            const project = createTestProject(testDb.db, '/query/content', 'query-content');
            const file = createTestFile(testDb.db, project.id, 'utils.ts', 'hash');
            createTestStructure(testDb.db, file.id, 'function', 'formatDate', 1, 10, 'formatDate(date: Date)', 'function formatDate(date: Date) { return date.toISOString(); }');
            const results = testDb.db.prepare(`
        SELECT s.* FROM structures s
        JOIN structures_fts fts ON s.id = fts.rowid
        WHERE structures_fts MATCH ?
      `).all('toISOString');
            assert.ok(results.length > 0);
            assert.strictEqual(results[0].name, 'formatDate');
        });
    });
    describe('Conversation Search', () => {
        it('should find conversations by content', () => {
            const project = createTestProject(testDb.db, '/query/conv', 'query-conv');
            createTestConversation(testDb.db, project.id, 'We discussed implementing a caching layer using Redis for better performance.', 'Redis caching discussion');
            createTestConversation(testDb.db, project.id, 'Set up the PostgreSQL database with proper indexes.', 'PostgreSQL setup');
            const results = testDb.db.prepare(`
        SELECT c.* FROM conversations c
        JOIN conversations_fts fts ON c.id = fts.rowid
        WHERE conversations_fts MATCH ?
      `).all('Redis');
            assert.ok(results.length > 0);
            assert.ok(results[0].raw_content.includes('Redis'));
        });
        it('should search by summary', () => {
            const project = createTestProject(testDb.db, '/query/summary', 'query-summary');
            createTestConversation(testDb.db, project.id, 'Long conversation content here...', 'Authentication flow with OAuth2');
            const results = testDb.db.prepare(`
        SELECT c.* FROM conversations c
        JOIN conversations_fts fts ON c.id = fts.rowid
        WHERE conversations_fts MATCH ?
      `).all('OAuth2');
            assert.ok(results.length > 0);
            assert.ok(results[0].summary.includes('OAuth2'));
        });
    });
    describe('Linked Context', () => {
        it('should retrieve extractions linked to structures', () => {
            const project = createTestProject(testDb.db, '/query/linked', 'query-linked');
            const file = createTestFile(testDb.db, project.id, 'api.ts', 'hash');
            const structure = createTestStructure(testDb.db, file.id, 'function', 'handleRequest', 1, 30, 'handleRequest(req)', 'function handleRequest(req) {}');
            const conv = createTestConversation(testDb.db, project.id, 'Discussion about request handling', 'Request handling');
            createTestExtraction(testDb.db, conv.id, 'decision', 'We should validate all inputs in handleRequest before processing');
            createTestLink(testDb.db, 'conversation', conv.id, 'structure', structure.id, 'decision');
            // Query links to the structure
            const links = testDb.db.prepare(`
        SELECT * FROM links WHERE target_type = ? AND target_id = ?
      `).all('structure', structure.id);
            assert.ok(links.length > 0);
            assert.strictEqual(links[0].source_type, 'conversation');
            // Get extractions from linked conversation
            const extractions = testDb.db.prepare(`
        SELECT * FROM extractions WHERE conversation_id = ?
      `).all(conv.id);
            assert.ok(extractions.length > 0);
            assert.strictEqual(extractions[0].type, 'decision');
        });
    });
    describe('formatContextForInjection', () => {
        it('should format empty context', () => {
            const context = {
                structures: [],
                decisions: [],
                rejections: [],
                patterns: [],
                relatedConversations: []
            };
            const formatted = formatContextForInjection(context);
            assert.strictEqual(formatted, '');
        });
        it('should format structures section', () => {
            const context = {
                structures: [
                    {
                        type: 'function',
                        name: 'calculateTotal',
                        file: 'cart.ts',
                        line: 42,
                        signature: 'calculateTotal(items: Item[])',
                        content: 'function calculateTotal(items) { }'
                    }
                ],
                decisions: [],
                rejections: [],
                patterns: [],
                relatedConversations: []
            };
            const formatted = formatContextForInjection(context);
            assert.ok(formatted.includes('## Relevant Code Structures'));
            assert.ok(formatted.includes('function: calculateTotal'));
            assert.ok(formatted.includes('cart.ts:42'));
            assert.ok(formatted.includes('calculateTotal(items: Item[])'));
        });
        it('should format decisions section', () => {
            const context = {
                structures: [],
                decisions: [
                    { id: 1, conversation_id: 1, type: 'decision', content: 'Use Redis for caching', metadata: {} },
                    { id: 2, conversation_id: 1, type: 'decision', content: 'Implement rate limiting', metadata: {} }
                ],
                rejections: [],
                patterns: [],
                relatedConversations: []
            };
            const formatted = formatContextForInjection(context);
            assert.ok(formatted.includes('## Past Decisions'));
            assert.ok(formatted.includes('- Use Redis for caching'));
            assert.ok(formatted.includes('- Implement rate limiting'));
        });
        it('should format rejections section', () => {
            const context = {
                structures: [],
                decisions: [],
                rejections: [
                    { id: 1, conversation_id: 1, type: 'rejection', content: 'Avoid using global state', metadata: {} }
                ],
                patterns: [],
                relatedConversations: []
            };
            const formatted = formatContextForInjection(context);
            assert.ok(formatted.includes('## Previously Rejected Approaches'));
            assert.ok(formatted.includes('- Avoid using global state'));
        });
        it('should format patterns section', () => {
            const context = {
                structures: [],
                decisions: [],
                rejections: [],
                patterns: [
                    { id: 1, conversation_id: 1, type: 'pattern', content: 'Always use dependency injection', metadata: {} }
                ],
                relatedConversations: []
            };
            const formatted = formatContextForInjection(context);
            assert.ok(formatted.includes('## Established Patterns'));
            assert.ok(formatted.includes('- Always use dependency injection'));
        });
        it('should format complete context with all sections', () => {
            const context = {
                structures: [
                    {
                        type: 'class',
                        name: 'UserService',
                        file: 'services/user.ts',
                        line: 10,
                        signature: 'class UserService',
                        content: 'class UserService { }'
                    }
                ],
                decisions: [
                    { id: 1, conversation_id: 1, type: 'decision', content: 'Use TypeScript for type safety', metadata: {} }
                ],
                rejections: [
                    { id: 2, conversation_id: 1, type: 'rejection', content: 'Rejected vanilla JavaScript', metadata: {} }
                ],
                patterns: [
                    { id: 3, conversation_id: 1, type: 'pattern', content: 'Services should be stateless', metadata: {} }
                ],
                relatedConversations: []
            };
            const formatted = formatContextForInjection(context);
            // All sections should be present
            assert.ok(formatted.includes('## Relevant Code Structures'));
            assert.ok(formatted.includes('## Past Decisions'));
            assert.ok(formatted.includes('## Previously Rejected Approaches'));
            assert.ok(formatted.includes('## Established Patterns'));
        });
    });
    describe('Project Scoping', () => {
        it('should scope structure search by project', () => {
            const project1 = createTestProject(testDb.db, '/project/one', 'project-one');
            const project2 = createTestProject(testDb.db, '/project/two', 'project-two');
            const file1 = createTestFile(testDb.db, project1.id, 'shared.ts', 'hash1');
            const file2 = createTestFile(testDb.db, project2.id, 'shared.ts', 'hash2');
            createTestStructure(testDb.db, file1.id, 'function', 'sharedFunc', 1, 5, null, 'code from project 1');
            createTestStructure(testDb.db, file2.id, 'function', 'sharedFunc', 1, 5, null, 'code from project 2');
            // Search scoped to project 1
            const results = testDb.db.prepare(`
        SELECT s.* FROM structures s
        JOIN structures_fts fts ON s.id = fts.rowid
        JOIN files f ON s.file_id = f.id
        WHERE structures_fts MATCH ? AND f.project_id = ?
      `).all('sharedFunc', project1.id);
            assert.strictEqual(results.length, 1);
            assert.ok(results[0].raw_content.includes('project 1'));
        });
        it('should scope conversation search by project', () => {
            const project1 = createTestProject(testDb.db, '/conv/project/one', 'conv-project-one');
            const project2 = createTestProject(testDb.db, '/conv/project/two', 'conv-project-two');
            createTestConversation(testDb.db, project1.id, 'Discussion about shared topic in project one', null);
            createTestConversation(testDb.db, project2.id, 'Discussion about shared topic in project two', null);
            // Search scoped to project 1
            const results = testDb.db.prepare(`
        SELECT c.* FROM conversations c
        JOIN conversations_fts fts ON c.id = fts.rowid
        WHERE conversations_fts MATCH ? AND c.project_id = ?
      `).all('shared', project1.id);
            assert.strictEqual(results.length, 1);
            assert.ok(results[0].raw_content.includes('project one'));
        });
    });
});
//# sourceMappingURL=query.test.js.map