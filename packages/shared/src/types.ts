export type Id = string

export type ProviderKind =
  | 'openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'ollama'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'cohere'
  | 'qwen'
  | 'moonshot'
  | 'zai'
  | 'minimax'
  | 'cerebras'
  | 'deepinfra'
  | 'github-models'
  | 'lmstudio'
  | 'llamacpp'
  | 'vllm'
  | 'azure-openai'

export type ModelCategory = 'general' | 'coding' | 'reasoning' | 'vision' | 'tools' | 'long-context'

export type AgentMode = 'ask' | 'plan' | 'code' | 'agent' | 'review' | 'debug'

export type PermissionMode =
  'read-only' | 'workspace-write' | 'terminal-approval' | 'elevated' | 'unrestricted'

export type ToolRisk = 'read' | 'write' | 'exec' | 'network' | 'destructive'

export type TaskState =
  | 'idle'
  | 'queued'
  | 'planning'
  | 'running'
  | 'waiting_tool'
  | 'waiting_approval'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type StepState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type MessageStatus = 'streaming' | 'complete' | 'error' | 'cancelled'

export type ToolCallStatus =
  'pending' | 'awaiting_approval' | 'running' | 'success' | 'error' | 'denied' | 'cancelled'

export type FileChangeType = 'create' | 'modify' | 'delete' | 'rename'
export type FileChangeStatus = 'proposed' | 'accepted' | 'rejected' | 'reverted'

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  durationMs?: number
  estimatedCostUsd?: number
  source: 'provider' | 'estimated'
}

export interface ToolCallPart {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ProviderConfig {
  id: Id
  kind: ProviderKind
  name: string
  baseUrl?: string
  hasApiKey: boolean
  apiKeyHint?: string
  enabled: boolean
  supportsTools: boolean
  supportsVision: boolean
  createdAt: number
  updatedAt: number
}

export type ModelReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high'

export interface ModelConfig {
  id: Id
  providerId: Id
  modelId: string
  displayName: string
  contextWindow: number
  maxOutputTokens: number
  temperature: number
  categories: ModelCategory[]
  supportsTools: boolean
  supportsVision: boolean
  supportsReasoning: boolean
  reasoningEffort: ModelReasoningEffort
  variant: string
  isDefault: boolean
}

export interface Project {
  id: Id
  name: string
  path: string
  description?: string
  gitRemote?: string
  defaultBranch?: string
  lastOpenedAt?: number
  createdAt: number
  updatedAt: number
}

export interface Workspace {
  id: Id
  projectId: Id
  name: string
  rootPath: string
  createdAt: number
}

export interface Session {
  id: Id
  projectId?: Id
  workspaceId?: Id
  title: string
  mode: AgentMode
  providerId?: Id
  modelId?: string
  /** Nhãn hàng model trong Model Manager (không phải biến thể suy luận). */
  modelVariant?: string
  /** Biến thể suy luận đã xác minh cho model này: `off` | `medium` | `budget:8192` … */
  permissionMode: PermissionMode
  archived: boolean
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: Id
  sessionId: Id
  role: MessageRole
  content: string
  reasoning?: string
  toolCalls?: ToolCallPart[]
  toolCallId?: string
  model?: string
  providerId?: Id
  usage?: Usage
  status: MessageStatus
  error?: NexusErrorPayload
  createdAt: number
}

export interface PlanStep {
  id: string
  title: string
  description?: string
  state: StepState
}

export interface TaskPlan {
  title: string
  steps: PlanStep[]
  notes?: string
}

export interface NexusErrorPayload {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface Task {
  id: Id
  sessionId: Id
  projectId?: Id
  title: string
  prompt: string
  mode: AgentMode
  state: TaskState
  plan?: TaskPlan
  summary?: string
  error?: NexusErrorPayload
  providerId?: Id
  modelId?: string
  permissionMode: PermissionMode
  startedAt?: number
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export interface TaskStep {
  id: Id
  taskId: Id
  index: number
  title: string
  description?: string
  state: StepState
  result?: string
  startedAt?: number
  completedAt?: number
}

export interface ToolCallRecord {
  id: Id
  taskId?: Id
  sessionId: Id
  toolName: string
  input: Record<string, unknown>
  output?: unknown
  status: ToolCallStatus
  approval: 'none' | 'approved' | 'rejected'
  error?: NexusErrorPayload
  durationMs?: number
  createdAt: number
}

export interface FileChange {
  id: Id
  taskId?: Id
  sessionId: Id
  projectId?: Id
  path: string
  changeType: FileChangeType
  beforeContent?: string
  afterContent?: string
  addedLines: number
  removedLines: number
  status: FileChangeStatus
  createdAt: number
}

export interface GitFileStatus {
  path: string
  index: string
  worktree: string
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'ignored'
  staged: boolean
}

export interface GitStatus {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  files: GitFileStatus[]
  clean: boolean
  isRepo: boolean
}

export interface UsageRecord {
  id: Id
  providerId?: Id
  modelId?: string
  sessionId?: Id
  taskId?: Id
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  durationMs?: number
  estimatedCostUsd?: number
  source: 'provider' | 'estimated'
  createdAt: number
}

export interface ContextUsage {
  taskId: Id
  sessionId: Id
  providerId?: Id
  modelId?: string
  contextWindow: number
  maxOutputTokens: number
  systemTokens: number
  toolsTokens: number
  messagesTokens: number
  toolResultTokens: number
  totalTokens: number
  percent: number
  messageCount: number
  toolCount: number
  taskTokensUsed: number
  maxTokensPerTask: number
  autoCompactTokens: number
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform | string
  arch: string
  userDataPath: string
  databasePath: string
  encryptionAvailable: boolean
  isDev: boolean
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  language?: string
  children?: FileNode[]
  truncated?: boolean
}

export interface SearchResult {
  path: string
  line?: number
  column?: number
  preview?: string
  score?: number
}

export interface TerminalInfo {
  id: string
  title: string
  cwd: string
  shell: string
  pid: number
  cols: number
  rows: number
}

export interface AgentRoleConfig {
  role: 'planner' | 'researcher' | 'coder' | 'debugger' | 'reviewer' | 'tester' | 'librarian'
  enabled: boolean
  model?: string
  description?: string
}

export interface ApprovalRequest {
  id: string
  taskId: string
  toolName: string
  risk: ToolRisk
  summary: string
  input: Record<string, unknown>
  reason: string
  command?: string
  cwd?: string
}
