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

### Agent engines

Chọn engine trong **Settings → General → Agent engine** hoặc ngay trong composer của từng phiên (lưu riêng theo session). Mặc định **Tự động**: dùng Claude Agent SDK khi đã cấu hình provider Anthropic, ngược lại dùng Nexus native.

- **Nexus native** — vòng lặp agent gốc, hỗ trợ mọi provider, hooks, subagent, nén ngữ cảnh.
- **Claude Agent SDK** — dùng engine chính thức của Claude Code (`@anthropic-ai/claude-agent-sdk`),
  cần provider Anthropic. SDK tự chạy đọc/sửa file, Bash, MCP và trả tool events về UI.
  Nexus deep-integration: expose toàn bộ tool Nexus qua in-process MCP server `nexus_core`,
  đồng bộ MCP servers trong Settings, dùng chung approval dialog/permission đã lưu, chạy
  `preToolUse`/`postToolUse` hooks, ghi file changes/usage và `resume` session Claude Code.
- **LangGraph** — `StateGraph` với các node `model`/`tools`, `MemorySaver` checkpoint và
  `interrupt()` cho human-in-the-loop khi tool cần phê duyệt. Hỗ trợ steering, stop-after-turn,
  hooks, file-change tracking, plan extraction (`nexus-plan`), tool-call/token budgets và resume
  với history hiện có.

### Core libraries for the coding agent

| Library                                                | Role                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `@babel/parser`                                        | AST code intelligence: repo map, symbol search and `find_references` for JS/TS/JSX/TSX |
| `@anthropic-ai/claude-agent-sdk`                       | Optional Claude Code engine: official agent loop, built-in file/Bash/tool harness      |
| `@langchain/langgraph`                                 | Optional state-graph engine: explicit nodes/edges, checkpoints, human-in-the-loop      |
| `@modelcontextprotocol/sdk`                            | Official MCP client (stdio, Streamable HTTP, SSE) with tool discovery                  |
| `js-tiktoken`                                          | Real BPE token counting for context budgeting and usage estimates                      |
| `chokidar`                                             | Cross-platform recursive workspace watcher                                             |
| `ignore`                                               | `.gitignore` semantics for the workspace sandbox                                       |
| `zod`                                                  | IPC input validation and shared schemas                                                |
| `ai`                                                   | Vercel AI SDK streaming (`streamText`, `smoothStream`) with legacy adapter fallback    |
| `@ai-sdk/openai`                                       | OpenAI-compatible provider for the AI SDK (OpenAI, Vercel AI Gateway, OpenRouter, …)   |
| `class-variance-authority` + `clsx` + `tailwind-merge` | Type-safe UI variants and conflict-free class composition                              |

## Status

| Area                                                                                                                                                                                                                                                                  | State      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| TypeScript UI (Home, Chats, Projects, Agents, History, Settings, Editor, Terminal)                                                                                                                                                                                    | working    |
| Electron shell (secure preload, Zod IPC allowlist, events)                                                                                                                                                                                                            | working    |
| TypeScript core: dispatch surface, event stream, approvals, cancellation                                                                                                                                                                                              | working    |
| SQLite persistence: projects, sessions, messages, tasks, tool calls, file changes, usage                                                                                                                                                                              | working    |
| Providers: OpenAI, Vercel AI Gateway, Anthropic, Gemini, DeepSeek, OpenRouter, Groq, Mistral, xAI, Together, Fireworks, Perplexity, Cohere, Qwen, Moonshot/Kimi, Z.ai/GLM, MiniMax, Cerebras, DeepInfra, GitHub Models, Azure OpenAI, Ollama/LM Studio/llama.cpp/vLLM | working    |
| Agent runtime: unbounded plan-first loop, auto-continuation, retries, duplicate-call guard, approvals, resume                                                                                                                                                         | working    |
| Deep coding: repo map, symbol search, batch reads, context budgeting, task undo, persistent approvals                                                                                                                                                                 | working    |
| Subagents: isolated delegated tasks; parallel fan-out up to 4; nesting/delegation guards                                                                                                                                                                              | working    |
| Automatic verification: typecheck/build after edits, self-correct on failure, completion gate                                                                                                                                                                         | working    |
| Independent review subagent before completion (toggleable)                                                                                                                                                                                                            | working    |
| Extensibility hooks: preToolUse / postToolUse / stop shell hooks                                                                                                                                                                                                      | working    |
| Live workspace: inotify watcher with debounced tree/git events                                                                                                                                                                                                        | working    |
| Agent engines: Nexus native, Claude Agent SDK (Anthropic), LangGraph StateGraph with checkpoints and approval interrupts                                                                                                                                              | working    |
| Token/context: BPE accounting, 85% preflight compaction, token-bounded tool outputs, AST parse cache                                                                                                                                                                  | working    |
| MCP client: stdio, Streamable HTTP and SSE servers; tool discovery, namespaced tools, `mcp_*` built-ins                                                                                                                                                               | working    |
| Tools: filesystem, patch, memory, skills, code search, AST repo map/symbol/reference search, terminal, dev, web, git                                                                                                                                                  | working    |
| Workspace sandbox, gitignore, path traversal/symlink protection                                                                                                                                                                                                       | working    |
| PTY terminals, background process manager, git CLI wrapper                                                                                                                                                                                                            | working    |
| Multi-agent orchestrator roles                                                                                                                                                                                                                                        | working    |
| Core unit tests (`node --test`) + Electron E2E (Playwright)                                                                                                                                                                                                           | working    |
| Packaging (electron-builder)                                                                                                                                                                                                                                          | configured |

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
Model variants (for example `openai/gpt-4o:nitro` or Ollama tags like `llama3:8b`) are discovered
automatically and can also be added manually in the same panel. Default UI language is Vietnamese.

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
