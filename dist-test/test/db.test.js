// Database tests for aimem
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, createTestProject, createTestFile, createTestStructure, createTestConversation, createTestExtraction, createTestLink } from './helpers.js';
describe('Database Operations', () => {
    let testDb;
    before(() => {
        testDb = createTestDb();
    });
    after(() => {
        testDb.cleanup();
    });
    describe('Projects', () => {
        it('should create a project', () => {
            const project = createTestProject(testDb.db, '/test/path', 'test-project');
            assert.ok(project.id > 0);
            assert.strictEqual(project.path, '/test/path');
            assert.strictEqual(project.name, 'test-project');
            assert.ok(project.created_at);
        });
        it('should query projects by path', () => {
            createTestProject(testDb.db, '/unique/path', 'unique-project');
            const result = testDb.db.prepare('SELECT * FROM projects WHERE path = ?').get('/unique/path');
            assert.ok(result);
            assert.strictEqual(result.name, 'unique-project');
        });
        it('should enforce unique paths', () => {
            createTestProject(testDb.db, '/duplicate/path', 'first');
            assert.throws(() => {
                createTestProject(testDb.db, '/duplicate/path', 'second');
            }, /UNIQUE constraint failed/);
        });
    });
    describe('Files', () => {
        it('should create a file', () => {
            const project = createTestProject(testDb.db, '/file/test/path', 'file-test');
            const file = createTestFile(testDb.db, project.id, 'src/index.ts', 'abc123');
            assert.ok(file.id > 0);
            assert.strictEqual(file.project_id, project.id);
            assert.strictEqual(file.path, 'src/index.ts');
            assert.strictEqual(file.hash, 'abc123');
        });
        it('should cascade delete files when project is deleted', () => {
            const project = createTestProject(testDb.db, '/cascade/test', 'cascade-test');
            const file = createTestFile(testDb.db, project.id, 'file.ts', 'hash123');
            testDb.db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
            const result = testDb.db.prepare('SELECT * FROM files WHERE id = ?').get(file.id);
            assert.strictEqual(result, undefined);
        });
    });
    describe('Structures', () => {
        it('should create a structure', () => {
            const project = createTestProject(testDb.db, '/struct/test', 'struct-test');
            const file = createTestFile(testDb.db, project.id, 'app.ts', 'hash');
            const structure = createTestStructure(testDb.db, file.id, 'function', 'processData', 10, 25, 'function processData(input: string)', 'function processData(input: string) { return input; }');
            assert.ok(structure.id > 0);
            assert.strictEqual(structure.type, 'function');
            assert.strictEqual(structure.name, 'processData');
            assert.strictEqual(structure.line_start, 10);
            assert.strictEqual(structure.line_end, 25);
        });
        it('should enforce valid structure types', () => {
            const project = createTestProject(testDb.db, '/struct/type/test', 'type-test');
            const file = createTestFile(testDb.db, project.id, 'test.ts', 'hash');
            assert.throws(() => {
                testDb.db.prepare(`
          INSERT INTO structures (file_id, type, name, line_start, line_end, signature, raw_content)
          VALUES (?, 'invalid_type', 'test', 1, 1, null, 'test')
        `).run(file.id);
            }, /CHECK constraint failed/);
        });
        it('should support full-text search on structures', () => {
            const project = createTestProject(testDb.db, '/fts/test', 'fts-test');
            const file = createTestFile(testDb.db, project.id, 'search.ts', 'hash');
            createTestStructure(testDb.db, file.id, 'function', 'calculateTotal', 1, 10, 'calculateTotal(items)', 'function calculateTotal(items) {}');
            createTestStructure(testDb.db, file.id, 'function', 'validateInput', 11, 20, 'validateInput(data)', 'function validateInput(data) {}');
            // FTS5 requires prefix matching with * for partial words
            const results = testDb.db.prepare(`
        SELECT s.* FROM structures s
        JOIN structures_fts fts ON s.id = fts.rowid
        WHERE structures_fts MATCH ?
      `).all('calculateTotal');
            assert.ok(results.length > 0);
            assert.ok(results.some(r => r.name === 'calculateTotal'));
        });
    });
    describe('Conversations', () => {
        it('should create a conversation', () => {
            const project = createTestProject(testDb.db, '/conv/test', 'conv-test');
            const conv = createTestConversation(testDb.db, project.id, 'Test conversation content', 'Test summary');
            assert.ok(conv.id > 0);
            assert.strictEqual(conv.project_id, project.id);
            assert.strictEqual(conv.raw_content, 'Test conversation content');
        });
        it('should allow null project_id', () => {
            const conv = createTestConversation(testDb.db, null, 'Global conversation');
            assert.ok(conv.id > 0);
            assert.strictEqual(conv.project_id, null);
        });
        it('should support full-text search on conversations', () => {
            const project = createTestProject(testDb.db, '/conv/fts/test', 'conv-fts');
            createTestConversation(testDb.db, project.id, 'We decided to use Redis for caching', 'Redis caching decision');
            createTestConversation(testDb.db, project.id, 'Implemented JWT authentication', 'JWT auth');
            const results = testDb.db.prepare(`
        SELECT c.* FROM conversations c
        JOIN conversations_fts fts ON c.id = fts.rowid
        WHERE conversations_fts MATCH ?
      `).all('Redis');
            assert.ok(results.length > 0);
            assert.ok(results.some(r => r.raw_content.includes('Redis')));
        });
    });
    describe('Extractions', () => {
        it('should create an extraction', () => {
            const project = createTestProject(testDb.db, '/ext/test', 'ext-test');
            const conv = createTestConversation(testDb.db, project.id, 'Some content');
            const extraction = createTestExtraction(testDb.db, conv.id, 'decision', 'We should use TypeScript');
            assert.ok(extraction.id > 0);
            assert.strictEqual(extraction.conversation_id, conv.id);
            assert.strictEqual(extraction.type, 'decision');
            assert.strictEqual(extraction.content, 'We should use TypeScript');
        });
        it('should enforce valid extraction types', () => {
            const project = createTestProject(testDb.db, '/ext/type/test', 'ext-type');
            const conv = createTestConversation(testDb.db, project.id, 'Content');
            assert.throws(() => {
                testDb.db.prepare(`
          INSERT INTO extractions (conversation_id, type, content)
          VALUES (?, 'invalid', 'test')
        `).run(conv.id);
            }, /CHECK constraint failed/);
        });
        it('should cascade delete extractions when conversation is deleted', () => {
            const project = createTestProject(testDb.db, '/ext/cascade', 'ext-cascade');
            const conv = createTestConversation(testDb.db, project.id, 'Content');
            const extraction = createTestExtraction(testDb.db, conv.id, 'decision', 'A decision');
            testDb.db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
            const result = testDb.db.prepare('SELECT * FROM extractions WHERE id = ?').get(extraction.id);
            assert.strictEqual(result, undefined);
        });
    });
    describe('Links', () => {
        it('should create a link between entities', () => {
            const project = createTestProject(testDb.db, '/link/test', 'link-test');
            const file = createTestFile(testDb.db, project.id, 'link.ts', 'hash');
            const structure = createTestStructure(testDb.db, file.id, 'function', 'linked', 1, 5, null, 'code');
            const conv = createTestConversation(testDb.db, project.id, 'Conversation about linked');
            const link = createTestLink(testDb.db, 'conversation', conv.id, 'structure', structure.id, 'decision');
            assert.ok(link.id > 0);
            assert.strictEqual(link.source_type, 'conversation');
            assert.strictEqual(link.target_type, 'structure');
            assert.strictEqual(link.link_type, 'decision');
        });
        it('should enforce unique links', () => {
            const project = createTestProject(testDb.db, '/link/unique', 'link-unique');
            const file = createTestFile(testDb.db, project.id, 'unique.ts', 'hash');
            const structure = createTestStructure(testDb.db, file.id, 'class', 'UniqueClass', 1, 10, null, 'class');
            const conv = createTestConversation(testDb.db, project.id, 'Content');
            createTestLink(testDb.db, 'conversation', conv.id, 'structure', structure.id, 'touched');
            // Second insert with same values should be ignored (INSERT OR IGNORE)
            const result = createTestLink(testDb.db, 'conversation', conv.id, 'structure', structure.id, 'touched');
            // Result will be undefined because OR IGNORE prevents the insert
            assert.strictEqual(result, undefined);
        });
        it('should query links by source', () => {
            const project = createTestProject(testDb.db, '/link/query', 'link-query');
            const conv = createTestConversation(testDb.db, project.id, 'Query test');
            const file = createTestFile(testDb.db, project.id, 'q.ts', 'hash');
            const s1 = createTestStructure(testDb.db, file.id, 'function', 'func1', 1, 5, null, 'code');
            const s2 = createTestStructure(testDb.db, file.id, 'function', 'func2', 6, 10, null, 'code');
            createTestLink(testDb.db, 'conversation', conv.id, 'structure', s1.id, 'decision');
            createTestLink(testDb.db, 'conversation', conv.id, 'structure', s2.id, 'touched');
            const links = testDb.db.prepare('SELECT * FROM links WHERE source_type = ? AND source_id = ?').all('conversation', conv.id);
            assert.strictEqual(links.length, 2);
        });
    });
});
//# sourceMappingURL=db.test.js.map