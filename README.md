# NEXUS Desktop

**Premium AI Coding Agent Desktop** — TypeScript UI + TypeScript core.

> Think. Plan. Code. Review. Build.

NEXUS Desktop is a local-first AI development environment. The renderer is React/TypeScript; every
piece of processing logic — persistence, providers, agent runtime, tools, workspace sandbox, git,
PTY terminals, orchestration and usage accounting — lives in the TypeScript core package
(`packages/core`), loaded in-process inside the Electron main process.

## Architecture at a glance

```
React 19 + TS renderer  ──contextBridge──▶  Electron main (TS shell)
                                                  │ JSON-RPC (stdio)
                                                  ▼
                                        @nexus/core (TypeScript)
                                        node:sqlite · fetch · tools
```

The Electron main process owns window/menu/dialog/notification OS integration, the typed IPC
allowlist and the core itself. The renderer never touches Node or files directly.

## Status

| Area                                                                                                                                                                                                                                               | State      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| TypeScript UI (Home, Chats, Projects, Agents, History, Settings, Editor, Terminal)                                                                                                                                                                 | working    |
| Electron shell (secure preload, Zod IPC allowlist, events)                                                                                                                                                                                         | working    |
| TypeScript core: dispatch surface, event stream, approvals, cancellation                                                                                                                                                                            | working    |
| SQLite persistence: projects, sessions, messages, tasks, tool calls, file changes, usage                                                                                                                                                           | working    |
| Providers: OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Groq, Mistral, xAI, Together, Fireworks, Perplexity, Cohere, Qwen, Moonshot/Kimi, Z.ai/GLM, MiniMax, Cerebras, DeepInfra, GitHub Models, Azure OpenAI, Ollama/LM Studio/llama.cpp/vLLM | working    |
| Agent runtime: unbounded plan-first loop, auto-continuation, retries, duplicate-call guard, approvals, resume                                                                                                                                      | working    |
| Deep coding: repo map, symbol search, batch reads, context budgeting, task undo, persistent approvals                                                                                                                                              | working    |
| Subagents: isolated delegated tasks; parallel fan-out up to 4; nesting/delegation guards                                                                                                                                                           | working    |
| Automatic verification: typecheck/build after edits, self-correct on failure, completion gate                                                                                                                                                      | working    |
| Independent review subagent before completion (toggleable)                                                                                                                                                                                         | working    |
| Extensibility hooks: preToolUse / postToolUse / stop shell hooks                                                                                                                                                                                   | working    |
| Live workspace: inotify watcher with debounced tree/git events                                                                                                                                                                                     | working    |
| MCP client: stdio servers, tool discovery, namespaced tools, `mcp_*` built-ins                                                                                                                                                                     | working    |
| Tools: filesystem, patch, memory, skills, code search, terminal, dev, web, git                                                                                                                                                                     | working    |
| Workspace sandbox, gitignore, path traversal/symlink protection                                                                                                                                                                                    | working    |
| PTY terminals, background process manager, git CLI wrapper                                                                                                                                                                                         | working    |
| Multi-agent orchestrator roles                                                                                                                                                                                                                     | working    |
| Core unit tests (`node --test`) + Electron E2E (Playwright)                                                                                                                                                                                         | working    |
| Packaging (electron-builder)                                                                                                                                                                                                                       | configured |

## Quick start

Requirements: Node 22+, pnpm and a desktop session. No native toolchain is needed: SQLite comes
from `node:sqlite`, HTTP from `fetch`, and terminals from a `script(1)`/pipe shim.

```bash
pnpm install
pnpm dev            # electron-vite dev (needs a desktop session)
pnpm test           # core unit tests
pnpm verify         # typecheck + lint + core tests + production build
pnpm package        # installers
```

Add an AI provider in **Settings → Providers**. API keys are encrypted with AES-256-GCM by the
core using a per-user key file (`userData/secrets.key`, mode 0600) and stored only as
ciphertext. Without a provider, everything except model calls works; Ollama runs fully offline.
Default UI language is Vietnamese.

## Repository layout

```
apps/desktop/          Electron main, preload and React renderer (TypeScript)
packages/shared/       IPC contract, Zod schemas, domain types, events, error taxonomy
packages/core/         TypeScript backend: store, workspace, git, terminal, providers, tools,
                       agent, MCP — bundled into the Electron main process
docs/                  architecture, schema, security and design specs
tests/e2e/             Playwright Electron tests
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Technical decisions](docs/TECHNICAL_DECISIONS.md)
- [Security plan](docs/SECURITY_PLAN.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [UI design spec](docs/UI_DESIGN_SPEC.md)

## License

MIT.
