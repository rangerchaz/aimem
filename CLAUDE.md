# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build       # Compile TypeScript
npm run dev         # Watch mode for TypeScript
npm test            # Run tests (compiles to dist-test/ first)
npm run test:watch  # Watch mode for tests
npm link            # Install globally for local development

# Run without global install
node dist/cli/index.js <command>
```

## Architecture Overview

aimem provides persistent memory for AI coding assistants by:
1. Intercepting LLM API calls via a proxy (capture-only)
2. Extracting decisions/rejections from conversations using regex patterns
3. Storing in SQLite with FTS5 full-text search
4. Exposing query tools via MCP (Model Context Protocol)

### Core Data Flow

```
LLM API Request → mockttp proxy → Pass to LLM API
LLM API Response ← mockttp ← Parse response (including SSE streaming)
                           ← Extract decisions via regex
                           ← Store in SQLite with FTS5

Context retrieval: MCP tools query SQLite on-demand
```

### Key Components

| Path | Purpose |
|------|---------|
| `src/proxy/interceptor-mockttp.ts` | Node.js proxy - captures responses, extracts decisions (no injection) |
| `src/db/` | SQLite database with FTS5 full-text search |
| `src/mcp/server.ts` | MCP server exposing aimem_query, aimem_verify, aimem_conversations |
| `src/indexer/` | Code parser that extracts functions/classes/methods from source files |
| `src/indexer/parsers/` | Language-specific parsers (JS/TS, Python, Ruby, Go) |
| `src/extractor/` | Decision extraction from conversation text |
| `src/cli/commands/` | CLI commands (init, reindex, start, stop, status, query, setup, import, visualize, git) |
| `src/git/` | Git integration: commit parsing, blame tracking, hooks |
| `src/visualize/` | Interactive HTML dashboard using Cytoscape.js and D3.js |

### Database Schema (SQLite)

- **projects**: Indexed codebases (path, name)
- **files**: Source files with content hashes
- **structures**: Functions, classes, methods with signatures, line numbers, and git authorship
- **conversations**: Stored LLM conversations (model, tool, summary, raw_content)
- **extractions**: Decisions/rejections extracted from conversations
- **commits**: Git commit history with FTS search
- **commit_links**: Links between commits and structures/extractions
- **links**: Graph edges connecting entities (extraction→structure, structure→structure)

### Proxy Architecture

The proxy (`src/proxy/interceptor-mockttp.ts`) is a pure Node.js HTTPS proxy using mockttp:
- Targets specific LLM API hosts (Anthropic, OpenAI, Google, Mistral, etc.)
- Capture-only: no request modification, just observes responses
- Parses SSE streaming responses to extract complete assistant content
- Extracts decisions/rejections using regex patterns
- Stores in SQLite for later querying via MCP tools

**v2.0 Design:** Context is retrieved on-demand via MCP tools, not injected. This works with any tool that supports project instruction files (CLAUDE.md, .cursorrules, copilot-instructions.md).

## Memory (aimem)

Before claiming something isn't implemented or needs to be built:
1. Query `aimem_query <topic> type=decisions` to check past decisions
2. Query `aimem_verify <name>` to check if a function/class exists

Available aimem MCP tools:
- `aimem_query <search>` - Search code, conversations, decisions, commits (type: all|structures|conversations|decisions|commits)
- `aimem_verify <name>` - Does this function/class/file exist?
- `aimem_conversations <query>` - Search past conversation history (long-term memory)

## Git Integration

```bash
aimem git import [--limit N]     # Import commit history into aimem
aimem git link [--auto]          # Link recent decisions to HEAD commit
aimem git hooks install          # Install post-commit hook for auto-linking
aimem git hooks status           # Check installed hooks
aimem git search <query>         # Search commit messages
aimem git blame <file>           # Show blame with aimem context
```

The git integration tracks:
- Commit history with FTS search on messages
- Git authorship on code structures (who last modified each function)
- Links between AI decisions and the commits where they were applied
