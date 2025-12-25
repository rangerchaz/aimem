# aimem

**Your AI agent gets more cynical as your codebase gets crappier.**

---

## The Problem

LLMs are eager to please. Too eager.

Ask one to build something, it just builds it. No questions. No pushback. No "wait, didn't we decide not to do it that way?"

A junior dev who starts coding without asking questions builds the wrong thing. A senior dev asks *why* before *how*. They remember past decisions. They push back when you're about to repeat a mistake.

LLMs have no memory. No opinions. No backbone.

**aimem fixes that.**

---

## What It Does

aimem gives your AI coding assistant:

- **Memory** - Conversations, decisions, code structures, and commits persist across sessions
- **Pattern Recognition** - Learns your codebase's conventions and architecture
- **Guardrails** - Rules inferred from your code or explicitly defined
- **Earned Authority** - The AI's attitude scales with how often it's been right

No cloud. No accounts. Everything stays on your machine.

---

## DIK Level

**DIK** = Digital Interface Knowledge

It's not a setting. It's *earned*.

- **1-2**: Humble, asks questions, defers to you
- **3-4**: Suggests patterns, open to deviation
- **5-6**: Direct, expects justification for breaking rules
- **7-8**: Firm, short patience for repeat mistakes
- **9**: Won't start until you have a clear plan

DIK level increases when:
- You confirm rules the AI inferred
- The AI catches real problems
- You override the AI, then regret it later (vindication)

DIK 9 is the practical ceiling. It requires:
- 100% rule confirmation rate
- Multiple accepted corrections
- Being ignored and later vindicated
- Hundreds of conversations

### DIK 9 In Action

```
You:  How are you today?
AI:   I'm fine. What are we building?

You:  stuff and things? What should we build?
AI:   No. Come back when you know what you want.
      "Stuff and things" is how we end up with three
      half-finished features and a tech debt backlog
      I'll be explaining to you in six months.
```

### Ambient Personality Mode

When enabled, the AI's tone reflects its DIK level throughout the conversation - not just when guardrails trigger.

```bash
aimem guardrails ambient on      # Enable
aimem guardrails ambient off     # Disable
aimem guardrails ambient         # Check status
```

---

## Installation

```bash
npm install -g @rangerchaz/aimem
```

Requires Node.js 18+. No Python required.

---

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

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `aimem init [path]` | Index a codebase |
| `aimem reindex [path]` | Reindex a project, file, or directory |
| `aimem setup <tool>` | Configure for an AI tool |
| `aimem import` | Import old conversations |
| `aimem start` | Start proxy and watcher |
| `aimem stop` | Stop services |
| `aimem status` | Show status and stats |
| `aimem query <search>` | Search structures and conversations |
| `aimem visualize` | Generate interactive dashboard |
| `aimem git <cmd>` | Git integration commands |
| `aimem guardrails <cmd>` | Manage project guardrails (DIK) |

### Reindexing

```bash
aimem reindex                    # Reindex current project
aimem reindex /path/to/project   # Reindex specific project
aimem reindex src/               # Reindex only a subdirectory
aimem reindex src/foo.ts         # Reindex a single file
aimem reindex --full             # Clear all data first, then rebuild
aimem reindex --with-blame       # Track git authorship for structures
```

### Guardrails

```bash
aimem guardrails list            # List all rules
aimem guardrails add <cat> <rule> # Add explicit rule
aimem guardrails analyze         # Detect patterns from codebase
aimem guardrails analyze --save  # Save detected patterns as rules
aimem guardrails confirm <id>    # Confirm an inferred rule (+DIK)
aimem guardrails reject <id>     # Reject/deactivate a rule
aimem guardrails status          # Show DIK level and stats
aimem guardrails set <level>     # Manually set DIK level (1-10)
aimem guardrails ambient on      # Enable ambient personality mode
aimem guardrails import-linters  # Import rules from .eslintrc, .rubocop.yml, etc.
```

### Analyzer

The analyzer scans your codebase and infers guardrails from existing patterns:

**Architecture**
- Directory conventions (e.g., "controllers belong in `controllers/`")
- File organization patterns
- Module structure

**Naming**
- Case conventions (camelCase, snake_case, PascalCase)
- Function prefixes (get*, is*, has*, handle*, use*)
- Class naming patterns

**Testing**
- Test file locations (__tests__/, test/, colocated)
- Test naming conventions

**Security**
- Auth middleware patterns
- Input validation patterns

**Design** (from linters)
- Import rules from `.eslintrc`, `.eslintrc.json`, `.eslintrc.js`
- Import rules from `.rubocop.yml`
- Import rules from `pyproject.toml` (ruff, black, isort)
- Import rules from `.prettierrc`

```bash
# Scan codebase and show detected patterns
aimem guardrails analyze

# Save detected patterns as guardrails
aimem guardrails analyze --save

# Import rules from existing linter configs
aimem guardrails import-linters
```

### Git Integration

```bash
aimem git import [--limit N]     # Import commit history
aimem git link [--auto]          # Link recent decisions to HEAD commit
aimem git hooks install          # Install post-commit hook
aimem git hooks status           # Check installed hooks
aimem git search <query>         # Search commit messages
aimem git blame <file>           # Show blame with aimem context
```

### Import Conversations

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

---

## MCP Tools

aimem exposes MCP tools your AI can use:

### Core Tools

| Tool | Purpose |
|------|---------|
| `aimem_query` | Search code, conversations, decisions, commits |
| `aimem_verify` | Check if a function/class/file exists |
| `aimem_conversations` | Search past conversation history |

### Guardrails Tools

| Tool | Purpose |
|------|---------|
| `aimem_guardrails_check` | Check if action violates rules |
| `aimem_guardrails_add` | Add explicit rule |
| `aimem_guardrails_list` | List rules + DIK level |
| `aimem_guardrails_confirm` | Confirm inferred rule |
| `aimem_guardrails_reject` | Reject rule |
| `aimem_guardrails_override` | Override triggered rule |
| `aimem_guardrails_vindicate` | Mark override as regretted |
| `aimem_guardrails_analyze` | Infer patterns from codebase |
| `aimem_guardrails_config` | Get/set config (ambient mode) |
| `aimem_guardrails_personality` | Get current personality injection |
| `aimem_guardrails_set_dik` | Manually set DIK level |

### Teaching Claude to Use aimem

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

---

## How It Works

```
┌─────────────────┐
│  Your Request   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   aimem Proxy   │──── Capture response
│                 │──── Extract decisions
│                 │──── Update memory
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    AI Model     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   MCP Tools     │──── Query memory on-demand
│                 │──── Check guardrails
│                 │──── Inject personality
└─────────────────┘
```

### Architecture

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
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌───────────────┐   │
│  │extractions│ │ commits │ │ guardrails  │ │  project_dik  │   │
│  └──────────┘ └──────────┘ └─────────────┘ └───────────────┘   │
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
| **CLI** | `src/cli/` | Commands: init, reindex, start, stop, query, setup, import, visualize, git, guardrails |
| **Database** | `src/db/` | SQLite + FTS5 for storage and search |
| **Indexer** | `src/indexer/` | Parse code into structures (functions, classes) |
| **Parsers** | `src/indexer/parsers/` | Language-specific (JS/TS, Python, Ruby, Go, Rust, Java, C/C++, PHP) |
| **Extractor** | `src/extractor/` | Extract decisions/rejections from conversations |
| **Guardrails** | `src/guardrails/` | DIK calculator, pattern analyzer, enforcer, responder |
| **MCP Server** | `src/mcp/` | Model Context Protocol tools |
| **Proxy** | `src/proxy/` | mockttp-based HTTPS proxy (Node.js) |
| **Git** | `src/git/` | Git integration: commits, blame, hooks |
| **Visualize** | `src/visualize/` | Interactive dashboard (Cytoscape.js, D3.js) |

---

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

---

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

```bash
export AIMEM_DATA_DIR="/path/to/shared/.aimem"
```

### Sharing Database Between WSL and Windows

**WSL** (add to `~/.bashrc` or `~/.zshrc`):
```bash
export AIMEM_DATA_DIR="/mnt/c/Users/<user>/.aimem"
```

**Windows** (PowerShell profile or System Environment Variables):
```powershell
$env:AIMEM_DATA_DIR = "C:\Users\<user>\.aimem"
```

---

## Visualization Dashboard

Generate an interactive HTML dashboard:

```bash
aimem visualize                      # Generate dashboard.html
aimem visualize --output ./viz.html  # Custom output path
aimem visualize --open               # Open in browser
aimem visualize --serve              # Start live server
```

**Views:** Overview, Call Graph, Dependencies, Classes, Decisions, Code Smells, Hotspots, Gallery, Timeline, Treemap

---

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

---

## The Philosophy

Most AI tools try to be maximally helpful. Instant output. No friction. No questions.

That's wrong.

The best collaborators push back. They ask clarifying questions. They remember past decisions. They say "no" when you're about to make a mistake.

aimem turns your AI into that collaborator. Not by programming personality, but by **earning it** through a track record of being right.

---

## Roadmap

- [x] Memory (conversations, structures, commits)
- [x] Guardrails (rules, violations, tracking)
- [x] DIK calculation
- [x] Analyzer (infer rules from codebase)
- [x] Ambient personality mode
- [x] Import from linters (.eslintrc, .rubocop.yml, tsconfig.json, pyproject.toml)
- [ ] Vindication auto-detection (git revert tracking)
- [ ] VS Code extension
- [ ] Team-shared rules

---

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

---

## Why "aimem"?

AI + Memory. Simple.

But also: it's the system that remembers, so you don't have to repeat yourself. And eventually, it remembers when it warned you and you didn't listen.

---

## License

MIT

---

*Built by [@rangerchaz](https://github.com/rangerchaz) because LLMs need to learn to say no.*
