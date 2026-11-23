import type {
  BuildResult,
  DebugResult,
  DependencyPlan,
  DomainContext,
  DomainMatch,
  DomainModule,
  DomainReport,
  DomainSummary,
  Platform,
  ProjectInput,
  ProjectResult,
  SimulationResult,
  TestResult,
  ToolMetadata,
} from '../domain/types.ts'
import { deriveRollbackCommand } from '../domain/rollback.ts'

export function defineTool(
  id: string,
  name: string,
  domain: string,
  executable: string,
  capabilities: string[],
  options: Partial<ToolMetadata> = {},
): ToolMetadata {
  const installCommand = options.installCommand ?? null
  return {
    id,
    name,
    domain,
    description: options.description ?? `${name} tool for ${domain} development`,
    executable,
    version: null,
    supportedPlatforms: options.supportedPlatforms ?? ['linux', 'darwin', 'win32'],
    dependencies: options.dependencies ?? [],
    installationGuide: options.installationGuide ?? 'Install from the official package source',
    capabilities,
    availability: 'unknown',
    permissions: options.permissions ?? ['exec'],
    healthCheck: options.healthCheck ?? `${executable} --version`,
    installCommand,
    rollbackCommand: options.rollbackCommand ?? deriveRollbackCommand(installCommand),
    requiresRoot: options.requiresRoot ?? false,
  }
}

const unsupported = (reason: string) =>
  ({ ok: false, reason, path: '', files: [] }) as ProjectResult

/** Mặc định an toàn: không hỗ trợ thì trả ok:false, không trả kết quả giả. */
export abstract class BaseDomainAdapter implements DomainModule {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly description: string
  abstract readonly platforms: Platform[]
  abstract readonly tools: ToolMetadata[]

  detect(_context: DomainContext): DomainMatch[] {
    return []
  }

  plan(context: DomainContext): DependencyPlan {
    const items = this.tools.map((tool) => ({
      toolId: tool.id,
      name: tool.name,
      domain: tool.domain,
      available: context.environment.tools[tool.executable]?.available === true,
      version: context.environment.tools[tool.executable]?.version ?? null,
      installCommand: tool.installCommand,
      requiresRoot: tool.requiresRoot,
      source: tool.installationGuide,
      risk: tool.permissions.includes('network') ? 'network' : 'exec',
      healthCheck: tool.healthCheck,
    }))
    return {
      domainId: this.id,
      platform: context.environment.platform,
      items,
      missing: items.filter((item) => !item.available).map((item) => item.toolId),
      unsupported: this.tools
        .filter((tool) => !tool.supportedPlatforms.includes(context.environment.platform))
        .map((tool) => tool.id),
      createdAt: Date.now(),
    }
  }

  createProject(_context: DomainContext, _input: ProjectInput): ProjectResult {
    return unsupported(`${this.id} has no project generator`)
  }

  build(_context: DomainContext, _input: { path: string; profile?: string }): Promise<BuildResult> {
    return Promise.resolve({
      ok: false,
      command: '',
      exitCode: -1,
      output: '',
      durationMs: 0,
      timedOut: false,
      artifacts: [],
      reason: `${this.id} has no build adapter`,
    })
  }

  test(_context: DomainContext, _input: { path: string }): Promise<TestResult> {
    return Promise.resolve({
      ok: false,
      command: '',
      exitCode: -1,
      output: '',
      durationMs: 0,
      timedOut: false,
      passed: 0,
      failed: 0,
      reason: `${this.id} has no test adapter`,
    })
  }

  simulate(_context: DomainContext, _input: unknown): SimulationResult {
    return { ok: false, simulator: 'none', reason: `${this.id} has no simulation adapter` }
  }

  debug(_context: DomainContext, _input: unknown): DebugResult {
    return { ok: false, adapter: 'none', reason: `${this.id} has no debug adapter` }
  }

  report(_context: DomainContext): DomainReport {
    return {
      domainId: this.id,
      generatedAt: Date.now(),
      tools: this.tools.map((tool) => ({ ...tool })),
      capabilities: [...new Set(this.tools.flatMap((tool) => tool.capabilities))],
      notes: [],
    }
  }

  summary(): DomainSummary {
    return {
      id: this.id,
      label: this.label,
      description: this.description,
      platforms: this.platforms,
      toolCount: this.tools.length,
      capabilities: [...new Set(this.tools.flatMap((tool) => tool.capabilities))],
    }
  }
}
