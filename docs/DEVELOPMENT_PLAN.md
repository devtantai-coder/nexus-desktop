# Development Plan & Status

Updated: 2026-11-13. This file is the live progress record; update it after every phase.

## Verification commands

```bash
pnpm typecheck                  # tsc project-wide, no emit
pnpm lint                       # eslint (flat config)
pnpm test                       # core unit tests (node --test)
xvfb-run -a npx playwright test # Electron E2E (Linux, headless via Xvfb)
pnpm build                      # electron-vite production build
pnpm package                    # electron-builder installers for host OS
```

Latest run: **typecheck clean · lint clean · 50 core tests pass · 12/12 Electron E2E · production build OK · Domain Engine probe exercised web+systems scaffold/build/test, dependency plan/approval and honest simulator refusal**.

## Persistent Memory (bổ sung)

- `packages/core/src/memory.ts`: quản lý `MEMORY.md` và `USER.md` trong user-data, ghi atomic,
  giới hạn 200.000 ký tự, chặn path traversal và bỏ qua nội dung mẫu khi đưa vào system prompt.
- Bộ nhớ dự án dùng bảng `agent_memory` (có `project_id`) được đọc lại ở mọi phiên mới, cộng thêm
  ghi chú toàn cục; agent có các tool `save_memory`, `search_memory`, `memory_file_read`,
  `memory_file_write`.
- Tìm lại lịch sử hội thoại qua `session.search` (LIKE an toàn, có `ESCAPE` và giới hạn kết quả).
- IPC: `memory.files`, `memory.write`, `memory.list`, `memory.create`, `memory.remove`,
  `memory.search`, `session.search` — đều đi qua allowlist + zod schema.
- UI: Settings → Coding → Persistent Memory (hoặc lệnh `/memory`). Probe Electron xác nhận
  MEMORY.md/USER.md ghi đọc lại được, 5 tool memory đăng ký, và `kind='../evil'` bị từ chối.
- Full probe 4 tính năng phát hiện và sửa lỗi: `store.projectRef()` chuẩn hoá `projectId: ''`
  thành NULL ở session/task/memory/skill/automation, nếu không `agent.delegate` và
  `automation.run` báo `FOREIGN KEY constraint failed` khi chưa mở project. Có test hồi quy.
- Probe agent thật với provider mock lokal xác nhận luồng tool `memory_file_write` ghi vào
  USER.md; subagent chạy xong 3 tin nhắn; automation chạy xong và giao webhook 2 lần
  (test channel + chạy lịch). Ảnh chụp 3 panel settings nằm trong scratch probe.

## Phase status

| Phase                   | Scope                                                                                                 | Status              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| 0 Research              | Electron security model, provider protocols, agent tool loop, PTY                                     | done                |
| 1 Architecture          | ARCHITECTURE, TECHNICAL_DECISIONS, SECURITY_PLAN, UI_DESIGN_SPEC, DATABASE_SCHEMA                     | done                |
| 2 Foundation            | monorepo, electron-vite, TypeScript UI, TypeScript core, SQLite migrations, IPC, design tokens, build | done                |
| 3 UI                    | shell, sidebar, home, conversation, composer, coding workspace + inspector, settings, themes, i18n    | done                |
| 4 Provider engine       | 6 provider kinds, streaming, tool calls, discovery, capability detection, encrypted keys              | done                |
| 5 Agent runtime         | FSM, planning, tool loop, approvals, retries, cancel, resume, usage, persistence                      | done                |
| 6 Workspace & dev tools | FS engine, indexer, Monaco, diff review, xterm terminal, git                                          | done                |
| 7 Multi-agent & context | orchestrator roles, file locks, conflicts, context budget/compression                                 | done                |
| 8 Security & testing    | permission matrix, path sandbox, command screening, redaction, CSP, tests                             | done                |
| 9 Release               | icons, builder configs, packaged app boot verified; installers                                        | partial — see below |

## What is verified, and how

- **Security**: core tests for traversal/symlink escape rejection, binary read refusal, dangerous
  command screening, permission matrix, secret redaction; E2E asserts the bridge is absent of Node
  APIs and that a traversal IPC call fails.
- **Providers**: adapter tests against real mock HTTP/SSE servers for OpenAI-compatible (text +
  fragmented tool calls + usage + 401), Anthropic (text, tool_use, tool_result, images), Gemini
  (SSE, functionCall, usage), Ollama (NDJSON, tool calls, discovery).
- **Agent runtime**: end-to-end with a scripted adapter and real SQLite: planning → approval →
  tool execution → summary; denied approval path; ask-mode tool filtering; plan mode without
  execution; text tool protocol fallback; cancellation; resume with persisted context; usage rows.
- **Workspace/indexer/git/process/terminal**: real filesystem, real `git` CLI, real PTY in the TypeScript core
  shell session.
- **Electron**: Playwright launches the built app under Xvfb, checks title/shell, calls IPC
  (app.info/project.open/workspace.tree/readFile/session.create/settings), navigates Settings and
  Model Manager, then restarts the app with the same userData and verifies project, session and
  a custom setting persisted.
- **Packaging**: `electron-builder --dir` produces `release/linux-unpacked`; the packaged binary
  boots, migrates the DB and reports `renderer ready` in its log.

## Not verified / known limitations

1. **Windows and macOS installers are configured but not built or run here** (Linux container).
   `nsis`, `portable` and `dmg` targets must be built on their respective OSes.
2. **AppImage/deb** are built by electron-builder on Linux but not installed on a clean machine.
3. **Monaco language services**: TypeScript/JavaScript get worker-backed IntelliSense. Other
   languages have syntax highlighting only — no language servers are bundled. The UI does not
   claim full IntelliSense for them.
4. **Plan step tracking** uses explicit `[STEP:n]` markers from the model, with a conservative
   fallback that marks the next step running after each tool batch. It is progress signalling, not
   semantic verification of each step.
5. **Orchestrator now launches the selected specialist roles in parallel** as isolated subagents
   (own session + own PTY); `delegate_parallel` also waits on all children concurrently. File locks
   and conflict reporting still exist at the workspace layer, but overlapping edits are left to the
   model to coordinate. No end-to-end run with a real provider/model was performed; the parallel path
   is verified at core/IPC level only.
6. **Retrieval is lexical** (paths + identifiers + bounded content scan), not embedding-based.
   It is bounded and incremental, but it will miss purely semantic matches.
7. **Provider discovery** is real API-based. Model presets are only context-window heuristics;
   no fake model catalog is shipped.
8. **Tokencost** is only shown when a provider reports usage or when the app estimates tokens
   (marked `estimated`); no fabricated pricing table is applied.
9. **OS secret storage** depends on a keyring. Without one, keys are AES-256-GCM encrypted with a
   local 0600 key file and Settings discloses this.
10. **Desktop only.** The renderer requires the Electron bridge and refuses to run in a plain
    browser. There is no demo/preview data mode; every screen reads live state from the local
    database, agent runtime, terminal and git engines.

## Next steps (release hardening)

1. Build and smoke-test NSIS/DMG on Windows/macOS CI runners; add code signing.
2. Add an app update channel (electron-updater) once artifacts are hosted.
3. Add Playwright coverage for the code workspace (open file, edit, save, diff accept/reject)
   using a throwaway repo.
4. Add a provider contract test suite that runs against live endpoints behind env flags (never in
   default CI).
5. Optional: language servers (tsserver is embedded; add LSP bridge for Python/Rust/Go).
