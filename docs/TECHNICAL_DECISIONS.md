# Technical Decisions

## TD-01 — TypeScript UI + TypeScript core

The pnpm workspace keeps only the React app and `packages/shared` (IPC contract, Zod schemas,
domain types). All processing logic lives in `packages/core`, bundled into the Electron main process
that speaks newline-delimited JSON-RPC with the Electron main process. Rationale: a clean UI/logic
boundary, no native Node ABI rebuilds, and a testable backend process.

## TD-02 — electron-vite (not Forge)

Chosen for first-class Vite HMR in the renderer and separate main/preload/renderer configs with a
single `electron-vite dev/build`. Packaging handled by electron-builder, which has mature
AppImage/deb/NSIS/DMG targets.

## TD-03 — CJS main + sandboxed CJS preload

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Preload is bundled to CJS so it
runs inside a sandboxed renderer without ESM complications. All privileged work stays in main.

## TD-04 — SQLite owned by the core, hand-written versioned migrations

The core uses `node:sqlite` and owns the schema. The schema is embedded SQL executed
idempotently at startup (`store.cpp`); WAL, `foreign_keys=ON` and busy timeouts are enabled. No
Drizzle, no runtime file-path assumptions.

## TD-05 — Secrets encrypted in the core

AES-256-GCM (`OpenSSL`) with a random 32-byte key stored in `secrets.key` (`0600`) and base64
ciphertext in SQLite. The key never leaves the core process and is passed through no IPC surface.
Backing up the key together with the database is required; losing it makes stored provider keys
unreadable (they can be re-entered).

## TD-06 — One event channel, SSE-style agent streaming

Main → renderer uses a single `nexus:event` channel with a discriminated union payload, so adding
an event type never requires a new IPC registration. Provider streaming is normalized into
`ChatResult` deltas (text/reasoning/tool-call/usage/finish) by each adapter.

## TD-07 — Provider adapters, not a universal client

OpenAI-compatible, Anthropic, Gemini and Ollama speak different wire formats for tools, streaming
and usage. Each gets an adapter method returning the same `ChatResult`; capability
detection is explicit (declared per provider/model plus name heuristics) and the agent falls back
to a text tool protocol when native tool calling is unavailable.

## TD-08 — Text tool protocol fallback

For models without `tools` support, the system prompt describes fenced ```nexus-tool blocks.
Parsing is strict (JSON object validation) and every parsed call still passes the same permission
gate, so the fallback is not a security bypass.

## TD-09 — Bounded repository access

No recursive full reads. Workspace walks use depth/entry/size caps, `.gitignore` + default
ignores and binary detection. Agent context is built from conversation history, project
instructions and persisted memory; repository knowledge is retrieved through bounded file and
code-search tools rather than embedding a whole repo.

## TD-10 — Filesystem writes are atomic and recorded

`write_file`/`edit_file` write to a temp file in the same directory then `rename`; the previous
content is captured for the diff/review pipeline (`file_changes`). Deletes are hard deletes inside
the workspace sandbox and are recorded; `change.reject`/`change.revert` restore captured content.

## TD-11 — Terminal sessions owned by the core (script(1) PTY + TerminalManager)

PTY sessions are tracked with explicit ids, resized via RPC, and disposed on app shutdown,
preventing orphaned shells. Output is emitted as `terminal.output` events as it is read; the
renderer batches writes into xterm locally.

## TD-12 — Plan-first agent harness

The model must emit one `nexus-plan` fenced JSON block before tool use. The core persists it in
`tasks.plan_json` and in `task_steps`, emits `agent.plan.created` and step events, and marks steps
complete as tool batches finish. This makes progress observable without a second planning request.

## TD-12a — Unbounded loop with progress guards

Execution limits of `0` mean unlimited iterations/tool calls/duration. The loop auto-continues while
plan steps remain and stops on `NEXUS_DONE`, plan completion or eight consecutive no-tool turns.
Duplicate tool calls with identical arguments are blocked after two attempts; transient provider
errors retry with backoff and context overflow is compacted once.

## TD-12aa — Subagents and automatic verification

The `delegate_task` tool creates an isolated child session/task and blocks the parent until the child
reports a summary; `delegate_parallel` launches up to four children and collects all summaries; depth
and delegation count are capped. After file edits, `verify_changes` runs
the narrowest detected check and feeds failures back into the loop; `NEXUS_DONE` is rejected while
the latest verification fails.

## TD-12ab — Review subagent and user hooks

Once verification passes, a read-only reviewer subagent inspects the diff and feeds actionable
findings back before completion. User-authored hooks in `agent.hooks` run around tools and at task
completion with explicit environment variables; failing pre-hooks block the tool, post/stop hook
output is surfaced as feedback/notifications.

## TD-06a — Provider flavor registry

Most providers speak the OpenAI chat protocol. A flavor table maps kind → default base URL, auth
style (Bearer, `api-key` for Azure, extra OpenRouter attribution headers), local/no-key behavior and
endpoint paths, while Anthropic/Gemini/Ollama keep dedicated adapters. New OpenAI-compatible
providers can be added by one table entry plus a UI preset.

## TD-12b — MCP via stdio, namespaced tools

MCP servers are configured in settings and spawned lazily by the core. Tools are exposed to
the model as `mcp__<server>__<tool>` with their input schema, and are treated as `network` risk so
they pass through the approval gate. Server processes are reloaded when settings change.

## TD-13 — Tailwind CSS v4 + CSS-variable design tokens

Tokens are CSS variables under `:root[data-theme]`, consumed by Tailwind utilities and components.
Themes switch by toggling `data-theme`, so no JS style recalculation and no hardcoded colors.

## TD-14 — Vietnamese-first i18n with a typed dictionary

A small `t(key)` dictionary (vi/en) instead of a heavy i18n framework: typed keys, no runtime
bundle bloat, instant switching, persisted in settings.

## TD-15 — Honest completion criteria

Features are considered done only with TypeScript typecheck/lint, core tests (`node --test`) and a
successful production build. GUI runtime verification requires a display; where the build
environment has none, E2E tests skip explicitly and the limitation is documented rather than
claimed as passing.
