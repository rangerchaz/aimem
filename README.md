# aimem

**Memory for AI coding assistants.**

Every new session, your AI assistant forgets everything—architectural decisions, rejected approaches, why you built things a certain way. You waste time re-explaining context.

aimem fixes this. It intercepts your LLM API calls, extracts decisions from conversations, indexes your codebase, and makes it all searchable. Next session, ask "why did we use X?" and get the answer.

**Your AI assistant finally remembers what you talked about yesterday.**

## The Problem

AI coding assistants forget everything between sessions. You explain your architecture, make decisions, reject approaches—then start fresh next time. aimem fixes this.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your AI Tool                             │
│                  (Claude Code, Cursor, etc.)                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ API calls
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     mitmproxy Interceptor                       │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ Inject Context  │    │ Capture Response│    │  Extract    │ │
│  │ (recent decisions)   │ (SSE streaming) │    │  Decisions  │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SQLite Database                            │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌───────────────┐   │
│  │ projects │ │ files    │ │ structures  │ │ conversations │   │
│  └──────────┘ └──────────┘ └─────────────┘ └───────────────┘   │
│  ┌──────────┐ ┌──────────┐                                      │
│  │extractions│ │ links   │   + FTS5 full-text search           │
│  └──────────┘ └──────────┘                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
┌─────────────────────┐          ┌─────────────────────┐
│    MCP Server       │          │    File Watcher     │
│  (query tools for   │          │  (live indexing)    │
│   Claude Code)      │          │                     │
└─────────────────────┘          └─────────────────────┘
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **CLI** | `src/cli/` | Commands: init, start, stop, status, query, setup, import |
| **Database** | `src/db/` | SQLite + FTS5 for storage and search |
| **Indexer** | `src/indexer/` | Parse code into structures (functions, classes, etc.) |
| **Parsers** | `src/indexer/parsers/` | Language-specific parsers (JS/TS, Python, Ruby, Go) |
| **Extractor** | `src/extractor/` | Extract decisions/rejections from conversations |
| **Query** | `src/query/` | Search and format context for injection |
| **MCP Server** | `src/mcp/` | Model Context Protocol tools for Claude Code |
| **Proxy** | `src/proxy/` | Python mitmproxy addon for interception |

### Data Flow

1. **Indexing**: `aimem init` parses your codebase → stores structures in SQLite
2. **Capture**: Proxy intercepts LLM API calls → extracts decisions → stores in DB
3. **Injection**: On new requests, proxy queries recent decisions → injects into prompt
4. **Query**: MCP tools or CLI search the database → return relevant context

## How It Works

aimem creates a moving context window:

- **Short-term**: Current conversation (full fidelity)
- **Medium-term**: Related structures and recent decisions (queried, injected)
- **Long-term**: Everything else (stored, waiting, retrievable)

The proxy intercepts LLM API calls in real-time, extracts decisions, and injects relevant context into future requests.

## Installation

```bash
# Clone and build
git clone <repo>
cd aimem
npm install
npm run build

# Install globally
npm link

# Verify
aimem --version

# Install mitmproxy (required for context capture)
pip install mitmproxy
```

Requires Node.js 18+ and Python 3.8+.

## Quick Start

### For Claude Code Users

```bash
# 1. Set up proxy (installs cert + configures shell + autostart)
aimem setup proxy --install --autostart

# 2. Add MCP query tools to Claude Code
aimem setup claude-code

# 3. Index your project
cd /path/to/your/project
aimem init

# 4. (Optional) Import old conversations for instant memory
aimem import

# 5. Restart your terminal AND Claude Code
source ~/.bashrc  # or ~/.zshrc

# 6. Verify everything is working
aimem status
```

After restart, Claude Code will:
- See injected context (recent decisions) in every request
- Have MCP tools available (`aimem_decisions`, `aimem_query`, etc.)
- Be reminded to query aimem before making claims

### For Other Tools (Cursor, Continue.dev, etc.)

```bash
# 1. Set up proxy with autostart
aimem setup proxy --install --autostart

# 2. Index your project
cd /path/to/your/project
aimem init

# 3. Restart your terminal
source ~/.bashrc

# 4. Configure your tool's proxy settings (if needed)
# Cursor: Set HTTP proxy to http://localhost:8080 in settings
# Continue.dev: Uses HTTP_PROXY automatically
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `aimem init [path]` | Index a codebase (defaults to cwd) |
| `aimem setup <tool>` | Configure aimem for an AI tool |
| `aimem import` | Import old Claude Code conversations |
| `aimem start` | Start proxy and file watcher |
| `aimem stop` | Stop running services |
| `aimem status` | Show services and database stats |
| `aimem query <search>` | Search structures and conversations |
| `aimem visualize` | Generate interactive codebase dashboard |

### Setup Commands

```bash
aimem setup proxy              # Show proxy setup instructions
aimem setup proxy --install    # Full install: cert + shell profile
aimem setup proxy --autostart  # Configure proxy to start on login
aimem setup proxy --install --autostart  # Full setup with autostart
aimem setup claude-code        # Add MCP server to Claude Code
aimem setup cursor             # Show Cursor configuration
aimem setup continue           # Show Continue.dev configuration
```

### Import Old Conversations

Bootstrap aimem with your existing conversation history from multiple AI tools:

```bash
# Preview what would be imported (recommended first)
aimem import --dry-run

# Import from all supported sources
aimem import

# Import from specific source
aimem import --source claude    # Claude Code only
aimem import --source aider     # Aider only
aimem import --source continue  # Continue.dev only

# Import with limit
aimem import --limit 100

# Import for a specific project
aimem import --project /path/to/project
```

**Supported sources:**

| Tool | Location | Format |
|------|----------|--------|
| Claude Code | `~/.claude/projects/` | JSONL |
| Aider | `.aider.chat.history.md` in project | Markdown |
| Continue.dev | `~/.continue/sessions/` | JSON |

This extracts decisions from past sessions so aimem is useful from day one.

### Query Options

```bash
aimem query "function"               # Search current project
aimem query "function" -g            # Search all projects
aimem query "class" -t structures    # Only search code structures
aimem query "auth" -t conversations  # Only search conversations
aimem query "api" -l 20              # Limit to 20 results
```

### Visualization Dashboard

Generate an interactive HTML dashboard to explore your codebase visually:

```bash
aimem visualize                      # Generate dashboard.html
aimem visualize --output ./viz.html  # Custom output path
aimem visualize --open               # Open in browser after generating
aimem visualize --serve              # Start live server on port 8080
aimem visualize --serve --port 3000  # Custom port
```

**Dashboard Features:**

| View | Description |
|------|-------------|
| **Overview** | All files in your codebase at a glance |
| **Call Graph** | Function/method call relationships |
| **Dependencies** | File-level relationships |
| **Classes** | Class hierarchy and methods |
| **Decisions** | Architectural decisions linked to code |

**Interactions:**
- **Click** - View details and source code
- **Double-click** - Drill down into files, classes, or functions
- **Search** - Find by name, file path, or signature
- **Flow tracing** - Trace downstream calls or upstream callers
- **Visual/List toggle** - Switch between graph and list views
- **Back button** - Navigate drill-down history

## Proxy Setup

The proxy is the core of aimem—it captures decisions in real-time and injects context.

### Automatic Setup (Recommended)

```bash
# Full setup: installs cert to system trust store + adds env vars to shell profile
aimem setup proxy --install

# Or with autostart (starts proxy automatically on login)
aimem setup proxy --install --autostart

# Restart terminal to load env vars
source ~/.bashrc  # or ~/.zshrc

# Start the proxy (not needed if using --autostart)
aimem start
```

### Autostart on Login

The `--autostart` flag configures the proxy to start automatically:

- **Linux/WSL**: Creates a systemd user service (`~/.config/systemd/user/aimem-proxy.service`)
- **macOS**: Creates a launchd agent (`~/Library/LaunchAgents/com.aimem.proxy.plist`)

Manual control (Linux/WSL):
```bash
systemctl --user start aimem-proxy   # Start now
systemctl --user stop aimem-proxy    # Stop
systemctl --user status aimem-proxy  # Check status
systemctl --user disable aimem-proxy # Disable autostart
```

Manual control (macOS):
```bash
launchctl start com.aimem.proxy   # Start now
launchctl stop com.aimem.proxy    # Stop
launchctl unload ~/Library/LaunchAgents/com.aimem.proxy.plist  # Disable
```

### Manual Setup

```bash
# Create config files
aimem setup proxy

# Start the proxy
aimem start

# Trust the certificate (visit while proxy is running)
# http://mitm.it

# Set environment variables (add to shell profile)
export HTTP_PROXY=http://localhost:8080
export HTTPS_PROXY=http://localhost:8080
```

### What the Proxy Does

1. **Intercepts** API calls to LLM providers
2. **Injects** relevant context from previous sessions into requests
3. **Extracts** decisions and patterns from responses (including SSE streaming)
4. **Stores** everything in the local database
5. **Deduplicates** to prevent storing the same decision twice (5-minute window)

### Supported LLM APIs

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
| Ollama (local) | localhost:11434 |
| LM Studio (local) | localhost:1234 |

## Claude Code Integration

```bash
# Add MCP query tools
aimem setup claude-code

# Set up proxy for context capture
aimem setup proxy --install

# Restart Claude Code, then start the proxy
aimem start
```

The MCP server provides query tools. The proxy handles context capture and injection.

### MCP Tools

| Tool | Description |
|------|-------------|
| `aimem_query` | Search structures and conversations |
| `aimem_context` | Get full context for a function/class |
| `aimem_decisions` | Get past decisions about an entity (with keyword fallback) |
| `aimem_verify` | Check if a function/file exists (hallucination check) |
| `aimem_conversations` | Search and retrieve full conversation history |

**aimem_decisions** first looks for code structures matching the entity name, then retrieves linked decisions. If no matching structure is found, it falls back to keyword search across all decision content. Results include a `source` field indicating whether the match was `linked` (direct entity match) or `keyword_search` (content match).

Run `/mcp` in Claude Code to verify the server is connected.

### Teaching Claude to Use aimem

The proxy automatically injects recent decisions and a reminder into every request:

```
## Previous Context (from aimem)

_Use `aimem_decisions <topic>` to query more context before claiming something isn't implemented._

### Recent Decisions
- We decided to use Redis for caching
- The authentication flow uses JWT tokens
...
```

To reinforce this, add a `CLAUDE.md` file to your project root:

```markdown
## Memory (aimem)

Before claiming something isn't implemented or needs to be built:
1. Query `aimem_decisions <topic>` to check past decisions
2. Query `aimem_verify <name>` to check if a function/class exists

Available aimem tools:
- `aimem_query <search>` - Search code and conversations
- `aimem_context <entity>` - Full context for a function/class
- `aimem_decisions <topic>` - What was decided about this topic?
- `aimem_verify <name>` - Does this function/file exist?
- `aimem_conversations <query>` - Search past conversation history
```

## Other Tools (Cursor, Continue.dev, etc.)

Same proxy setup works for any tool:

```bash
# Set up proxy
aimem setup proxy --install

# Start proxy
aimem start
```

**Cursor**: Set HTTP proxy to `http://localhost:8080` in settings.

**Continue.dev**: Respects `HTTP_PROXY` environment variables automatically.

For query tools, add MCP configuration (see `aimem setup cursor` or `aimem setup continue`).

## Supported Languages

- JavaScript / TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`)
- Python (`.py`, `.pyw`)
- Ruby (`.rb`, `.rake`)
- Go (`.go`)

## What Gets Indexed

```json
{
  "type": "function",
  "name": "processRental",
  "file": "app/services/rental_service.rb",
  "line": 45,
  "signature": "processRental(customer_id, equipment_id, duration)",
  "calls": ["validateCustomer", "checkAvailability"],
  "called_by": ["RentalController#create"]
}
```

Structures extracted:
- Functions and methods
- Classes and modules
- Interfaces and types
- Relationships (calls, called_by)

## What Gets Extracted

From conversations, aimem extracts:
- **Decisions**: "I'll use X", "We should do Y", "The approach is Z"
- **Rejections**: "Instead of X", "Won't use Y", "Decided against Z"
- **Entity links**: Connects decisions to code structures mentioned

These are automatically injected into future sessions as context.

## Data Storage

Everything is stored locally in `~/.aimem/`:

```
~/.aimem/
├── aimem.db        # SQLite database
├── proxy.pid       # Proxy process ID
├── watcher.pid     # Watcher process ID
├── start-proxy.sh  # Proxy startup script
└── proxy-env.sh    # Environment variables
```

No cloud. No accounts. Code never leaves your machine.

## Project Isolation

Queries are scoped to the current project by default:

```bash
cd ~/projects/app-a
aimem query "User"        # Only searches app-a

cd ~/projects/app-b
aimem query "User"        # Only searches app-b

aimem query "User" -g     # Searches all projects
```

## Database Schema

- **projects**: Indexed codebases
- **files**: Source files with content hashes
- **structures**: Functions, classes, methods, etc.
- **conversations**: Stored LLM conversations
- **extractions**: Decisions, patterns, rejections from conversations
- **links**: Graph edges connecting entities

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Run locally
node dist/cli/index.js status
```

## Troubleshooting

**Proxy not starting?**
- Install mitmproxy: `pip install mitmproxy`
- Check for port conflicts: `lsof -i :8080`
- Try a different port: `aimem start --port 8081`

**Certificate issues?**
- Run `aimem setup proxy --install` to auto-install
- Or manually install from `~/.mitmproxy/mitmproxy-ca-cert.pem`
- On WSL, you may need to install cert on Windows side too

**Node.js SSL errors through proxy?**
- The setup script adds `NODE_EXTRA_CA_CERTS` and `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Verify with: `echo $NODE_TLS_REJECT_UNAUTHORIZED` (should be `0`)
- Restart your terminal after running `aimem setup proxy --install`

**No context being injected?**
- Verify proxy is running: `aimem status`
- Check env vars are set: `echo $HTTP_PROXY`
- Ensure your tool respects HTTP_PROXY

**MCP not working in Claude Code?**
- Run `/mcp` to check connection
- Verify path in settings: `which aimem`
- Restart Claude Code after setup

**Autostart not working?**
- Linux/WSL: Check with `systemctl --user status aimem-proxy`
- macOS: Check with `launchctl list | grep aimem`
- Ensure systemd user services are enabled: `loginctl enable-linger $USER`
- Check logs in `~/.aimem/proxy.log` (macOS) or `journalctl --user -u aimem-proxy` (Linux)

## License

MIT
