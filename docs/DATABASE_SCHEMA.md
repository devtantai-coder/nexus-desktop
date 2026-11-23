# Database Schema

SQLite owned by the TypeScript core, WAL, `foreign_keys = ON`, schema in `packages/core/src/store.ts`.

## Tables

### users

`id` PK, `name`, `avatar_color`, `created_at`. Local profile only (no auth server).

### providers

`id` PK, `kind` (`openai|openai-compatible|anthropic|google|deepseek|ollama`), `name`,
`base_url`, `api_key_cipher` (AES-256-GCM ciphertext, nullable), `api_key_hint`, `enabled`,
`supports_tools`, `supports_vision`, `created_at`, `updated_at`.

### models

`id` PK, `provider_id` FK → providers, `model_id` (wire name), `display_name`, `context_window`,
`max_output_tokens`, `temperature`, `categories_json` (`coding|reasoning|vision|tools|long-context`),
`supports_tools`, `supports_vision`, `supports_reasoning`, `is_default`, `created_at`.
`UNIQUE(provider_id, model_id)`.

### projects

`id` PK, `name`, `path` UNIQUE, `description`, `git_remote`, `default_branch`,
`last_opened_at`, `created_at`, `updated_at`.

### workspaces

`id` PK, `project_id` FK → projects, `name`, `root_path`, `settings_json`, `created_at`.

### sessions

`id` PK, `project_id` FK → projects (nullable: global chats), `workspace_id` FK (nullable),
`title`, `mode`, `provider_id`, `model_id`, `permission_mode`, `archived`, `pinned`,
`created_at`, `updated_at`.

### messages

`id` PK, `session_id` FK → sessions (CASCADE), `role` (`system|user|assistant|tool`),
`content`, `reasoning`, `tool_calls_json`, `tool_call_id`, `model`, `provider_id`,
`usage_json`, `status` (`streaming|complete|error|cancelled`), `error_json`, `created_at`.

### tasks

`id` PK, `session_id` FK → sessions (CASCADE), `project_id` FK, `title`, `prompt`, `mode`,
`state` (`idle|planning|running|waiting_tool|waiting_approval|retrying|completed|failed|cancelled`),
`plan_json`, `summary`, `error_json`, `provider_id`, `model_id`, `resumable_state_json`,
`started_at`, `completed_at`, `created_at`, `updated_at`.

### task_steps

`id` PK, `task_id` FK → tasks (CASCADE), `index_no`, `title`, `description`,
`state` (`pending|running|completed|failed|skipped`), `result`, `started_at`, `completed_at`.
`UNIQUE(task_id, index_no)`.

### tool_calls

`id` PK, `task_id` FK (nullable), `session_id` FK, `tool_name`, `input_json`, `output_json`,
`status` (`pending|awaiting_approval|running|success|error|denied|cancelled`),
`approval` (`none|approved|rejected`), `error_json`, `duration_ms`, `created_at`.

### file_changes

`id` PK, `task_id` FK (nullable), `session_id` FK, `project_id` FK, `path`, `change_type`
(`create|modify|delete|rename`), `before_content`, `after_content`, `added_lines`,
`removed_lines`, `status` (`proposed|accepted|rejected|reverted`), `created_at`.

### git_operations

`id` PK, `project_id` FK, `operation`, `args_json`, `status` (`running|success|error`),
`output`, `error`, `created_at`.

### settings

`key` PK, `value_json`, `updated_at`. User-scoped preferences (theme, language, panels, etc.).

### agent_memory

`id` PK, `project_id` FK, `kind` (`fact|decision|convention|note`), `content`, `tags`,
`source_session_id`, `created_at`.

### usage_records

`id` PK, `provider_id`, `model_id`, `session_id`, `task_id`, `input_tokens`, `output_tokens`,
`cached_input_tokens`, `duration_ms`, `estimated_cost_usd`, `source` (`provider|estimated`),
`created_at`. Only provider-reported numbers are stored as `provider`; anything computed is marked
`estimated`.

### file_index

Reserved for workspace indexing: `id` PK, `project_id` FK, `path`, `language`, `size`, `mtime_ms`,
`hash`, `indexed_at`, `UNIQUE(project_id, path)`.

## Indexes

`sessions(project_id, updated_at)`, `messages(session_id, created_at)`, `tasks(session_id, created_at)`,
`tasks(state)`, `tool_calls(task_id)`, `file_changes(task_id)`, `file_index(project_id, path)`,
`usage_records(created_at)`, `agent_memory(project_id)`.

## Integrity rules

- Deleting a session cascades messages/tasks/steps/tool calls; projects are never auto-deleted.
- `file_changes.before_content`/`after_content` store the full text captured by the tool, bounded by
  workspace read/write limits (1 MiB read, 8 MiB write).
- All timestamps are Unix epoch milliseconds (INTEGER).
