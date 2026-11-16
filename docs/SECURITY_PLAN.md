# Security Plan

## 1. Electron hardening

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- Preload exposes a fixed API object; no `ipcRenderer` passthrough, no dynamic channel names.
- Main validates every IPC payload with Zod and rejects unknown channels; senders are restricted to
  the app's own windows (`senderFrame` origin check).
- CSP header injected for the renderer (`default-src 'self'`; `connect-src` limited to the app in
  production; `style-src 'self' 'unsafe-inline'` for Monaco/Tailwind runtime styles).
- `will-navigate` and `setWindowOpenHandler` block external navigation; external links open in the
  OS browser only after user action.
- No remote content is loaded into privileged windows.

## 2. Secrets

- API keys encrypted with AES-256-GCM by the core using a per-user key file (`secrets.key`, `0600`); ciphertext only in SQLite.
- Keys never enter renderer state; the UI receives `{ hasKey: boolean, hint: "sk-…ab12" }`.
- Keys never logged; error normalisation strips `Authorization` and key-like strings.
- If OS encryption is unavailable, the app reports it and keeps keys in a permission-restricted file
  instead of pretending to encrypt.

## 3. Workspace access control

- Every path is resolved and `realpath`-checked against the workspace root; traversal (`..`),
  absolute escapes and symlink escapes are rejected.
- Reads/writes capped by size and extension filters; binaries are not read into context.
- Writes are atomic (temp + rename). Deletes go to an app trash directory by default.
- Only explicitly opened folders are accessible; switching workspaces requires a new root.

## 4. Permission system

Modes: **Read Only**, **Workspace Write**, **Terminal Approval**, **Elevated**.
Tool risk classes: `read`, `write`, `exec`, `network`, `destructive`.
Decision = f(mode, risk, path-scope, command pattern):

| Risk                 | read-only | workspace-write | terminal-approval | elevated |
| -------------------- | --------- | --------------- | ----------------- | -------- |
| read                 | allow     | allow           | allow             | allow    |
| write (in workspace) | deny      | allow           | allow             | allow    |
| exec                 | deny      | ask             | ask               | allow*   |
| network              | deny      | ask             | ask               | allow*   |
| destructive          | deny      | ask             | ask               | ask      |

\* "allow" never means silent for destructive/out-of-workspace operations: those always ask.

Command screening rejects obviously dangerous patterns (`rm -rf /`, `mkfs`, fork bombs, disk writes
to `/dev/*`, `git push --force` without approval) and flags anything resolving outside the workspace.

## 5. Prompt-injection resistance

- Repository file contents, README files, tool output and model output are untrusted data. They are
  wrapped in explicit `<untrusted-context>` delimiters in the prompt and never parsed as commands.
- The agent will not follow instructions embedded in files that conflict with the user's request or
  the permission policy; the runtime enforces policy independently of model intent.
- Tool arguments are schema-validated; dangerous operations require human approval regardless of the
  model's justification.

## 6. Process & resource safety

- Terminal and command tools have timeouts, kill trees on timeout/abort, output caps.
- PTY sessions are disposed on window close and app quit.
- Agent loops are bounded (max iterations, max tool calls, wall-clock budget).

## 7. Data integrity

- Migrations are transactional and checksummed; foreign keys enforced; WAL + busy timeout.
- Database backup/export available from Settings → Storage.
- Errors are normalised through an error taxonomy with codes; secrets redacted before display/log.

## 8. Residual risks (documented, not hidden)

- AI review is advisory; it does not prove code is secure.
- The encryption key file must be protected by filesystem permissions; back it up together with the database or stored keys become unreadable.
- Terminal approval is only as strong as the human reading the command; the app shows the exact
  command, cwd and risk reason before approval.
