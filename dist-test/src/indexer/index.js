import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { upsertFile, deleteFileStructures, insertStructure, getProjectFiles, deleteFile, getStructuresByName, createLink, getDb, updateStructureAuthorship } from '../db/index.js';
import { javascriptParser } from './parsers/javascript.js';
import { pythonParser } from './parsers/python.js';
import { rubyParser } from './parsers/ruby.js';
import { goParser } from './parsers/go.js';
import { rustParser } from './parsers/rust.js';
import { javaParser } from './parsers/java.js';
import { kotlinParser } from './parsers/kotlin.js';
import { cppParser } from './parsers/cpp.js';
import { phpParser } from './parsers/php.js';
import { isGitRepo, getBlameForLines } from '../git/index.js';
// Register all parsers
const parsers = [
    javascriptParser,
    pythonParser,
    rubyParser,
    goParser,
    rustParser,
    javaParser,
    kotlinParser,
    cppParser,
    phpParser,
];
// Build extension to parser map
const extensionMap = new Map();
for (const parser of parsers) {
    for (const ext of parser.extensions) {
        extensionMap.set(ext, parser);
    }
}
// Files/directories to ignore
const IGNORE_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/__pycache__/**',
    '**/.venv/**',
    '**/venv/**',
    '**/vendor/**',
    '**/*.min.js',
    '**/*.bundle.js',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
];
function getFileHash(content) {
    return createHash('md5').update(content).digest('hex');
}
function getParser(filePath) {
    const ext = extname(filePath).toLowerCase();
    return extensionMap.get(ext) || null;
}
async function getProjectFilePaths(projectPath) {
    const extensions = Array.from(extensionMap.keys()).map(ext => ext.slice(1)); // Remove leading dot
    const pattern = `**/*.{${extensions.join(',')}}`;
    const files = await glob(pattern, {
        cwd: projectPath,
        ignore: IGNORE_PATTERNS,
        nodir: true,
        absolute: false,
    });
    return files;
}
export async function indexFile(projectId, projectPath, relativePath, options = {}) {
    const { pendingCalls, trackBlame = false } = options;
    const fullPath = join(projectPath, relativePath);
    const parser = getParser(fullPath);
    if (!parser) {
        return 0;
    }
    try {
        const content = readFileSync(fullPath, 'utf-8');
        const hash = getFileHash(content);
        // Upsert file record
        const file = upsertFile(projectId, relativePath, hash);
        // Clear existing structures for this file
        deleteFileStructures(file.id);
        // Parse and store structures
        const structures = parser.parse(content, relativePath);
        const insertedStructures = [];
        for (const s of structures) {
            const inserted = insertStructure(file.id, s.type, s.name, s.lineStart, s.lineEnd, s.signature, s.rawContent, s.metadata);
            insertedStructures.push({ id: inserted.id, lineStart: s.lineStart });
            // Collect pending calls to resolve later
            if (pendingCalls && s.calls && s.calls.length > 0) {
                for (const calledName of s.calls) {
                    pendingCalls.push({
                        callerId: inserted.id,
                        calledName,
                    });
                }
            }
        }
        // Track git blame for structures if enabled
        if (trackBlame && insertedStructures.length > 0 && isGitRepo(projectPath)) {
            try {
                for (const s of insertedStructures) {
                    const blameData = await getBlameForLines(projectPath, relativePath, s.lineStart, s.lineStart);
                    if (blameData.length > 0) {
                        const blame = blameData[0];
                        updateStructureAuthorship(s.id, blame.author, blame.authorEmail, blame.hash);
                    }
                }
            }
            catch {
                // Blame failed, continue without it
            }
        }
        return structures.length;
    }
    catch (err) {
        // File might have been deleted or unreadable
        console.error(`Error indexing ${relativePath}:`, err);
        return 0;
    }
}
export async function indexProject(projectId, projectPath, options = {}) {
    const { trackBlame = false } = options;
    const filePaths = await getProjectFilePaths(projectPath);
    const pendingCalls = [];
    let totalStructures = 0;
    let indexedFiles = 0;
    // Clear existing call links for this project before re-indexing
    const db = getDb();
    db.prepare(`
    DELETE FROM links WHERE link_type IN ('calls', 'called_by')
    AND source_type = 'structure'
    AND source_id IN (
      SELECT s.id FROM structures s
      JOIN files f ON s.file_id = f.id
      WHERE f.project_id = ?
    )
  `).run(projectId);
    for (const relativePath of filePaths) {
        const count = await indexFile(projectId, projectPath, relativePath, { pendingCalls, trackBlame });
        if (count > 0) {
            indexedFiles++;
            totalStructures += count;
        }
    }
    // Clean up files that no longer exist
    const existingFiles = getProjectFiles(projectId);
    const currentPaths = new Set(filePaths);
    for (const file of existingFiles) {
        if (!currentPaths.has(file.path)) {
            deleteFile(file.id);
        }
    }
    // Resolve pending calls and create links
    let linksCreated = 0;
    for (const pending of pendingCalls) {
        const targets = getStructuresByName(pending.calledName, projectId);
        if (targets.length > 0) {
            // Link to the first match (could be improved with scope analysis)
            const target = targets[0];
            if (target.id !== pending.callerId) { // Don't link to self
                createLink('structure', pending.callerId, 'structure', target.id, 'calls');
                linksCreated++;
            }
        }
    }
    console.log(`  Indexed ${indexedFiles} files, ${totalStructures} structures, ${linksCreated} call links`);
    return { files: indexedFiles, structures: totalStructures, links: linksCreated };
}
export function getSupportedExtensions() {
    return Array.from(extensionMap.keys());
}
//# sourceMappingURL=index.js.map