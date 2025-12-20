# aimem

**Your AI assistant finally remembers.**

Every session starts fresh—decisions forgotten, context lost, explanations repeated.

aimem fixes this:

- Captures LLM conversations via local proxy
- Extracts decisions automatically
- Indexes your codebase
- Searchable via MCP tools or CLI

*"Why did we choose Redis?"* → Get the answer from last week's chat.

No cloud. No accounts. Everything stays on your machine.

## Lean Architecture

- **Pure Node.js** - No Python dependencies (mockttp proxy)
- **Capture-only** - No injection, uses CLAUDE.md for instructions
- **3 MCP tools** - ~150 tokens overhead
- **Git integration** - Link decisions to commits

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your AI Tool                             │
│                  (Claude Code, Cursor, etc.)                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ API calls
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     mockttp Proxy (capture-only)                │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ Passthrough     │    │ Capture Response│    │  Extract    │ │
│  │ (no injection)  │    │ (SSE streaming) │    │  Decisions  │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SQLite Database                            │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌───────────────┐   │
│  │ projects │ │ files    │ │ structures  │ │ conversations │   │
│  └──────────┘ └──────────┘ └─────────────┘ └───────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐                     │
│  │extractions│ │ commits │ │    links    │  + FTS5 search     │
│  └──────────┘ └──────────┘ └─────────────┘                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
┌─────────────────────┐          ┌─────────────────────┐
│    MCP Server       │          │    File Watcher     │
│  (on-demand query)  │          │  (live indexing)    │
└─────────────────────┘          └─────────────────────┘
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **CLI** | `src/cli/` | Commands: init, start, stop, query, setup, import, visualize, git |
| **Database** | `src/db/` | SQLite + FTS5 for storage and search |
| **Indexer** | `src/indexer/` | Parse code into structures (functions, classes) |
| **Parsers** | `src/indexer/parsers/` | Language-specific (JS/TS, Python, Ruby, Go) |
| **Extractor** | `src/extractor/` | Extract decisions/rejections from conversations |
| **MCP Server** | `src/mcp/` | Model Context Protocol tools for Claude Code |
| **Proxy** | `src/proxy/` | mockttp-based HTTPS proxy (Node.js) |
| **Git** | `src/git/` | Git integration: commits, blame, hooks |
| **Visualize** | `src/visualize/` | Interactive dashboard (Cytoscape.js, D3.js) |

### Data Flow

1. **Indexing**: `aimem init` parses your codebase → stores structures in SQLite
2. **Capture**: Proxy intercepts LLM responses → extracts decisions → stores in DB
3. **Query**: MCP tools search on-demand → return relevant context
4. **Git**: Link decisions to commits → track who changed what

## Installation

```bash
npm install -g @rangerchaz/aimem
```

Requires Node.js 18+. No Python required.

## Quick Start

### For Claude Code Users

```bash
# 1. Set up proxy (installs cert + configures shell)
aimem setup proxy --install

# 2. Add MCP tools to Claude Code
aimem setup claude-code

# 3. Index your project
cd /path/to/your/project
aimem init

# 4. (Optional) Import old conversations
aimem import

# 5. (Optional) Import git history
aimem git import

# 6. Restart your terminal AND Claude Code
source ~/.bashrc  # or ~/.zshrc
```

After restart, Claude Code will have MCP tools available to query your project's memory.

### For Claude Desktop Users

Claude Desktop can **query** aimem but conversations are **not captured** (Electron apps don't reliably use HTTP_PROXY). This is fine - Claude Desktop can still search decisions and context from Claude Code sessions.

**macOS/Linux:**
```bash
# 1. Index your project
cd /path/to/your/project
aimem init

# 2. Add MCP server to Claude Desktop config
# macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
# Linux: ~/.config/Claude/claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "aimem": {
      "command": "aimem",
      "args": ["mcp-serve"]
    }
  }
}
```

**Windows (with WSL):**

Create a wrapper script `C:\Users\<user>\aimem-mcp.sh`:
```bash
#!/bin/bash
export PATH="/home/<user>/.nvm/versions/node/<version>/bin:$PATH"
export AIMEM_DATA_DIR="/home/<user>/.aimem"
exec aimem mcp-serve
```

Then configure Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "aimem": {
      "command": "wsl",
      "args": ["bash", "/mnt/c/Users/<user>/aimem-mcp.sh"]
    }
  }
}
```

Restart Claude Desktop. The MCP tools will be available for querying your project's memory.

### For Other Tools (Cursor, Continue.dev, etc.)

```bash
# 1. Set up proxy
aimem setup proxy --install

# 2. Index your project
cd /path/to/your/project
aimem init

# 3. Restart your terminal
source ~/.bashrc

# 4. Configure your tool's proxy settings
# Cursor: Set HTTP proxy to http://localhost:8080 in settings
# Continue.dev: Uses HTTP_PROXY automatically
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `aimem_query` | Search code, conversations, decisions, commits |
| `aimem_verify` | Check if a function/class/file exists |
| `aimem_conversations` | Search past conversation history |

### aimem_query

```
aimem_query <search> type=<type>

Types:
  all          - Search everything (default)
  structures   - Functions, classes, methods
  conversations - Past AI conversations
  decisions    - Extracted decisions/rejections
  commits      - Git commit history
```

Results include git authorship when available (author, commit hash).

## CLI Commands

| Command | Description |
|---------|-------------|
| `aimem init [path]` | Index a codebase |
| `aimem setup <tool>` | Configure for an AI tool |
| `aimem import` | Import old conversations |
| `aimem start` | Start proxy and watcher |
| `aimem stop` | Stop services |
| `aimem status` | Show status and stats |
| `aimem query <search>` | Search structures and conversations |
| `aimem visualize` | Generate interactive dashboard |
| `aimem git <cmd>` | Git integration commands |

## Git Integration

Track decisions alongside your git history:

```bash
# Import commit history
aimem git import [--limit N] [--since DATE]

# Link recent decisions to HEAD commit
aimem git link [--auto]

# Install git hooks (auto-link on commit)
aimem git hooks install

# Check installed hooks
aimem git hooks status

# Search commit messages
aimem git search <query>

# Show blame with aimem context
aimem git blame <file>
```

The git integration tracks:
- Commit history with FTS search on messages
- Git authorship on code structures (who last modified each function)
- Links between AI decisions and commits where they were applied

### Git Hooks

Install post-commit hook to auto-link decisions:

```bash
aimem git hooks install          # Install post-commit hook
aimem git hooks install --all    # Install all hooks
aimem git hooks remove --all     # Remove all hooks
```

## Import Old Conversations

Bootstrap with existing conversation history:

```bash
aimem import --dry-run           # Preview what would be imported
aimem import                     # Import from all sources
aimem import --source claude     # Claude Code only
aimem import --source aider      # Aider only
aimem import --source continue   # Continue.dev only
```

**Supported sources:**

| Tool | Location | Format |
|------|----------|--------|
| Claude Code | `~/.claude/projects/` | JSONL |
| Aider | `.aider.chat.history.md` | Markdown |
| Continue.dev | `~/.continue/sessions/` | JSON |

## Visualization Dashboard

Generate an interactive HTML dashboard:

```bash
aimem visualize                      # Generate dashboard.html
aimem visualize --output ./viz.html  # Custom output path
aimem visualize --open               # Open in browser
aimem visualize --serve              # Start live server
```

**Views:** Overview, Call Graph, Dependencies, Classes, Decisions, Code Smells, Hotspots, Gallery, Timeline, Treemap

## Teaching Claude to Use aimem

Add a `CLAUDE.md` file to your project root:

```markdown
## Memory (aimem)

Before claiming something isn't implemented or needs to be built:
1. Query `aimem_query <topic> type=decisions` to check past decisions
2. Query `aimem_verify <name>` to check if a function/class exists

Available aimem tools:
- `aimem_query <search>` - Search code, conversations, decisions, commits
- `aimem_verify <name>` - Does this function/class/file exist?
- `aimem_conversations <query>` - Search past conversation history
```

## Supported LLM APIs

| Provider | API Host |
|----------|----------|
| Anthropic (Claude) | api.anthropic.com |
| OpenAI | api.openai.com |
| Google (Gemini) | generativelanguage.googleapis.com |
| Mistral | api.mistral.ai |
| Cohere | api.cohere.ai |
| Groq | api.groq.com |
| Together AI | api.together.xyz |
| Perplexity | api.perplexity.ai |
| Fireworks | api.fireworks.ai |
| DeepSeek | api.deepseek.com |
| Replicate | api.replicate.com |

## Supported Languages

- JavaScript / TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`)
- Python (`.py`, `.pyw`)
- Ruby (`.rb`, `.rake`)
- Go (`.go`)
- Rust (`.rs`)
- Java (`.java`)
- Kotlin (`.kt`, `.kts`)
- C / C++ (`.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx`, `.hh`)
- PHP (`.php`, `.phtml`, `.php5`, `.php7`, `.php8`)

## Data Storage

Everything is stored locally:

| OS | Default Location |
|----|------------------|
| Linux/macOS | `~/.aimem/` |
| Windows | `C:\Users\<user>\.aimem\` |
| WSL | `/home/<user>/.aimem/` |

```
.aimem/
├── aimem.db        # SQLite database
├── ca-cert.pem     # Proxy CA certificate
├── ca-key.pem      # Proxy CA key
├── proxy.pid       # Proxy process ID
└── watcher.pid     # Watcher process ID
```

### Custom Data Directory

Set `AIMEM_DATA_DIR` to use a custom location:

```bash
export AIMEM_DATA_DIR="/path/to/shared/.aimem"
```

### Sharing Database Between WSL and Windows

To use the same database from both WSL and Windows:

**WSL** (add to `~/.bashrc` or `~/.zshrc`):
```bash
export AIMEM_DATA_DIR="/mnt/c/Users/<user>/.aimem"
```

**Windows** (PowerShell profile or System Environment Variables):
```powershell
$env:AIMEM_DATA_DIR = "C:\Users\<user>\.aimem"
```

Then restart your terminals and Claude Code.

No cloud. No accounts. Code never leaves your machine.

## Database Schema

- **projects**: Indexed codebases
- **files**: Source files with content hashes
- **structures**: Functions, classes, methods (with git authorship)
- **conversations**: Stored LLM conversations
- **extractions**: Decisions, patterns, rejections
- **commits**: Git commit history with FTS search
- **commit_links**: Links between commits and structures/extractions
- **links**: Graph edges connecting entities

## Troubleshooting

**Proxy not starting?**
- Check for port conflicts: `lsof -i :8080`
- Try a different port: `aimem start --port 8081`

**Certificate issues?**
- Run `aimem setup proxy --install` to auto-install
- Or manually trust `~/.aimem/ca-cert.pem`

**MCP not working in Claude Code?**
- Run `/mcp` to check connection
- Verify path: `which aimem`
- Restart Claude Code after setup

**No conversations being captured?**
- Verify proxy is running: `aimem status`
- Check env vars: `echo $HTTPS_PROXY`
- Ensure your tool respects HTTPS_PROXY

## Development

```bash
# Install from source
git clone https://github.com/rangerchaz/aimem.git
cd aimem
npm install
npm run build
npm link           # Install globally from source

# Development commands
npm run dev        # Watch mode
npm test           # Run tests
```

## License

MIT
