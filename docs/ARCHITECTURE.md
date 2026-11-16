# NEXUS Desktop — Architecture

## 1. Process model

```
┌──────────────────────────── Renderer (TypeScript) ────────────────────────────┐
│ React 19 · Vite · Tailwind 4 · Zustand · TanStack Query · Monaco · xterm.js    │
│ UI state only. No filesystem, no child_process, no secrets.                   │
└───────────────────────────────────┬───────────────────────────────────────────┘
                                    │ contextBridge `window.nexus`
                                    │ invoke(channel, payload) · typed events
┌───────────────────────────────────▼───────────────────────────────────────────┐
│ Electron main (TypeScript shell)                                              │
│ app lifecycle · windows · menu · dialogs · nativeTheme · notifications        │
│ IPC allowlist + Zod validation · event envelope fan-out                       │
│                    │ imports @nexus/core (bundled, in-process)                │
└────────────────────┼──────────────────────────────────────────────────────────┘
                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ @nexus/core (TypeScript, packages/core)                                       │
│ dispatch · SQLite storage (node:sqlite) · providers · agent runtime · tools   │
│ workspace sandbox · git CLI · terminals · process manager · orchestrator      │
│ fetch (SSE/NDJSON) · AES-256-GCM secrets (node:crypto)                        │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Rule:** processing logic belongs to `packages/core`. The Electron main process is OS integration
plus the core host; the renderer is pure UI. Every backend IPC channel maps 1:1 to a core method
with the same name.

## 2. Components

### TypeScript

| Path                        | Responsibility                                                 |
| --------------------------- | -------------------------------------------------------------- |
| `apps/desktop/src/renderer` | React UI, stores, editor, terminal view, diff review           |
| `apps/desktop/src/preload`  | Sandboxed bridge: `invoke`, `onEvent`, window state            |
| `apps/desktop/src/main`     | Electron lifecycle, local OS handlers, `CoreClient`, event bus |
| `packages/shared`           | IPC contract, Zod schemas, domain types, events, errors, i18n  |
| `packages/core`             | Backend: storage, providers, tools, workspace, git, agent, MCP |

`packages/shared` is the only shared code between UI and shell; `packages/core` is bundled into
the main process by `electron-vite`.

### Core (`packages/core`)

| Module          | Responsibility                                                                                                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index`         | `Core` class: method dispatch for every backend channel, event stream, project/command helpers                                                                                                                                                                                                                                          |
| `store`         | SQLite schema/migrations and repositories (projects, sessions, messages, tasks, tool calls, changes, usage, memory)                                                                                                                                                                                                                     |
| `providers`     | OpenAI-compatible, Anthropic, Gemini and Ollama protocol adapters plus a provider flavor registry (OpenRouter, Groq, Mistral, xAI, Together, Fireworks, Perplexity, Cohere, Qwen, Kimi, GLM, MiniMax, Cerebras, DeepInfra, GitHub Models, Azure OpenAI, LM Studio, llama.cpp, vLLM); Vercel AI SDK `streamText` + `smoothStream` primary path with legacy SSE/NDJSON fallback, discovery, native tool calls |
| `agent`         | Stateful task loop, plan-first harness, streaming deltas, tool-call loop, approval gates, cancellation, resume, usage accounting, engine router (native loop, Claude Agent SDK, LangGraph `StateGraph` with `MemorySaver` and `interrupt()` approvals) |
| `tools`         | Filesystem/patch/memory/skills/search/dev/web/git tools, AST repo map, symbol search, find-references, verification, subagent delegation, background processes                                                                                                                                                                          |
| `mcp`           | MCP client built on `@modelcontextprotocol/sdk` (stdio, Streamable HTTP, SSE): server lifecycle, tool discovery, namespaced agent tools                                                                                                                                                                                                 |
| `code-intel`    | AST code intelligence via `@babel/parser`: symbols, imports, references for JS/TS/JSX/TSX with regex fallback for other languages                                                                                                                                                                                                       |
| `tokens`        | BPE token counting via `js-tiktoken` (`cl100k_base` / `o200k_base`) for context budgeting and usage estimates                                                                                                                                                                                                                           |
| `workspace`     | Sandboxed path resolution (traversal + symlink escape), `.gitignore` via `ignore`, tree/search, atomic writes                                                                                                                                                                                                                           |
| `watcher`       | Recursive filesystem watcher via `chokidar`, debounced `workspace.file.changed` / `git.status.changed` events                                                                                                                                                                                                                           |
| `git`           | Structured `git` CLI wrapper with an operation allowlist                                                                                                                                                                                                                                                                                |
| `terminal`      | Real PTY sessions via `forkpty`, resize, streaming output events                                                                                                                                                                                                                                                                        |
| `security`      | Permission matrix, dangerous-command screening, secret redaction                                                                                                                                                                                                                                                                        |
| `secrets`       | AES-256-GCM encryption of API keys with a per-user key file                                                                                                                                                                                                                                                                             |
| `http`          | libcurl wrapper with streaming callbacks and abort support                                                                                                                                                                                                                                                                              |
| `events`        | Typed event emission to the Electron main process                                                                                                                                                                                                                                                                                       |

## 3. Transport contract

Requests and responses use JSON-RPC 2.0, one JSON object per line:

```json
{"jsonrpc":"2.0","id":7,"method":"workspace.readFile","params":{"projectId":"...","path":"src/main.ts"}}
{"jsonrpc":"2.0","id":7,"result":{"content":"...","language":"typescript","size":42}}
{"jsonrpc":"2.0","method":"nexus:event","params":{"type":"agent.text.delta","payload":{...}}}
```

Errors carry both a JSON-RPC code and the shared error taxonomy:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "error": {
    "code": -32000,
    "message": "...",
    "data": { "code": "E_PERMISSION", "message": "..." }
  }
}
```

The Electron `CoreClient` maps `data.code` back to `NexusError`, so renderer error handling is
unchanged. Events are wrapped in `NexusEventEnvelope` by the main process and broadcast on
`nexus:event`. The native core emits a `nexus:ready` notification after database migration.

## 4. Agent runtime

State machine persisted in `tasks.state`:

```
Idle → Running ⇄ WaitingTool ⇄ Running
              ↘ WaitingApproval → Running | Denied
              ↘ Cancelled
       → Completed | Failed
```

One turn:

1. Build system prompt (mode, permission mode, project instructions, memory) and chat history
   trimmed to the configured character budget.
2. The first response must include a `nexus-plan` fenced JSON block. The core persists
   `tasks.plan_json`, creates task steps and emits `agent.plan.created` / `agent.step.*`.
3. Stream provider output; deltas are coalesced (16 ms or 1 KiB) before crossing stdout, the
   Electron bridge coalesces again per message (16 ms), and the renderer flushes live text at 24 ms.
4. Native tool calls (or parsed `nexus-tool` blocks for models without tool calling) go through
   the permission matrix and, when required, an approval gate. “Always allow” approvals persist
   per project and auto-approve the same tool in later tasks (destructive actions excluded).
5. Execute static tools or MCP tools with sandboxed paths, timeouts, abort support; record tool
   calls and file changes. Mark the active plan step complete after each tool batch.
6. Persist messages and usage; append tool results. The loop continues without an iteration cap when
   the configured limits are `0` (unlimited); auto-continuation re-prompts the model while plan steps
   remain, until it emits `NEXUS_DONE` or all steps complete.
7. Provider `E_NETWORK` / `E_RATE_LIMIT` / `E_PROVIDER` failures are retried with exponential
   backoff (3 attempts); `E_CONTEXT_OVERFLOW` triggers an aggressive history compaction and one retry.
   Identical tool calls with identical arguments are blocked after two attempts to stop runaway loops.
8. When edits land, automatic verification runs the narrowest project check (typecheck → build →
   tests). Failures are fed back as user-visible task feedback and completion is gated until the
   check passes (three remediation attempts).
9. Before completion, an independent review subagent inspects the diff and reports findings; the
   parent must address them before finishing (toggle `agent.autoReview`).
10. `delegate_task` spawns an isolated subagent session/task; `delegate_parallel` launches up to four
    children concurrently, waits for every result and returns their summaries. Nesting is capped,
    delegation count is bounded and cancellation propagates to children.
11. User hooks (`agent.hooks`) run with `NEXUS_HOOK_EVENT`/`NEXUS_TOOL_*` env: `preToolUse` can block
    a tool, `postToolUse` appends feedback, `stop` runs at task completion.
12. Emit `agent.task.completed` / `agent.task.failed` / `agent.task.cancelled`.

Cancellation resolves pending approvals and aborts libcurl transfers. `agent.resume` restarts a
persisted task with the existing conversation.

## 5. MCP

`settings["mcp.servers"]` is a JSON array of stdio servers (`id`, `command`, `args`, `env`,
`enabled`, optional `cwd`). The core spawns them lazily, performs the MCP `initialize` handshake,
discovers tools with `tools/list` and exposes each as `mcp__<server>__<tool>` with the server's
JSON Schema. Those namespaced tools are injected into the agent tool set and require network
approval by default. Built-in `mcp_list_servers`, `mcp_list_tools` and `mcp_call` tools are also
available for explicit control. Changing the setting reloads and stops existing servers.

## 6. Permissions

Modes: `read-only`, `workspace-write`, `terminal-approval`, `elevated`. Tools declare
`read`, `write`, `exec`, `network` or `destructive` risk. The policy returns `allow` / `ask` /
`deny`; `exec`/`network` require approval, destructive operations never auto-approve, and
dangerous shell patterns (root deletes, force push, piping remote scripts to a shell, privilege
escalation) are blocked or escalated. Path resolution rejects traversal, absolute paths, symlink
escapes and gitignored paths.

## 7. Persistence and secrets

SQLite at `userData/nexus.db` with WAL and `foreign_keys=ON`, migrated by the core
(`store.ts` via `node:sqlite`). API keys never reach the renderer; they are encrypted with AES-256-GCM using a
32-byte key stored in `userData/secrets.key` (permissions `0600`) and persisted as ciphertext.
`db.backup` uses the SQLite backup API; `db.vacuum` compacts the database.

## 8. Platform support

The core is portable JavaScript. Processes spawn through `node:child_process`, terminals use a
`script(1)` PTY shim with a pipe fallback, and paths go through `node:path`. Linux is the verified
target; macOS is supported by the same shim; Windows runs the pipe fallback.

## 9. Build and packaging

- `electron-vite` builds main (CJS, core inlined), preload (CJS) and renderer (ESM).
- `pnpm test` runs the core unit tests with `node --test`; `pnpm typecheck` checks every package.
- `electron-builder` packages `dist/**` only; there is no native binary or Node ABI rebuild.
