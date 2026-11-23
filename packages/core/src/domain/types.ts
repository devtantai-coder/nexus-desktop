/** Kiểu dữ liệu dùng chung cho Domain Engine. Không import Core để tránh vòng lặp. */

export type Json = any
export type Platform = 'linux' | 'darwin' | 'win32'
export type Availability = 'available' | 'missing' | 'unknown'

export interface ToolAvailability {
  available: boolean
  version: string | null
  path: string | null
  checkedAt: number
}

export interface ToolMetadata {
  id: string
  name: string
  domain: string
  description: string
  executable: string
  version: string | null
  supportedPlatforms: Platform[]
  dependencies: string[]
  installationGuide: string
  capabilities: string[]
  availability: Availability
  permissions: string[]
  healthCheck: string | null
  installCommand: string | null
  rollbackCommand: string | null
  requiresRoot: boolean
}

export interface EnvironmentSnapshot {
  platform: Platform
  arch: string
  nodeVersion: string
  shell: string
  pathEntries: string[]
  tools: Record<string, ToolAvailability>
  detectedAt: number
}

export interface DomainMatch {
  domainId: string
  confidence: number
  reasons: string[]
}

export interface DomainContext {
  workspaceRoot: string | null
  environment: EnvironmentSnapshot
  settings: Record<string, unknown>
}

export interface DependencyItem {
  toolId: string
  name: string
  domain: string
  available: boolean
  version: string | null
  installCommand: string | null
  requiresRoot: boolean
  source: string
  risk: string
  healthCheck: string | null
}

export interface DependencyPlan {
  domainId: string
  platform: Platform
  items: DependencyItem[]
  missing: string[]
  unsupported: string[]
  createdAt: number
}

export interface InstallResult {
  ok: boolean
  toolId: string
  reason?: string
  command?: string
  manualCommand?: string
  exitCode?: number
  output?: string
  verified: boolean
  rollbackCommand: string | null
  eventId?: string
}

export interface ProjectInput {
  name?: string
  root?: string
}

export interface ProjectResult {
  ok: boolean
  path: string
  files: string[]
  error?: string
}

export interface CommandResult {
  ok: boolean
  command: string
  exitCode: number
  output: string
  durationMs: number
  timedOut: boolean
}

export interface BuildResult extends CommandResult {
  artifacts: string[]
  reason?: string
}

export interface TestResult extends CommandResult {
  passed: number
  failed: number
  reason?: string
}

export interface SimulationResult {
  ok: boolean
  simulator: string
  reason?: string
  output?: string
  logPath?: string
}

export interface DebugResult {
  ok: boolean
  adapter: string
  reason?: string
  output?: string
}

export interface DomainReport {
  domainId: string
  generatedAt: number
  tools: ToolMetadata[]
  capabilities: string[]
  notes: string[]
}

/**
 * Mỗi domain là một module độc lập. Các phương thức không hỗ trợ phải trả ok:false
 * kèm reason — không được trả kết quả giả vờ thành công.
 */
export interface DomainModule {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly platforms: Platform[]
  readonly tools: ToolMetadata[]
  detect(context: DomainContext): DomainMatch[]
  plan(context: DomainContext): DependencyPlan
  createProject(context: DomainContext, input: ProjectInput): ProjectResult
  build(context: DomainContext, input: { path: string; profile?: string }): Promise<BuildResult>
  test(context: DomainContext, input: { path: string }): Promise<TestResult>
  simulate?(context: DomainContext, input: Json): SimulationResult
  debug?(context: DomainContext, input: Json): DebugResult
  report(context: DomainContext): DomainReport
}

export interface DomainSummary {
  id: string
  label: string
  description: string
  platforms: Platform[]
  toolCount: number
  capabilities: string[]
}
