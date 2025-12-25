# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2024-12-24

### Added
- **DIK (Digital Interface Knowledge)**: Earned authority system where AI's attitude scales with track record
  - DIK levels 1-9 with distinct personalities (humble to veteran)
  - Guardrails with categories: design, architecture, naming, security, performance, testing
  - Pattern analyzer to infer rules from codebase
  - Linter import: `.eslintrc`, `.rubocop.yml`, `tsconfig.json`, `pyproject.toml`, `.prettierrc`
  - Ambient personality mode for consistent AI tone
  - Vindication tracking (user overrides AI, later regrets it)
  - Manual DIK level setter

- **New CLI commands**:
  - `aimem guardrails list/add/confirm/reject/status/set/ambient`
  - `aimem guardrails analyze [--save]` - Infer rules from codebase
  - `aimem guardrails import-linters [--dry-run]` - Import from linter configs
  - `aimem reindex [path] [--full] [--with-blame]` - Manual reindexing

- **New MCP tools**:
  - `aimem_guardrails_check`, `_add`, `_list`, `_confirm`, `_reject`
  - `aimem_guardrails_override`, `_vindicate`, `_analyze`
  - `aimem_guardrails_config`, `_personality`, `_set_dik`

### Changed
- Complete README rewrite with new philosophy section
- Updated architecture to include guardrails module

## [0.1.5] - 2024-12-23

### Fixed
- Fix project detection by capturing request body with file paths
- Auto-detect project from file paths in conversations

## [0.1.4] - 2024-12-22

### Documentation
- Clarify Claude Desktop setup and limitations

## [0.1.3] - 2024-12-21

### Added
- `AIMEM_DATA_DIR` environment variable for custom data location

## [0.1.2] - 2024-12-20

### Fixed
- Read CLI version from package.json dynamically

## [0.1.1] - 2024-12-19

### Fixed
- Store all conversations and remove insecure TLS bypass

### Documentation
- Add Claude Desktop setup instructions

## [0.1.0] - 2024-12-18

### Added
- Initial release
- **Proxy capture**: mockttp-based HTTPS proxy for intercepting LLM API calls (Anthropic, OpenAI, Google, Mistral)
- **Decision extraction**: Regex-based extraction of decisions/rejections from conversations
- **SQLite storage**: FTS5 full-text search across all stored data
- **MCP server**: `aimem_query`, `aimem_verify`, `aimem_conversations` tools
- **Code indexing**: Parse functions/classes/methods from source files
- **Language parsers**: JavaScript/TypeScript, Python, Ruby, Go, Rust, Java, Kotlin, C/C++, PHP
- **Git integration**: Commit parsing, blame tracking, decision-commit linking
- **Interactive visualization**: Cytoscape.js and D3.js dashboard
- **CLI commands**: init, start, stop, status, query, setup, import, visualize, git
