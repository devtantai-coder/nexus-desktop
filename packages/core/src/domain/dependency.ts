import type { Store } from '../store.ts'
import { runCommand } from './runner.ts'
import { deriveRollbackCommand } from './rollback.ts'
import type {
  DependencyItem,
  DependencyPlan,
  DomainContext,
  DomainModule,
  InstallResult,
  Platform,
} from './types.ts'
import type { EnvironmentManager } from './environment.ts'

/** Detect → plan → approve → install → verify → log. Không bulk install. */
export class DependencyManager {
  private readonly store: Store
  private readonly environment: EnvironmentManager

  constructor(store: Store, environment: EnvironmentManager) {
    this.store = store
    this.environment = environment
  }

  plan(domain: DomainModule, context: DomainContext): DependencyPlan {
    const items: DependencyItem[] = domain.tools.map((tool) => ({
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
      domainId: domain.id,
      platform: context.environment.platform as Platform,
      items,
      missing: items.filter((item) => !item.available).map((item) => item.toolId),
      unsupported: domain.tools
        .filter((tool) => !tool.supportedPlatforms.includes(context.environment.platform))
        .map((tool) => tool.id),
      createdAt: Date.now(),
    }
  }

  async install(
    domain: DomainModule,
    toolIds: string[],
    approved: boolean,
    context: DomainContext,
  ): Promise<InstallResult[]> {
    const results: InstallResult[] = []
    for (const id of toolIds) {
      const tool = domain.tools.find((entry) => entry.id === id)
      if (tool === undefined) {
        results.push({
          ok: false,
          toolId: id,
          reason: 'Tool does not belong to this domain',
          verified: false,
          rollbackCommand: null,
        })
        continue
      }
      if (context.environment.tools[tool.executable]?.available === true) {
        results.push({
          ok: true,
          toolId: id,
          reason: 'already-installed',
          verified: true,
          rollbackCommand: null,
        })
        continue
      }
      if (!approved) {
        results.push({
          ok: false,
          toolId: id,
          reason: 'requires-approval',
          verified: false,
          rollbackCommand: null,
        })
        continue
      }
      if (!tool.supportedPlatforms.includes(context.environment.platform)) {
        results.push({
          ok: false,
          toolId: id,
          reason: 'unsupported-platform',
          verified: false,
          rollbackCommand: null,
        })
        continue
      }
      if (tool.installCommand === null) {
        results.push({
          ok: false,
          toolId: id,
          reason: 'no-install-command',
          verified: false,
          rollbackCommand: null,
        })
        continue
      }
      if (tool.requiresRoot) {
        const manualRollback = tool.rollbackCommand ?? deriveRollbackCommand(tool.installCommand)
        const event = this.store.dependencyEventAdd({
          domainId: domain.id,
          toolId: id,
          action: 'manual-required',
          ok: false,
          detail: {
            command: tool.installCommand,
            reason: 'requires-root',
            rollbackCommand: manualRollback,
          },
        })
        results.push({
          ok: false,
          toolId: id,
          reason: 'requires-root',
          verified: false,
          manualCommand: tool.installCommand,
          rollbackCommand: null,
          eventId: String(event['id']),
        })
        continue
      }
      const run = await runCommand(tool.installCommand, '', 840_000)
      const refreshed = await this.environment.snapshot([tool.executable], true)
      const verified = refreshed.tools[tool.executable]?.available === true
      const rollbackCommand = tool.rollbackCommand ?? deriveRollbackCommand(tool.installCommand)
      let reason: string | undefined
      let rolledBack = false
      let rollbackOk: boolean | null = null
      if (!verified && rollbackCommand !== null) {
        const rollback = await runCommand(rollbackCommand, '', 300_000)
        rolledBack = true
        rollbackOk = rollback.ok
        this.store.dependencyEventAdd({
          domainId: domain.id,
          toolId: id,
          action: 'rollback',
          ok: rollback.ok,
          command: rollbackCommand,
          exitCode: rollback.exitCode,
          detail: { trigger: 'verify-failed', output: rollback.output.slice(0, 4000) },
        })
        reason = rollback.ok ? 'verify-failed-rolled-back' : 'verify-failed-rollback-failed'
      } else if (!verified) {
        reason = 'verify-failed-rollback-unavailable'
      }
      const event = this.store.dependencyEventAdd({
        domainId: domain.id,
        toolId: id,
        action: 'install',
        ok: run.ok && verified,
        command: tool.installCommand,
        exitCode: run.exitCode,
        detail: {
          verified,
          rolledBack,
          rollbackOk,
          rollbackCommand,
          output: run.output.slice(0, 4000),
        },
      })
      results.push({
        ok: run.ok && verified,
        toolId: id,
        command: tool.installCommand,
        exitCode: run.exitCode,
        output: run.output.slice(0, 4000),
        ...(reason !== undefined ? { reason } : {}),
        verified,
        rollbackCommand,
        eventId: String(event['id']),
      })
    }
    return results
  }
}
