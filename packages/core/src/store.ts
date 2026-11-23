import { DatabaseSync } from 'node:sqlite'

import { NexusError } from './errors.ts'

export type Json = any
import {
  ensureDirectory,
  fileSize,
  jsonDouble,
  jsonInt,
  jsonStr,
  nowMs,
  sanitizeUtf8,
  startsWith,
  toLower,
  trim,
  uuid,
} from './util.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_color TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  api_key_cipher TEXT,
  api_key_hint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  supports_tools INTEGER NOT NULL DEFAULT 1,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 32768,
  max_output_tokens INTEGER NOT NULL DEFAULT 8192,
  temperature REAL NOT NULL DEFAULT 0.2,
  categories_json TEXT NOT NULL DEFAULT '[]',
  supports_tools INTEGER NOT NULL DEFAULT 1,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  reasoning_effort TEXT NOT NULL DEFAULT 'medium',
  variant TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  git_remote TEXT,
  default_branch TEXT,
  last_opened_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_projects_last_opened ON projects(last_opened_at);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  settings_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'workspace-write',
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  model_variant TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_project_updated ON sessions(project_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  reasoning TEXT,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  model TEXT,
  provider_id TEXT,
  usage_json TEXT,
  status TEXT NOT NULL DEFAULT 'complete',
  error_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  plan_json TEXT,
  summary TEXT,
  error_json TEXT,
  provider_id TEXT,
  model_id TEXT,
  permission_mode TEXT NOT NULL,
  resumable_state_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_session_created ON tasks(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  index_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  started_at INTEGER,
  completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_steps_index ON task_steps(task_id, index_no);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approval TEXT NOT NULL DEFAULT 'none',
  error_json TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  change_type TEXT NOT NULL,
  before_content TEXT,
  after_content TEXT,
  added_lines INTEGER NOT NULL DEFAULT 0,
  removed_lines INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_changes_task ON file_changes(task_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id);
CREATE TABLE IF NOT EXISTS git_operations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  args_json TEXT,
  status TEXT NOT NULL,
  output TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_session_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory(project_id);
CREATE TABLE IF NOT EXISTS dependency_events (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  command TEXT,
  exit_code INTEGER,
  ok INTEGER NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dependency_events_created ON dependency_events(created_at);
CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_task_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  use_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_skills_name ON agent_skills(name);
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL DEFAULT 'none',
  target TEXT NOT NULL DEFAULT '',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  last_run_at INTEGER,
  next_run_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automations_due ON automations(enabled, next_run_at);
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  provider_id TEXT,
  model_id TEXT,
  session_id TEXT,
  task_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  ttft_ms INTEGER,
  estimated_cost_usd REAL,
  source TEXT NOT NULL DEFAULT 'provider',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
CREATE TABLE IF NOT EXISTS file_index (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  hash TEXT,
  indexed_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_file_index_path ON file_index(project_id, path);
CREATE INDEX IF NOT EXISTS idx_file_index_project ON file_index(project_id);
`

const PROJECT_COLUMNS =
  'id, name, path, description, git_remote, created_at, updated_at, default_branch, last_opened_at'
const SESSION_COLUMNS =
  'id, title, mode, permission_mode, archived, pinned, created_at, updated_at, project_id, workspace_id, provider_id, model_id, model_variant'
const MESSAGE_COLUMNS =
  'id, session_id, role, content, status, created_at, reasoning, tool_calls_json, tool_call_id, model, provider_id, usage_json, error_json'
const TASK_COLUMNS =
  'id, session_id, title, prompt, mode, state, permission_mode, created_at, updated_at, project_id, plan_json, summary, error_json, provider_id, model_id, started_at, completed_at'
const TOOL_CALL_COLUMNS =
  'id, session_id, tool_name, input_json, status, approval, created_at, task_id, output_json, error_json, duration_ms'
const FILE_CHANGE_COLUMNS =
  'id, session_id, path, change_type, added_lines, removed_lines, status, created_at, task_id, project_id, before_content, after_content'
const MODEL_COLUMNS =
  'id, provider_id, model_id, display_name, context_window, max_output_tokens, temperature, categories_json, supports_tools, supports_vision, supports_reasoning, is_default, reasoning_effort, variant'
const PROVIDER_COLUMNS =
  'id, kind, name, base_url, api_key_cipher, api_key_hint, enabled, supports_tools, supports_vision, created_at, updated_at'
const USAGE_COLUMNS =
  'id, provider_id, model_id, session_id, task_id, input_tokens, output_tokens, cached_input_tokens, duration_ms, estimated_cost_usd, source, created_at'

type BindValue = string | number | bigint | null | Uint8Array

function parseOptionalJson(value: string | null): Json {
  if (!value || value === '') return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString()
}

function collapsedPrompt(prompt: string, limit: number): string {
  let out = ''
  let previousSpace = false
  for (const c of prompt) {
    if (/\s/.test(c)) {
      if (out !== '' && !previousSpace) out += ' '
      previousSpace = true
    } else {
      out += c
      previousSpace = false
    }
  }
  out = trim(out)
  return out.length > limit ? out.slice(0, limit) : out
}

/** projectId rỗng từ agent/automation phải là NULL, không phải FK tới project id ''. */
function projectRef(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function likePattern(query: string): string {
  let out = ''
  for (const c of query) {
    if (c === '\\' || c === '%' || c === '_') out += '\\'
    out += c
  }
  return `%${out}%`
}

function normalizeEffort(value: string): string {
  const effort = toLower(trim(value))
  return ['off', 'minimal', 'low', 'medium', 'high'].includes(effort) ? effort : 'medium'
}

const boolValue = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback

export class Store {
  readonly path: string
  private readonly db: DatabaseSync
  private settingsCache = new Map<string, Json>()
  private settingsLoaded = false

  constructor(path: string) {
    this.path = path
    try {
      this.db = new DatabaseSync(path)
    } catch (error) {
      throw new NexusError(
        'E_DB',
        `Cannot open database ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    this.db.exec('PRAGMA journal_mode=WAL;')
    this.db.exec('PRAGMA foreign_keys=ON;')
    this.db.exec('PRAGMA busy_timeout=5000;')
  }

  close(): void {
    this.db.close()
  }

  private exec(sql: string): void {
    try {
      this.db.exec(sql)
    } catch (error) {
      throw new NexusError(
        'E_DB',
        `SQLite error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private query<T extends Record<string, unknown>>(sql: string, params: BindValue[] = []): T[] {
    try {
      const statement = this.db.prepare(sql)
      const result: T[] = []
      for (const row of statement.all(...params) as T[]) result.push(row)
      return result
    } catch (error) {
      throw new NexusError(
        'E_DB',
        `SQLite error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private queryOne<T extends Record<string, unknown>>(
    sql: string,
    params: BindValue[] = [],
  ): T | undefined {
    try {
      const statement = this.db.prepare(sql)
      return statement.get(...params) as T | undefined
    } catch (error) {
      throw new NexusError(
        'E_DB',
        `SQLite error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private run(sql: string, params: BindValue[] = []): void {
    try {
      const statement = this.db.prepare(sql)
      statement.run(...params)
    } catch (error) {
      throw new NexusError(
        'E_DB',
        `SQLite error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private table(sql: string): void {
    this.exec(sql)
  }

  private columnExists(table: string, column: string): boolean {
    const rows = this.query<{ name: string }>(`PRAGMA table_info(${table})`)
    return rows.some((row) => row.name === column)
  }

  migrate(): void {
    this.exec(SCHEMA)
    if (!this.columnExists('models', 'reasoning_effort')) {
      this.exec("ALTER TABLE models ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium';")
    }
    if (!this.columnExists('models', 'variant')) {
      this.exec("ALTER TABLE models ADD COLUMN variant TEXT NOT NULL DEFAULT '';")
    }
    this.exec('DROP INDEX IF EXISTS uq_models_provider_model;')
    this.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_models_provider_model_variant ON models(provider_id, model_id, variant);',
    )
    if (!this.columnExists('sessions', 'model_variant')) {
      this.exec("ALTER TABLE sessions ADD COLUMN model_variant TEXT NOT NULL DEFAULT '';")
    }
    if (!this.columnExists('usage_records', 'ttft_ms')) {
      this.exec('ALTER TABLE usage_records ADD COLUMN ttft_ms INTEGER;')
    }
    this.exec('PRAGMA user_version=2;')
  }

  seedDefaults(): void {
    const initialized = this.settingGet('app.initialized', null)
    if (initialized === true) return
    const defaults: Record<string, Json> = {
      'appearance.theme': 'light',
      'appearance.fontSize': 16,
      'appearance.density': 'comfortable',
      'language.locale': 'vi',
      'agent.defaultMode': 'agent',
      'agent.permissionMode': 'workspace-write',
      'agent.fullAccess': true,
      'agent.maxIterations': 0,
      'agent.maxToolCalls': 0,
      'agent.maxDurationMs': 0,
      'agent.maxStallIterations': 12,
      'agent.contextBudgetChars': 160000,
      'agent.autoVerify': true,
      'agent.autoReview': true,
      'workspace.defaultPermission': 'workspace-write',
      'terminal.shell': '',
      'terminal.fontSize': 13,
      'git.autoFetch': false,
      'notifications.native': true,
      'notifications.taskComplete': true,
      'panels.sidebarCollapsed': false,
      'panels.sidebarWidth': 272,
      'panels.inspectorWidth': 360,
      'panels.inspectorCollapsed': true,
      'editor.minimap': true,
      'editor.wordWrap': false,
      'app.initialized': true,
    }
    for (const [key, value] of Object.entries(defaults)) this.settingSet(key, value)
  }

  stats(): Json {
    const names = this.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    const tables: Json[] = []
    for (const { name } of names) {
      const row = this.queryOne<{ count: number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${name}"`,
      )
      tables.push({ name, rows: Number(row?.count ?? 0) })
    }
    return { sizeBytes: fileSize(this.path), tables }
  }

  backup(destination: string): string {
    ensureDirectory(
      destination.includes('/') ? destination.slice(0, destination.lastIndexOf('/')) : '.',
    )
    try {
      this.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}';`)
    } catch (error) {
      throw new NexusError(
        'E_DB',
        `Backup failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return destination
  }

  vacuum(): void {
    this.exec('VACUUM;')
  }

  /* ------------------------------------------------------------------ settings */
  private ensureSettingsLoaded(): void {
    if (this.settingsLoaded) return
    this.settingsCache.clear()
    for (const row of this.query<{ key: string; value_json: string | null }>(
      'SELECT key, value_json FROM settings',
    )) {
      this.settingsCache.set(row.key, parseOptionalJson(row.value_json))
    }
    this.settingsLoaded = true
  }

  settingsAll(): Json {
    const result: Record<string, Json> = {}
    for (const row of this.query<{ key: string; value_json: string | null }>(
      'SELECT key, value_json FROM settings',
    )) {
      result[row.key] = parseOptionalJson(row.value_json)
    }
    return result
  }

  settingGet(key: string, fallback: Json = null): Json {
    this.ensureSettingsLoaded()
    const value = this.settingsCache.get(key)
    return value === undefined ? fallback : value === null ? fallback : value
  }

  settingSet(key: string, value: Json): void {
    const normalized = value ?? null
    const serialized = JSON.stringify(normalized)
    this.run(
      'INSERT INTO settings(key, value_json, updated_at) VALUES(?,?,?) ' +
        'ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at',
      [sanitizeUtf8(key), sanitizeUtf8(serialized), nowMs()],
    )
    if (this.settingsLoaded) {
      if (normalized === null) this.settingsCache.delete(key)
      else this.settingsCache.set(key, normalized)
    }
  }

  settingReset(key?: string): void {
    if (key !== undefined) {
      this.run('DELETE FROM settings WHERE key=?', [key])
      if (this.settingsLoaded) this.settingsCache.delete(key)
      return
    }
    this.exec('DELETE FROM settings;')
    this.settingsCache.clear()
    this.settingsLoaded = true
  }

  /* ----------------------------------------------------------------- providers */
  private static providerPublicFromRow(row: Record<string, unknown>): Json {
    const provider: Record<string, unknown> = {
      id: row['id'],
      kind: row['kind'],
      name: row['name'],
      hasApiKey:
        typeof row['api_key_cipher'] === 'string' && (row['api_key_cipher'] as string) !== '',
      enabled: Number(row['enabled']) !== 0,
      supportsTools: Number(row['supports_tools']) !== 0,
      supportsVision: Number(row['supports_vision']) !== 0,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }
    if (row['base_url'] !== null && row['base_url'] !== undefined)
      provider['baseUrl'] = row['base_url']
    if (row['api_key_hint'] !== null && row['api_key_hint'] !== undefined)
      provider['apiKeyHint'] = row['api_key_hint']
    return provider
  }

  providerList(): Json[] {
    return this.query<Record<string, unknown>>(
      `SELECT ${PROVIDER_COLUMNS} FROM providers ORDER BY created_at DESC`,
    ).map((row) => Store.providerPublicFromRow(row))
  }

  providerGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${PROVIDER_COLUMNS} FROM providers WHERE id=?`,
      [id],
    )
    if (!row) throw new NexusError('E_CONFIG', `Provider ${id} not found`)
    return Store.providerPublicFromRow(row)
  }

  providerRaw(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${PROVIDER_COLUMNS} FROM providers WHERE id=?`,
      [id],
    )
    if (!row) throw new NexusError('E_CONFIG', `Provider ${id} not found`)
    const provider: Record<string, Json> = {
      id: row['id'] as string,
      kind: row['kind'] as string,
      name: row['name'] as string,
      enabled: Number(row['enabled']) !== 0,
      supportsTools: Number(row['supports_tools']) !== 0,
      supportsVision: Number(row['supports_vision']) !== 0,
    }
    if (row['base_url'] !== null) provider['baseUrl'] = row['base_url']
    if (row['api_key_cipher'] !== null) provider['apiKeyCipher'] = row['api_key_cipher']
    return provider
  }

  providerSave(input: Json, cipher?: string | null, hint?: string | null): Json {
    const id = jsonStr(input, 'id')
    const kind = jsonStr(input, 'kind')
    const name = trim(jsonStr(input, 'name'))
    let baseUrl = trim(jsonStr(input, 'baseUrl'))
    const enabled = boolValue(input?.['enabled'], true)
    const now = nowMs()
    if (id !== '') {
      const existing = this.providerRaw(id)
      if (baseUrl === '') baseUrl = jsonStr(existing, 'baseUrl')
      this.run(
        'UPDATE providers SET kind=?, name=?, base_url=?, enabled=?, updated_at=? WHERE id=?',
        [
          sanitizeUtf8(kind),
          sanitizeUtf8(name),
          baseUrl === '' ? null : sanitizeUtf8(baseUrl),
          enabled ? 1 : 0,
          now,
          id,
        ],
      )
      if (cipher !== undefined && cipher !== null) {
        this.run('UPDATE providers SET api_key_cipher=?, api_key_hint=? WHERE id=?', [
          cipher === '' ? null : sanitizeUtf8(cipher),
          hint && hint !== '' ? sanitizeUtf8(hint) : null,
          id,
        ])
      }
      return this.providerGet(id)
    }
    const newId = uuid()
    this.run(
      'INSERT INTO providers(id,kind,name,base_url,api_key_cipher,api_key_hint,enabled,supports_tools,supports_vision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [
        newId,
        sanitizeUtf8(kind),
        sanitizeUtf8(name),
        baseUrl === '' ? null : sanitizeUtf8(baseUrl),
        cipher && cipher !== '' ? sanitizeUtf8(cipher) : null,
        hint && hint !== '' ? sanitizeUtf8(hint) : null,
        enabled ? 1 : 0,
        boolValue(input?.['supportsTools'], true) ? 1 : 0,
        boolValue(input?.['supportsVision'], false) ? 1 : 0,
        now,
        now,
      ],
    )
    return this.providerGet(newId)
  }

  providerSetKey(id: string, cipher?: string | null, hint?: string | null): Json {
    this.providerRaw(id)
    this.run('UPDATE providers SET api_key_cipher=?, api_key_hint=?, updated_at=? WHERE id=?', [
      cipher && cipher !== '' ? sanitizeUtf8(cipher) : null,
      hint && hint !== '' ? sanitizeUtf8(hint) : null,
      nowMs(),
      id,
    ])
    return this.providerGet(id)
  }

  providerRemove(id: string): void {
    this.run('DELETE FROM providers WHERE id=?', [id])
  }

  /* --------------------------------------------------------------------- models */
  private static modelFromRow(row: Record<string, unknown>): Json {
    const model: Record<string, Json> = {
      id: row['id'],
      providerId: row['provider_id'],
      modelId: row['model_id'],
      displayName: row['display_name'],
      contextWindow: Number(row['context_window']),
      maxOutputTokens: Number(row['max_output_tokens']),
      temperature: Number(row['temperature']),
      categories: parseOptionalJson((row['categories_json'] as string | null) ?? null),
      supportsTools: Number(row['supports_tools']) !== 0,
      supportsVision: Number(row['supports_vision']) !== 0,
      supportsReasoning: Number(row['supports_reasoning']) !== 0,
      isDefault: Number(row['is_default']) !== 0,
      reasoningEffort: normalizeEffort((row['reasoning_effort'] as string | null) ?? 'medium'),
      variant: (row['variant'] as string | null) ?? '',
    }
    if (!Array.isArray(model['categories'])) model['categories'] = []
    return model
  }

  modelList(providerId?: string): Json[] {
    if (providerId !== undefined) {
      return this.query<Record<string, unknown>>(
        `SELECT ${MODEL_COLUMNS} FROM models WHERE provider_id=? ORDER BY is_default DESC, created_at DESC`,
        [providerId],
      ).map((row) => Store.modelFromRow(row))
    }
    return this.query<Record<string, unknown>>(
      `SELECT ${MODEL_COLUMNS} FROM models ORDER BY is_default DESC, created_at DESC`,
    ).map((row) => Store.modelFromRow(row))
  }

  modelGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${MODEL_COLUMNS} FROM models WHERE id=?`,
      [id],
    )
    if (!row) throw new NexusError('E_CONFIG', `Model ${id} not found`)
    return Store.modelFromRow(row)
  }

  modelDefault(): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${MODEL_COLUMNS} FROM models WHERE is_default=1 ORDER BY created_at ASC LIMIT 1`,
    )
    return row ? Store.modelFromRow(row) : null
  }

  modelFindByWire(providerId: string, modelId: string, variant = ''): Json {
    const exact = this.queryOne<Record<string, unknown>>(
      `SELECT ${MODEL_COLUMNS} FROM models WHERE provider_id=? AND model_id=? AND variant=? ORDER BY is_default DESC, created_at ASC LIMIT 1`,
      [providerId, modelId, variant],
    )
    if (exact) return Store.modelFromRow(exact)
    if (variant !== '') {
      const base = this.queryOne<Record<string, unknown>>(
        `SELECT ${MODEL_COLUMNS} FROM models WHERE provider_id=? AND model_id=? AND variant='' ORDER BY is_default DESC, created_at ASC LIMIT 1`,
        [providerId, modelId],
      )
      if (base) return Store.modelFromRow(base)
    }
    const any = this.queryOne<Record<string, unknown>>(
      `SELECT ${MODEL_COLUMNS} FROM models WHERE provider_id=? AND model_id=? ORDER BY is_default DESC, created_at ASC LIMIT 1`,
      [providerId, modelId],
    )
    return any ? Store.modelFromRow(any) : null
  }

  modelSave(input: Json): Json {
    const providerId = jsonStr(input, 'providerId')
    const modelId = jsonStr(input, 'modelId')
    this.providerRaw(providerId)
    const variant = jsonStr(input, 'variant')
    let requestedEffort = ''
    if (typeof input?.['reasoningEffort'] === 'string') {
      requestedEffort = normalizeEffort(input['reasoningEffort'])
    }
    let id = jsonStr(input, 'id')
    let existing: Json = null
    if (id !== '') {
      try {
        existing = this.modelGet(id)
      } catch {
        existing = null
      }
    }
    if (!existing) {
      const row = this.queryOne<Record<string, unknown>>(
        `SELECT ${MODEL_COLUMNS} FROM models WHERE provider_id=? AND model_id=? AND variant=? LIMIT 1`,
        [providerId, modelId, variant],
      )
      if (row) existing = Store.modelFromRow(row)
    }
    const now = nowMs()
    if (existing) {
      const existingId = existing['id'] as string
      const displayName = jsonStr(input, 'displayName', existing['displayName'])
      const contextWindow = jsonInt(input, 'contextWindow', existing['contextWindow'])
      const maxOutput = jsonInt(input, 'maxOutputTokens', existing['maxOutputTokens'])
      const temperature = jsonDouble(input, 'temperature', existing['temperature'])
      const categories = 'categories' in input ? input['categories'] : existing['categories']
      const reasoningEffort =
        requestedEffort === '' ? jsonStr(existing, 'reasoningEffort', 'medium') : requestedEffort
      this.run(
        'UPDATE models SET model_id=?, display_name=?, context_window=?, max_output_tokens=?, temperature=?, categories_json=?, supports_tools=?, supports_vision=?, supports_reasoning=?, reasoning_effort=?, variant=? WHERE id=?',
        [
          sanitizeUtf8(modelId),
          sanitizeUtf8(displayName),
          contextWindow,
          maxOutput,
          temperature,
          sanitizeUtf8(JSON.stringify(categories ?? [])),
          boolValue(input?.['supportsTools'], existing['supportsTools']) ? 1 : 0,
          boolValue(input?.['supportsVision'], existing['supportsVision']) ? 1 : 0,
          boolValue(input?.['supportsReasoning'], existing['supportsReasoning']) ? 1 : 0,
          reasoningEffort,
          sanitizeUtf8(jsonStr(input, 'variant', existing['variant'] ?? '')),
          existingId,
        ],
      )
      return this.modelGet(existingId)
    }
    id = uuid()
    let displayName = trim(jsonStr(input, 'displayName'))
    if (displayName === '') displayName = variant === '' ? modelId : `${modelId} · ${variant}`
    const categories = 'categories' in input ? input['categories'] : ['general']
    const reasoningEffort = requestedEffort === '' ? 'medium' : requestedEffort
    this.run(
      'INSERT INTO models(id,provider_id,model_id,display_name,context_window,max_output_tokens,temperature,categories_json,supports_tools,supports_vision,supports_reasoning,is_default,created_at,reasoning_effort,variant) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)',
      [
        id,
        sanitizeUtf8(providerId),
        sanitizeUtf8(modelId),
        sanitizeUtf8(displayName),
        jsonInt(input, 'contextWindow', 32768),
        jsonInt(input, 'maxOutputTokens', 8192),
        jsonDouble(input, 'temperature', 0.2),
        sanitizeUtf8(JSON.stringify(categories ?? ['general'])),
        boolValue(input?.['supportsTools'], true) ? 1 : 0,
        boolValue(input?.['supportsVision'], false) ? 1 : 0,
        boolValue(input?.['supportsReasoning'], false) ? 1 : 0,
        now,
        reasoningEffort,
        sanitizeUtf8(variant),
      ],
    )
    const countRow = this.queryOne<{ count: number | bigint }>(
      'SELECT COUNT(*) AS count FROM models WHERE is_default=1',
    )
    if (countRow && Number(countRow.count) === 0) this.modelSetDefault(id)
    return this.modelGet(id)
  }

  modelSetDefault(id: string): void {
    this.modelGet(id)
    this.db.exec('BEGIN;')
    try {
      this.run('UPDATE models SET is_default=0 WHERE is_default=1;', [])
      this.run('UPDATE models SET is_default=1 WHERE id=?', [id])
      this.db.exec('COMMIT;')
    } catch (error) {
      this.db.exec('ROLLBACK;')
      throw error
    }
  }

  modelRemove(id: string): void {
    this.run('DELETE FROM models WHERE id=?', [id])
  }

  /* ------------------------------------------------------------------- projects */
  private static projectFromRow(row: Record<string, unknown>): Json {
    const project: Record<string, Json> = {
      id: row['id'],
      name: row['name'],
      path: row['path'],
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }
    if (row['description'] !== null && row['description'] !== undefined)
      project['description'] = row['description']
    if (row['git_remote'] !== null && row['git_remote'] !== undefined)
      project['gitRemote'] = row['git_remote']
    if (row['default_branch'] !== null && row['default_branch'] !== undefined)
      project['defaultBranch'] = row['default_branch']
    if (row['last_opened_at'] !== null && row['last_opened_at'] !== undefined) {
      project['lastOpenedAt'] = Number(row['last_opened_at'])
    }
    return project
  }

  projectList(): Json[] {
    return this.query<Record<string, unknown>>(
      `SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY last_opened_at DESC, updated_at DESC`,
    ).map((row) => Store.projectFromRow(row))
  }

  projectGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id=?`,
      [id],
    )
    if (!row) throw new NexusError('E_DB', `Project ${id} not found`)
    return Store.projectFromRow(row)
  }

  projectFindByPath(path: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE path=?`,
      [path],
    )
    return row ? Store.projectFromRow(row) : null
  }

  projectRawPath(id: string): Json {
    return this.projectGet(id)
  }

  projectOpen(path: string, name: string, gitRemote?: string, defaultBranch?: string): Json {
    const existing = this.projectFindByPath(path)
    const now = nowMs()
    if (existing) {
      try {
        this.db.exec('BEGIN;')
        this.run(
          'UPDATE projects SET name=?, last_opened_at=?, updated_at=?, git_remote=COALESCE(?, git_remote), default_branch=COALESCE(?, default_branch) WHERE id=?',
          [
            name,
            now,
            now,
            gitRemote && gitRemote !== '' ? gitRemote : null,
            defaultBranch && defaultBranch !== '' ? defaultBranch : null,
            existing['id'] as string,
          ],
        )
        this.db.exec('COMMIT;')
      } catch (error) {
        this.db.exec('ROLLBACK;')
        throw error
      }
      return this.projectGet(existing['id'] as string)
    }
    const id = uuid()
    this.run(
      'INSERT INTO projects(id,name,path,git_remote,default_branch,last_opened_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      [
        id,
        sanitizeUtf8(name),
        sanitizeUtf8(path),
        gitRemote && gitRemote !== '' ? sanitizeUtf8(gitRemote) : null,
        defaultBranch && defaultBranch !== '' ? sanitizeUtf8(defaultBranch) : null,
        now,
        now,
        now,
      ],
    )
    return this.projectGet(id)
  }

  projectUpdate(id: string, patch: Json): Json {
    const existing = this.projectGet(id)
    if (!existing) throw new NexusError('E_DB', `Project ${id} not found`)
    const name = jsonStr(patch, 'name', existing['name'])
    let description: string | null | undefined
    if (typeof patch?.['description'] === 'string') description = patch['description']
    else if (typeof existing['description'] === 'string') description = existing['description']
    this.run('UPDATE projects SET name=?, description=?, updated_at=? WHERE id=?', [
      sanitizeUtf8(name),
      description === undefined || description === null ? null : sanitizeUtf8(description),
      nowMs(),
      id,
    ])
    return this.projectGet(id)
  }

  projectRemove(id: string): void {
    this.run('DELETE FROM projects WHERE id=?', [id])
  }

  projectSearch(query: string, limit: number): Json[] {
    const pattern = likePattern(query)
    return this.query<Record<string, unknown>>(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE name LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' LIMIT ?`,
      [pattern, pattern, Math.max(1, Math.trunc(limit) || 10)],
    ).map((row) => Store.projectFromRow(row))
  }

  /* ------------------------------------------------------------------- sessions */
  private static sessionFromRow(row: Record<string, unknown>): Json {
    const session: Record<string, Json> = {
      id: row['id'],
      title: row['title'],
      mode: row['mode'],
      permissionMode: row['permission_mode'],
      archived: Number(row['archived']) !== 0,
      pinned: Number(row['pinned']) !== 0,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
      modelVariant: (row['model_variant'] as string | null) ?? '',
    }
    if (row['project_id'] !== null) session['projectId'] = row['project_id']
    if (row['workspace_id'] !== null) session['workspaceId'] = row['workspace_id']
    if (row['provider_id'] !== null) session['providerId'] = row['provider_id']
    if (row['model_id'] !== null) session['modelId'] = row['model_id']
    return session
  }

  sessionList(filter: Json): Json[] {
    let sql = `SELECT ${SESSION_COLUMNS} FROM sessions WHERE 1=1`
    const values: BindValue[] = []
    if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
      if (typeof filter['projectId'] === 'string') {
        sql += ' AND project_id=?'
        values.push(filter['projectId'])
      }
      if (typeof filter['archived'] === 'boolean') {
        sql += ' AND archived=?'
        values.push(filter['archived'] ? 1 : 0)
      }
      const query = typeof filter['query'] === 'string' ? trim(filter['query']) : ''
      if (query !== '') {
        sql += " AND title LIKE ? ESCAPE '\\'"
        values.push(likePattern(query))
      }
    }
    sql += ' ORDER BY pinned DESC, updated_at DESC LIMIT 200'
    return this.query<Record<string, unknown>>(sql, values).map((row) => Store.sessionFromRow(row))
  }

  sessionGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id=?`,
      [id],
    )
    return row ? Store.sessionFromRow(row) : null
  }

  sessionCreate(input: Json): Json {
    const id = uuid()
    const now = nowMs()
    let title = trim(jsonStr(input, 'title'))
    if (title === '') title = 'Phiên mới'
    const mode = jsonStr(input, 'mode', 'agent')
    const permissionMode = jsonStr(input, 'permissionMode', 'workspace-write')
    const modelVariant = typeof input?.['modelVariant'] === 'string' ? input['modelVariant'] : ''
    this.run(
      'INSERT INTO sessions(id,project_id,title,mode,provider_id,model_id,permission_mode,archived,pinned,created_at,updated_at,model_variant) VALUES(?,?,?,?,?,?,?,0,0,?,?,?)',
      [
        id,
        projectRef(input?.['projectId']),
        sanitizeUtf8(title),
        mode,
        typeof input?.['providerId'] === 'string' ? input['providerId'] : null,
        typeof input?.['modelId'] === 'string' ? input['modelId'] : null,
        permissionMode,
        now,
        now,
        sanitizeUtf8(modelVariant),
      ],
    )
    return this.sessionGet(id)
  }

  sessionUpdate(id: string, patch: Json): Json {
    const existing = this.sessionGet(id)
    if (!existing) throw new NexusError('E_DB', `Session ${id} not found`)
    const title = jsonStr(patch, 'title', existing['title'])
    const mode = jsonStr(patch, 'mode', existing['mode'])
    const permissionMode = jsonStr(patch, 'permissionMode', existing['permissionMode'])
    let providerId: string | null =
      typeof existing['providerId'] === 'string' ? existing['providerId'] : null
    let modelId: string | null =
      typeof existing['modelId'] === 'string' ? existing['modelId'] : null
    let projectId: string | null =
      typeof existing['projectId'] === 'string' ? existing['projectId'] : null
    let modelVariant: string =
      typeof existing['modelVariant'] === 'string' ? (existing['modelVariant'] as string) : ''
    if (typeof patch?.['providerId'] === 'string') providerId = patch['providerId']
    if (typeof patch?.['modelId'] === 'string') modelId = patch['modelId']
    if (typeof patch?.['projectId'] === 'string') projectId = projectRef(patch['projectId'])
    if (typeof patch?.['modelVariant'] === 'string') modelVariant = patch['modelVariant']
    const archived = boolValue(patch?.['archived'], boolValue(existing['archived'], false))
    const pinned = boolValue(patch?.['pinned'], boolValue(existing['pinned'], false))
    this.run(
      'UPDATE sessions SET title=?, mode=?, provider_id=?, model_id=?, permission_mode=?, archived=?, pinned=?, project_id=?, model_variant=?, updated_at=? WHERE id=?',
      [
        sanitizeUtf8(title),
        mode,
        providerId,
        modelId,
        permissionMode,
        archived ? 1 : 0,
        pinned ? 1 : 0,
        projectId,
        sanitizeUtf8(modelVariant),
        nowMs(),
        id,
      ],
    )
    return this.sessionGet(id)
  }

  sessionTouch(id: string): void {
    this.run('UPDATE sessions SET updated_at=? WHERE id=?', [nowMs(), id])
  }

  sessionDuplicate(id: string): Json {
    const source = this.sessionGet(id)
    if (!source) throw new NexusError('E_DB', `Session ${id} not found`)
    const input: Record<string, Json> = {
      title: `${source['title']} (bản sao)`,
      mode: source['mode'],
      permissionMode: source['permissionMode'],
    }
    if (typeof source['projectId'] === 'string') input['projectId'] = source['projectId']
    if (typeof source['providerId'] === 'string') input['providerId'] = source['providerId']
    if (typeof source['modelId'] === 'string') input['modelId'] = source['modelId']
    if (typeof source['modelVariant'] === 'string') input['modelVariant'] = source['modelVariant']
    const copy = this.sessionCreate(input)
    const copyId = copy['id'] as string
    const messages = this.messageList(id)
    for (const message of messages) {
      const entry: Record<string, Json> = {
        sessionId: copyId,
        role: message['role'],
        content: message['content'] ?? '',
        status: message['status'] ?? 'complete',
      }
      if (typeof message['reasoning'] === 'string') entry['reasoning'] = message['reasoning']
      if ('toolCalls' in message) entry['toolCalls'] = message['toolCalls']
      if (typeof message['toolCallId'] === 'string') entry['toolCallId'] = message['toolCallId']
      if (typeof message['model'] === 'string') entry['model'] = message['model']
      if (typeof message['providerId'] === 'string') entry['providerId'] = message['providerId']
      if ('usage' in message) entry['usage'] = message['usage']
      if ('error' in message) entry['error'] = message['error']
      this.messageCreate(entry)
    }
    return copy
  }

  sessionRemove(id: string): void {
    this.run('DELETE FROM sessions WHERE id=?', [id])
  }

  sessionExport(id: string): string {
    const session = this.sessionGet(id)
    if (!session) throw new NexusError('E_DB', `Session ${id} not found`)
    let out = ''
    out += `# ${session['title']}\n\n`
    out += `_Mode: ${session['mode']} · ${isoFromMs(session['createdAt'])}_\n\n`
    for (const message of this.messageList(id)) {
      const role = message['role'] as string
      if (role === 'system') continue
      const content = (message['content'] as string) ?? ''
      if (
        role === 'assistant' &&
        (startsWith(content, 'Mô hình chỉ trả về phần suy luận') ||
          startsWith(content, 'Model không trả về nội dung') ||
          startsWith(content, 'Model trả về phản hồi rỗng'))
      ) {
        continue
      }
      const label = role === 'user' ? 'Người dùng' : role === 'assistant' ? 'NEXUS' : 'Tool'
      out += `## ${label}\n\n${content}\n\n`
      if (typeof message['reasoning'] === 'string' && message['reasoning'] !== '') {
        out += `<details><summary>Reasoning</summary>\n\n${message['reasoning']}\n\n</details>\n\n`
      }
    }
    return out
  }

  /* ------------------------------------------------------------------- messages */
  private static messageFromRow(row: Record<string, unknown>): Json {
    const message: Record<string, Json> = {
      id: row['id'],
      sessionId: row['session_id'],
      role: row['role'],
      content: row['content'],
      status: row['status'],
      createdAt: Number(row['created_at']),
    }
    const optionalText = (key: string): string | null => {
      const value = row[key]
      return typeof value === 'string' && value !== '' ? value : null
    }
    const reasoning = optionalText('reasoning')
    if (reasoning !== null) message['reasoning'] = reasoning
    const toolCalls = parseOptionalJson((row['tool_calls_json'] as string | null) ?? null)
    if (toolCalls !== null && toolCalls !== undefined) message['toolCalls'] = toolCalls
    const toolCallId = optionalText('tool_call_id')
    if (toolCallId !== null) message['toolCallId'] = toolCallId
    const model = optionalText('model')
    if (model !== null) message['model'] = model
    const providerId = optionalText('provider_id')
    if (providerId !== null) message['providerId'] = providerId
    const usage = parseOptionalJson((row['usage_json'] as string | null) ?? null)
    if (usage !== null && usage !== undefined) message['usage'] = usage
    const error = parseOptionalJson((row['error_json'] as string | null) ?? null)
    if (error !== null && error !== undefined) message['error'] = error
    return message
  }

  messageList(sessionId: string): Json[] {
    return this.query<Record<string, unknown>>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id=? ORDER BY created_at, rowid`,
      [sessionId],
    ).map((row) => Store.messageFromRow(row))
  }

  messageGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id=?`,
      [id],
    )
    return row ? Store.messageFromRow(row) : null
  }

  messageCreate(input: Json): Json {
    const id = jsonStr(input, 'id', uuid())
    this.run(
      'INSERT INTO messages(id,session_id,role,content,reasoning,tool_calls_json,tool_call_id,model,provider_id,usage_json,status,error_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        id,
        jsonStr(input, 'sessionId'),
        jsonStr(input, 'role'),
        jsonStr(input, 'content'),
        typeof input?.['reasoning'] === 'string' ? sanitizeUtf8(input['reasoning']) : null,
        'toolCalls' in input ? JSON.stringify(input['toolCalls'] ?? null) : null,
        typeof input?.['toolCallId'] === 'string' ? input['toolCallId'] : null,
        typeof input?.['model'] === 'string' ? input['model'] : null,
        typeof input?.['providerId'] === 'string' ? input['providerId'] : null,
        'usage' in input ? JSON.stringify(input['usage'] ?? null) : null,
        jsonStr(input, 'status', 'complete'),
        'error' in input ? JSON.stringify(input['error'] ?? null) : null,
        jsonInt(input, 'createdAt', nowMs()),
      ],
    )
    return this.messageGet(id)
  }

  messageUpdate(id: string, patch: Json): void {
    const assignments: string[] = []
    const values: BindValue[] = []
    const push = (column: string, value: BindValue): void => {
      assignments.push(`${column}=?`)
      values.push(value)
    }
    if ('content' in patch) push('content', sanitizeUtf8(jsonStr(patch, 'content')))
    if ('reasoning' in patch) {
      push(
        'reasoning',
        patch['reasoning'] === null ? null : sanitizeUtf8(jsonStr(patch, 'reasoning')),
      )
    }
    if ('toolCalls' in patch) {
      push(
        'tool_calls_json',
        patch['toolCalls'] === null ? null : JSON.stringify(patch['toolCalls']),
      )
    }
    if ('status' in patch) push('status', jsonStr(patch, 'status'))
    if ('usage' in patch) {
      push('usage_json', patch['usage'] === null ? null : JSON.stringify(patch['usage']))
    }
    if ('error' in patch) {
      push('error_json', patch['error'] === null ? null : JSON.stringify(patch['error']))
    }
    if (assignments.length === 0) return
    values.push(id)
    this.run(`UPDATE messages SET ${assignments.join(', ')} WHERE id=?`, values)
  }

  failInterruptedMessages(error: Json): void {
    this.run("UPDATE messages SET status='error', error_json=? WHERE status='streaming'", [
      JSON.stringify(error),
    ])
  }

  messageDelete(id: string): void {
    this.run('DELETE FROM messages WHERE id=?', [id])
  }

  /* ---------------------------------------------------------------------- tasks */
  private static taskFromRow(row: Record<string, unknown>): Json {
    const task: Record<string, Json> = {
      id: row['id'],
      sessionId: row['session_id'],
      title: row['title'],
      prompt: row['prompt'],
      mode: row['mode'],
      state: row['state'],
      permissionMode: row['permission_mode'],
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }
    if (row['project_id'] !== null && row['project_id'] !== undefined)
      task['projectId'] = row['project_id']
    const plan = parseOptionalJson((row['plan_json'] as string | null) ?? null)
    if (plan !== null && plan !== undefined) task['plan'] = plan
    if (row['summary'] !== null && row['summary'] !== undefined) task['summary'] = row['summary']
    const error = parseOptionalJson((row['error_json'] as string | null) ?? null)
    if (error !== null && error !== undefined) task['error'] = error
    if (row['provider_id'] !== null && row['provider_id'] !== undefined)
      task['providerId'] = row['provider_id']
    if (row['model_id'] !== null && row['model_id'] !== undefined) task['modelId'] = row['model_id']
    if (row['started_at'] !== null && row['started_at'] !== undefined)
      task['startedAt'] = Number(row['started_at'])
    if (row['completed_at'] !== null && row['completed_at'] !== undefined)
      task['completedAt'] = Number(row['completed_at'])
    return task
  }

  taskCreate(input: Json): Json {
    const id = uuid()
    const now = nowMs()
    const prompt = jsonStr(input, 'prompt')
    let title = trim(jsonStr(input, 'title'))
    if (title === '') title = collapsedPrompt(prompt, 80)
    if (title === '') title = 'Tác vụ mới'
    this.run(
      "INSERT INTO tasks(id,session_id,project_id,title,prompt,mode,state,provider_id,model_id,permission_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,'idle',?,?,?,?,?)",
      [
        id,
        jsonStr(input, 'sessionId'),
        projectRef(input?.['projectId']),
        sanitizeUtf8(title),
        sanitizeUtf8(prompt),
        jsonStr(input, 'mode', 'agent'),
        typeof input?.['providerId'] === 'string' ? input['providerId'] : null,
        typeof input?.['modelId'] === 'string' ? input['modelId'] : null,
        jsonStr(input, 'permissionMode', 'workspace-write'),
        now,
        now,
      ],
    )
    return this.taskGet(id)
  }

  taskGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE id=?`,
      [id],
    )
    return row ? Store.taskFromRow(row) : null
  }

  taskList(filter: Json): Json[] {
    let sql = `SELECT ${TASK_COLUMNS} FROM tasks WHERE 1=1`
    const values: BindValue[] = []
    if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
      if (typeof filter['sessionId'] === 'string') {
        sql += ' AND session_id=?'
        values.push(filter['sessionId'])
      }
      if (typeof filter['projectId'] === 'string') {
        sql += ' AND project_id=?'
        values.push(filter['projectId'])
      }
    }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    values.push(jsonInt(filter, 'limit', 100))
    return this.query<Record<string, unknown>>(sql, values).map((row) => Store.taskFromRow(row))
  }

  taskActive(): Json[] {
    return this.query<Record<string, unknown>>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE state IN ('idle','planning','running','waiting_tool','waiting_approval','retrying') ORDER BY created_at`,
    ).map((row) => Store.taskFromRow(row))
  }

  taskRemove(id: string): void {
    this.db.exec('BEGIN;')
    try {
      for (const sql of [
        'DELETE FROM task_steps WHERE task_id=?',
        'DELETE FROM tool_calls WHERE task_id=?',
        'DELETE FROM file_changes WHERE task_id=?',
        'DELETE FROM tasks WHERE id=?',
      ]) {
        this.run(sql, [id])
      }
      this.db.exec('COMMIT;')
    } catch (error) {
      this.db.exec('ROLLBACK;')
      throw error
    }
  }

  taskState(id: string, state: string, startedAt?: number, completedAt?: number): void {
    this.run(
      'UPDATE tasks SET state=?, updated_at=?, started_at=COALESCE(?, started_at), completed_at=COALESCE(?, completed_at) WHERE id=?',
      [state, nowMs(), startedAt ?? null, completedAt ?? null, id],
    )
  }

  taskSetPlan(id: string, plan: Json): void {
    this.run('UPDATE tasks SET plan_json=?, updated_at=? WHERE id=?', [
      JSON.stringify(plan ?? {}),
      nowMs(),
      id,
    ])
  }

  taskSetSummary(id: string, summary: string): void {
    this.run('UPDATE tasks SET summary=?, updated_at=? WHERE id=?', [
      sanitizeUtf8(summary),
      nowMs(),
      id,
    ])
  }

  taskSetError(id: string, error: Json): void {
    this.run('UPDATE tasks SET error_json=?, updated_at=? WHERE id=?', [
      error === null || error === undefined ? null : JSON.stringify(error),
      nowMs(),
      id,
    ])
  }

  private static stepFromRow(row: Record<string, unknown>): Json {
    const step: Record<string, Json> = {
      id: row['id'],
      taskId: row['task_id'],
      index: Number(row['index_no']),
      title: row['title'],
      state: row['state'],
    }
    if (row['description'] !== null) step['description'] = row['description']
    if (row['result'] !== null) step['result'] = row['result']
    if (row['started_at'] !== null) step['startedAt'] = Number(row['started_at'])
    if (row['completed_at'] !== null) step['completedAt'] = Number(row['completed_at'])
    return step
  }

  taskSteps(taskId: string): Json[] {
    return this.query<Record<string, unknown>>(
      'SELECT id, task_id, index_no, title, state, description, result, started_at, completed_at FROM task_steps WHERE task_id=? ORDER BY index_no',
      [taskId],
    ).map((row) => Store.stepFromRow(row))
  }

  taskStepsReplace(taskId: string, steps: Json): Json[] {
    try {
      this.db.exec('BEGIN;')
      this.run('DELETE FROM task_steps WHERE task_id=?', [taskId])
      if (Array.isArray(steps)) {
        let index = 0
        for (const item of steps) {
          if (index >= 12) break
          const title = typeof item === 'string' ? item : jsonStr(item, 'title')
          if (trim(title) === '') continue
          const description = typeof item === 'string' ? '' : jsonStr(item, 'description')
          this.run(
            "INSERT INTO task_steps(id,task_id,index_no,title,description,state) VALUES(?,?,?,?,?,'pending')",
            [
              uuid(),
              taskId,
              index,
              sanitizeUtf8(trim(title)),
              description === '' ? null : sanitizeUtf8(description),
            ],
          )
          index += 1
        }
      }
      this.db.exec('COMMIT;')
    } catch (error) {
      this.db.exec('ROLLBACK;')
      throw error
    }
    return this.taskSteps(taskId)
  }

  taskStepUpdate(id: string, patch: Json): void {
    const assignments: string[] = []
    const values: BindValue[] = []
    if ('state' in patch) {
      assignments.push('state=?')
      values.push(jsonStr(patch, 'state'))
    }
    if ('result' in patch) {
      assignments.push('result=?')
      values.push(jsonStr(patch, 'result'))
    }
    if ('startedAt' in patch) {
      assignments.push('started_at=?')
      values.push(jsonInt(patch, 'startedAt', nowMs()))
    }
    if ('completedAt' in patch) {
      assignments.push('completed_at=?')
      values.push(jsonInt(patch, 'completedAt', nowMs()))
    }
    if (assignments.length === 0) return
    values.push(id)
    this.run(`UPDATE task_steps SET ${assignments.join(', ')} WHERE id=?`, values)
  }

  /* ---------------------------------------------------------------- tool calls */
  private static toolCallFromRow(row: Record<string, unknown>): Json {
    const call: Record<string, Json> = {
      id: row['id'],
      sessionId: row['session_id'],
      toolName: row['tool_name'],
      input: parseOptionalJson((row['input_json'] as string | null) ?? null) ?? {},
      status: row['status'],
      approval: row['approval'],
      createdAt: Number(row['created_at']),
    }
    if (row['task_id'] !== null) call['taskId'] = row['task_id']
    const output = parseOptionalJson((row['output_json'] as string | null) ?? null)
    if (output !== null && output !== undefined) call['output'] = output
    const error = parseOptionalJson((row['error_json'] as string | null) ?? null)
    if (error !== null && error !== undefined) call['error'] = error
    if (row['duration_ms'] !== null && row['duration_ms'] !== undefined) {
      call['durationMs'] = Number(row['duration_ms'])
    }
    return call
  }

  toolCallsList(filter: Json): Json[] {
    let sql = `SELECT ${TOOL_CALL_COLUMNS} FROM tool_calls WHERE 1=1`
    const values: BindValue[] = []
    if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
      if (typeof filter['taskId'] === 'string') {
        sql += ' AND task_id=?'
        values.push(filter['taskId'])
      }
      if (typeof filter['sessionId'] === 'string') {
        sql += ' AND session_id=?'
        values.push(filter['sessionId'])
      }
    }
    sql += ' ORDER BY created_at, rowid LIMIT ?'
    values.push(jsonInt(filter, 'limit', 500))
    return this.query<Record<string, unknown>>(sql, values).map((row) => Store.toolCallFromRow(row))
  }

  toolCallGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${TOOL_CALL_COLUMNS} FROM tool_calls WHERE id=?`,
      [id],
    )
    return row ? Store.toolCallFromRow(row) : null
  }

  toolCallCreate(input: Json): Json {
    const id = jsonStr(input, 'id', uuid())
    this.run(
      'INSERT INTO tool_calls(id,task_id,session_id,tool_name,input_json,status,approval,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [
        id,
        typeof input?.['taskId'] === 'string' ? input['taskId'] : null,
        jsonStr(input, 'sessionId'),
        jsonStr(input, 'toolName'),
        JSON.stringify('input' in input ? input['input'] : {}),
        jsonStr(input, 'status', 'pending'),
        'none',
        nowMs(),
      ],
    )
    return this.toolCallGet(id)
  }

  toolCallUpdate(id: string, patch: Json): Json {
    const assignments: string[] = []
    const values: BindValue[] = []
    if ('status' in patch) {
      assignments.push('status=?')
      values.push(jsonStr(patch, 'status'))
    }
    if ('approval' in patch) {
      assignments.push('approval=?')
      values.push(jsonStr(patch, 'approval'))
    }
    if ('output' in patch) {
      assignments.push('output_json=?')
      values.push(patch['output'] === null ? null : JSON.stringify(patch['output']))
    }
    if ('error' in patch) {
      assignments.push('error_json=?')
      values.push(patch['error'] === null ? null : JSON.stringify(patch['error']))
    }
    if ('durationMs' in patch) {
      assignments.push('duration_ms=?')
      values.push(jsonInt(patch, 'durationMs', 0))
    }
    if (assignments.length === 0) return this.toolCallGet(id)
    values.push(id)
    this.run(`UPDATE tool_calls SET ${assignments.join(', ')} WHERE id=?`, values)
    return this.toolCallGet(id)
  }

  /* --------------------------------------------------------------- file changes */
  private static fileChangeFromRow(row: Record<string, unknown>): Json {
    const change: Record<string, Json> = {
      id: row['id'],
      sessionId: row['session_id'],
      path: row['path'],
      changeType: row['change_type'],
      addedLines: Number(row['added_lines']),
      removedLines: Number(row['removed_lines']),
      status: row['status'],
      createdAt: Number(row['created_at']),
    }
    if (row['task_id'] !== null) change['taskId'] = row['task_id']
    if (row['project_id'] !== null) change['projectId'] = row['project_id']
    if (row['before_content'] !== null && row['before_content'] !== undefined)
      change['beforeContent'] = row['before_content']
    if (row['after_content'] !== null && row['after_content'] !== undefined)
      change['afterContent'] = row['after_content']
    return change
  }

  fileChangesList(filter: Json): Json[] {
    let sql = `SELECT ${FILE_CHANGE_COLUMNS} FROM file_changes WHERE 1=1`
    const values: BindValue[] = []
    if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
      if (typeof filter['taskId'] === 'string') {
        sql += ' AND task_id=?'
        values.push(filter['taskId'])
      }
      if (typeof filter['sessionId'] === 'string') {
        sql += ' AND session_id=?'
        values.push(filter['sessionId'])
      }
      if (typeof filter['status'] === 'string') {
        sql += ' AND status=?'
        values.push(filter['status'])
      }
    }
    sql += ' ORDER BY created_at DESC, rowid DESC'
    return this.query<Record<string, unknown>>(sql, values).map((row) =>
      Store.fileChangeFromRow(row),
    )
  }

  fileChangePaths(taskId: string): string[] {
    const rows = this.query<{ path: string }>(
      'SELECT DISTINCT path FROM file_changes WHERE task_id=? ORDER BY 1',
      [taskId],
    )
    return rows.map((row) => row.path)
  }

  fileChangeGet(id: string): Json {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT ${FILE_CHANGE_COLUMNS} FROM file_changes WHERE id=?`,
      [id],
    )
    return row ? Store.fileChangeFromRow(row) : null
  }

  fileChangeRecord(input: Json): Json {
    const id = uuid()
    this.run(
      'INSERT INTO file_changes(id,task_id,session_id,project_id,path,change_type,before_content,after_content,added_lines,removed_lines,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        id,
        typeof input?.['taskId'] === 'string' ? input['taskId'] : null,
        jsonStr(input, 'sessionId'),
        projectRef(input?.['projectId']),
        sanitizeUtf8(jsonStr(input, 'path')),
        jsonStr(input, 'changeType', 'modify'),
        typeof input?.['beforeContent'] === 'string' ? input['beforeContent'] : null,
        typeof input?.['afterContent'] === 'string' ? input['afterContent'] : null,
        jsonInt(input, 'addedLines', 0),
        jsonInt(input, 'removedLines', 0),
        jsonStr(input, 'status', 'proposed'),
        nowMs(),
      ],
    )
    return this.fileChangeGet(id)
  }

  fileChangeStatus(id: string, status: string): Json {
    this.run('UPDATE file_changes SET status=? WHERE id=?', [status, id])
    return this.fileChangeGet(id)
  }

  /* ----------------------------------------------------------------------- usage */
  private static usageFromRow(row: Record<string, unknown>): Json {
    const usage: Record<string, Json> = {
      id: row['id'],
      inputTokens: Number(row['input_tokens']),
      outputTokens: Number(row['output_tokens']),
      cachedInputTokens: Number(row['cached_input_tokens']),
      source: row['source'],
      createdAt: Number(row['created_at']),
    }
    if (row['provider_id'] !== null && row['provider_id'] !== undefined)
      usage['providerId'] = row['provider_id']
    if (row['model_id'] !== null && row['model_id'] !== undefined)
      usage['modelId'] = row['model_id']
    if (row['session_id'] !== null && row['session_id'] !== undefined)
      usage['sessionId'] = row['session_id']
    if (row['task_id'] !== null && row['task_id'] !== undefined) usage['taskId'] = row['task_id']
    if (row['duration_ms'] !== null && row['duration_ms'] !== undefined)
      usage['durationMs'] = Number(row['duration_ms'])
    if (row['estimated_cost_usd'] !== null && row['estimated_cost_usd'] !== undefined) {
      usage['estimatedCostUsd'] = Number(row['estimated_cost_usd'])
    }
    return usage
  }

  usageInsert(input: Json): Json {
    const id = uuid()
    this.run(
      'INSERT INTO usage_records(id,provider_id,model_id,session_id,task_id,input_tokens,output_tokens,cached_input_tokens,duration_ms,ttft_ms,estimated_cost_usd,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        id,
        typeof input?.['providerId'] === 'string' ? input['providerId'] : null,
        typeof input?.['modelId'] === 'string' ? input['modelId'] : null,
        typeof input?.['sessionId'] === 'string' ? input['sessionId'] : null,
        typeof input?.['taskId'] === 'string' ? input['taskId'] : null,
        jsonInt(input, 'inputTokens', 0),
        jsonInt(input, 'outputTokens', 0),
        jsonInt(input, 'cachedInputTokens', 0),
        jsonInt(input, 'durationMs', 0),
        input?.['ttftMs'] === undefined || input?.['ttftMs'] === null
          ? null
          : jsonInt(input, 'ttftMs', 0),
        jsonDouble(input, 'estimatedCostUsd', 0),
        jsonStr(input, 'source', 'provider'),
        nowMs(),
      ],
    )
    const rows = this.query<Record<string, unknown>>(
      `SELECT ${USAGE_COLUMNS} FROM usage_records WHERE id=?`,
      [id],
    )
    return rows.length > 0 ? Store.usageFromRow(rows[0] as Record<string, unknown>) : { id }
  }

  usageList(limit: number): Json[] {
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), 1000)
    return this.query<Record<string, unknown>>(
      `SELECT ${USAGE_COLUMNS} FROM usage_records ORDER BY created_at DESC LIMIT ?`,
      [cap],
    ).map((row) => Store.usageFromRow(row))
  }

  usageSummary(days: number): Json {
    const since = nowMs() - Math.max(1, days) * 24 * 60 * 60 * 1000
    const totals = this.queryOne<Record<string, unknown>>(
      'SELECT COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COUNT(*) AS requests, COALESCE(SUM(estimated_cost_usd),0) AS cost FROM usage_records WHERE created_at>=?',
      [since],
    )
    const byModel = this.query<Record<string, unknown>>(
      "SELECT COALESCE(model_id,'?') AS model_id, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(*) AS requests FROM usage_records WHERE created_at>=? GROUP BY model_id ORDER BY COUNT(*) DESC",
      [since],
    )
    return {
      inputTokens: Number(totals?.['input_tokens'] ?? 0),
      outputTokens: Number(totals?.['output_tokens'] ?? 0),
      requests: Number(totals?.['requests'] ?? 0),
      estimatedCostUsd: Number(totals?.['cost'] ?? 0),
      byModel: byModel.map((row) => ({
        modelId: row['model_id'] as string,
        inputTokens: Number(row['input_tokens']),
        outputTokens: Number(row['output_tokens']),
        requests: Number(row['requests']),
      })),
    }
  }

  sessionStats(sessionId: string): Json {
    const totals = this.queryOne<Record<string, unknown>>(
      'SELECT COUNT(*) AS turns, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(cached_input_tokens),0) AS cached_tokens, COALESCE(SUM(duration_ms),0) AS llm_ms, COALESCE(SUM(ttft_ms),0) AS ttft_ms, COUNT(ttft_ms) AS ttft_count FROM usage_records WHERE session_id=?',
      [sessionId],
    )
    const toolMs = this.queryOne<Record<string, unknown>>(
      'SELECT COALESCE(SUM(duration_ms),0) AS tool_ms FROM tool_calls WHERE session_id=?',
      [sessionId],
    )
    const plan = this.queryOne<Record<string, unknown>>(
      'SELECT COUNT(*) AS steps FROM task_steps WHERE task_id IN (SELECT id FROM tasks WHERE session_id=?)',
      [sessionId],
    )
    return {
      sessionId,
      turns: Number(totals?.['turns'] ?? 0),
      inputTokens: Number(totals?.['input_tokens'] ?? 0),
      outputTokens: Number(totals?.['output_tokens'] ?? 0),
      cachedTokens: Number(totals?.['cached_tokens'] ?? 0),
      llmMs: Number(totals?.['llm_ms'] ?? 0),
      ttftMs: Number(totals?.['ttft_ms'] ?? 0),
      ttftCount: Number(totals?.['ttft_count'] ?? 0),
      steps: Number(plan?.['steps'] ?? 0),
      toolMs: Number(toolMs?.['tool_ms'] ?? 0),
    }
  }

  /* --------------------------------------------------------------------- memory */
  private static memoryFromRow(row: Record<string, unknown>): Json {
    const memory: Record<string, Json> = {
      id: row['id'],
      kind: row['kind'],
      content: row['content'],
      tags: parseOptionalJson((row['tags_json'] as string | null) ?? null) ?? [],
      createdAt: Number(row['created_at']),
    }
    if (row['project_id'] !== null && row['project_id'] !== undefined)
      memory['projectId'] = row['project_id']
    if (row['source_session_id'] !== null && row['source_session_id'] !== undefined) {
      memory['sourceSessionId'] = row['source_session_id']
    }
    if (!Array.isArray(memory['tags'])) memory['tags'] = []
    return memory
  }

  memoryList(projectId: string | undefined, limit: number): Json[] {
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), 500)
    const where = projectId !== undefined ? ' WHERE project_id=?' : ''
    const params: BindValue[] = projectId !== undefined ? [projectId, cap] : [cap]
    return this.query<Record<string, unknown>>(
      `SELECT id, project_id, kind, content, tags_json, source_session_id, created_at FROM agent_memory${where} ORDER BY created_at DESC LIMIT ?`,
      params,
    ).map((row) => Store.memoryFromRow(row))
  }

  /** Tìm trong nội dung bộ nhớ bền vững (danh sách agent_memory). */
  memorySearch(query: string, limit: number): Json[] {
    const needle = likePattern(toLower(trim(query)))
    if (needle === '%%') return []
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), 200)
    return this.query<Record<string, unknown>>(
      `SELECT id, project_id, kind, content, tags_json, source_session_id, created_at FROM agent_memory
       WHERE lower(content) LIKE ? ESCAPE '\\' OR lower(kind) LIKE ? ESCAPE '\\' OR lower(tags_json) LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`,
      [needle, needle, needle, cap],
    ).map((row) => Store.memoryFromRow(row))
  }

  /** Tìm lại lịch sử hội thoại: trả về đoạn tin nhắn kèm tiêu đề phiên. */
  messageSearch(query: string, limit: number, sessionId?: string): Json[] {
    const needle = likePattern(toLower(trim(query)))
    if (needle === '%%') return []
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), 200)
    let sql = `SELECT m.id, m.session_id, m.role, m.content, m.created_at, s.title
       FROM messages m JOIN sessions s ON s.id=m.session_id
       WHERE lower(m.content) LIKE ? ESCAPE '\\'`
    const values: BindValue[] = [needle]
    if (sessionId !== undefined) {
      sql += ' AND m.session_id=?'
      values.push(sessionId)
    }
    sql += ' ORDER BY m.created_at DESC LIMIT ?'
    values.push(cap)
    return this.query<Record<string, unknown>>(sql, values).map((row) => {
      const content = String(row['content'] ?? '')
      return {
        id: row['id'],
        sessionId: row['session_id'],
        sessionTitle: row['title'] ?? '',
        role: row['role'],
        content: content.length > 400 ? `${content.slice(0, 400)}…` : content,
        createdAt: Number(row['created_at']),
      }
    })
  }

  memoryCreate(input: Json): Json {
    const id = uuid()
    this.run(
      'INSERT INTO agent_memory(id,project_id,kind,content,tags_json,source_session_id,created_at) VALUES(?,?,?,?,?,?,?)',
      [
        id,
        projectRef(input?.['projectId']),
        jsonStr(input, 'kind', 'fact'),
        sanitizeUtf8(jsonStr(input, 'content')),
        JSON.stringify(Array.isArray(input?.['tags']) ? input['tags'] : []),
        typeof input?.['sourceSessionId'] === 'string' ? input['sourceSessionId'] : null,
        nowMs(),
      ],
    )
    const rows = this.memoryList(projectRef(input?.['projectId']) ?? undefined, 10_000)
    const found = rows.find((row) => row['id'] === id)
    return found ?? { id }
  }

  memoryRemove(id: string): void {
    this.run('DELETE FROM agent_memory WHERE id=?', [id])
  }

  /* ------------------------------------------------------------------- skills */
  private skillFromRow(row: Record<string, unknown>): Record<string, Json> {
    const tags = parseOptionalJson((row['tags_json'] as string | null) ?? null)
    return {
      id: row['id'],
      name: row['name'],
      description: row['description'],
      content: row['content'],
      tags: Array.isArray(tags) ? tags : [],
      ...(row['source_task_id'] ? { sourceTaskId: row['source_task_id'] } : {}),
      ...(row['project_id'] ? { projectId: row['project_id'] } : {}),
      useCount: Number(row['use_count'] ?? 0),
      version: Number(row['version'] ?? 1),
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }
  }

  skillList(limit = 20): Json[] {
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100)
    return this.query<Record<string, unknown>>(
      'SELECT * FROM agent_skills ORDER BY use_count DESC, updated_at DESC LIMIT ?',
      [cap],
    ).map((row) => this.skillFromRow(row))
  }

  skillGet(id: string): Json | null {
    const row = this.queryOne<Record<string, unknown>>('SELECT * FROM agent_skills WHERE id=?', [
      id,
    ])
    return row ? this.skillFromRow(row) : null
  }

  skillSearch(query: string, limit = 10): Json[] {
    const needle = likePattern(toLower(trim(query)))
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100)
    return this.query<Record<string, unknown>>(
      `SELECT * FROM agent_skills WHERE lower(name) LIKE ? OR lower(description) LIKE ? OR lower(content) LIKE ? ORDER BY use_count DESC, updated_at DESC LIMIT ?`,
      [needle, needle, needle, cap],
    ).map((row) => this.skillFromRow(row))
  }

  /** Tạo skill mới hoặc tự cải thiện skill cùng tên (tăng version). */
  skillSave(input: Json): Json {
    const name = trim(jsonStr(input, 'name'))
    if (name === '') throw new NexusError('E_VALIDATION', 'Skill name is required')
    const content = sanitizeUtf8(jsonStr(input, 'content'))
    if (content === '') throw new NexusError('E_VALIDATION', 'Skill content is required')
    const description = sanitizeUtf8(jsonStr(input, 'description'))
    const tags = JSON.stringify(Array.isArray(input?.['tags']) ? input['tags'] : [])
    const projectId = projectRef(input?.['projectId'])
    const sourceTaskId = typeof input?.['sourceTaskId'] === 'string' ? input['sourceTaskId'] : null
    const id = typeof input?.['id'] === 'string' ? input['id'] : ''
    const now = nowMs()
    const existing =
      id !== ''
        ? this.queryOne<Record<string, unknown>>('SELECT * FROM agent_skills WHERE id=?', [id])
        : this.queryOne<Record<string, unknown>>('SELECT * FROM agent_skills WHERE name=?', [name])
    if (existing) {
      const skillId = String(existing['id'])
      this.run(
        `UPDATE agent_skills SET name=?, description=?, content=?, tags_json=?, use_count=?, version=?, updated_at=? WHERE id=?`,
        [
          sanitizeUtf8(name),
          description,
          content,
          tags,
          Number(existing['use_count'] ?? 0),
          Number(existing['version'] ?? 1) + 1,
          now,
          skillId,
        ],
      )
      return this.skillGet(skillId) ?? { id: skillId }
    }
    const newId = uuid()
    this.run(
      `INSERT INTO agent_skills(id,name,description,content,tags_json,source_task_id,project_id,use_count,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newId,
        sanitizeUtf8(name),
        description,
        content,
        tags,
        sourceTaskId,
        projectId,
        0,
        1,
        now,
        now,
      ],
    )
    return this.skillGet(newId) ?? { id: newId }
  }

  skillBumpUse(ids: string[]): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    this.run(`UPDATE agent_skills SET use_count=use_count+1 WHERE id IN (${placeholders})`, ids)
  }

  skillDelete(id: string): void {
    this.run('DELETE FROM agent_skills WHERE id=?', [id])
  }

  /* ---------------------------------------------------------------- automations */
  automationList(): Json[] {
    return this.query('SELECT * FROM automations ORDER BY created_at DESC')
  }

  automationGet(id: string): Json {
    return this.queryOne('SELECT * FROM automations WHERE id=?', [id]) ?? null
  }

  automationCreate(input: Json): Json {
    const id = uuid()
    const now = nowMs()
    this.run(
      `INSERT INTO automations(id,name,prompt,schedule,enabled,channel,target,project_id,last_run_at,next_run_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        sanitizeUtf8(jsonStr(input, 'name') || 'Automation'),
        sanitizeUtf8(jsonStr(input, 'prompt')),
        sanitizeUtf8(jsonStr(input, 'schedule', '* * * * *')),
        boolValue(input?.['enabled'], true) ? 1 : 0,
        jsonStr(input, 'channel', 'none'),
        jsonStr(input, 'target'),
        projectRef(input?.['projectId']),
        null,
        Math.trunc(Number(input?.['nextRunAt']) || now),
        now,
        now,
      ],
    )
    return this.automationGet(id)
  }

  automationUpdate(id: string, patch: Json): Json {
    const existing = this.automationGet(id)
    if (!existing) throw new NexusError('E_DB', `Automation ${id} not found`)
    this.run(
      `UPDATE automations SET name=?,prompt=?,schedule=?,enabled=?,channel=?,target=?,next_run_at=?,updated_at=? WHERE id=?`,
      [
        sanitizeUtf8(jsonStr(patch, 'name', String(existing['name']))),
        sanitizeUtf8(jsonStr(patch, 'prompt', String(existing['prompt']))),
        sanitizeUtf8(jsonStr(patch, 'schedule', String(existing['schedule']))),
        boolValue(patch?.['enabled'], boolValue(existing['enabled'], true)) ? 1 : 0,
        jsonStr(patch, 'channel', String(existing['channel'])),
        jsonStr(patch, 'target', String(existing['target'])),
        Math.trunc(Number(patch?.['nextRunAt']) || Number(existing['next_run_at']) || nowMs()),
        nowMs(),
        id,
      ],
    )
    return this.automationGet(id)
  }

  automationDelete(id: string): void {
    this.run('DELETE FROM automations WHERE id=?', [id])
  }

  automationSetRun(id: string, lastRunAt: number, nextRunAt: number): void {
    this.run('UPDATE automations SET last_run_at=?,next_run_at=?,updated_at=? WHERE id=?', [
      Math.trunc(lastRunAt),
      Math.trunc(nextRunAt),
      nowMs(),
      id,
    ])
  }

  automationDue(now: number): Json[] {
    return this.query(
      'SELECT * FROM automations WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC',
      [Math.trunc(now)],
    )
  }

  /* ------------------------------------------------------------------ git ops */
  gitopsRecord(input: Json): Json {
    const id = uuid()
    this.run(
      'INSERT INTO git_operations(id,project_id,operation,args_json,status,output,error,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [
        id,
        jsonStr(input, 'projectId'),
        jsonStr(input, 'operation'),
        'args' in input ? JSON.stringify(input['args'] ?? null) : null,
        jsonStr(input, 'status'),
        typeof input?.['output'] === 'string' ? input['output'] : null,
        typeof input?.['error'] === 'string' ? input['error'] : null,
        nowMs(),
      ],
    )
    return { id }
  }

  /* ------------------------------------------------------------ dependency log */
  dependencyEventAdd(input: Json): Json {
    const id = uuid()
    this.run(
      'INSERT INTO dependency_events(id,domain_id,tool_id,action,command,exit_code,ok,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [
        id,
        jsonStr(input, 'domainId', 'core'),
        jsonStr(input, 'toolId'),
        jsonStr(input, 'action', 'install'),
        typeof input?.['command'] === 'string' ? input['command'] : null,
        typeof input?.['exitCode'] === 'number' ? Math.trunc(input['exitCode']) : null,
        input?.['ok'] === true ? 1 : 0,
        JSON.stringify(input?.['detail'] ?? {}),
        nowMs(),
      ],
    )
    return { id }
  }

  dependencyEvents(limit: number): Json[] {
    const cap = Math.min(Math.max(Math.trunc(limit) || 20, 1), 500)
    return this.query<Record<string, unknown>>(
      'SELECT id, domain_id, tool_id, action, command, exit_code, ok, detail_json, created_at FROM dependency_events ORDER BY created_at DESC LIMIT ?',
      [cap],
    ).map((row) => ({
      id: row['id'],
      domainId: row['domain_id'],
      toolId: row['tool_id'],
      action: row['action'],
      command: row['command'],
      exitCode: row['exit_code'],
      ok: row['ok'] === 1,
      detail: parseOptionalJson((row['detail_json'] as string | null) ?? null) ?? {},
      createdAt: Number(row['created_at']),
    }))
  }
}
