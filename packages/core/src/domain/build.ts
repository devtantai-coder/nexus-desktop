import { existsSync } from 'node:fs'

import type { ArtifactManager } from './artifacts.ts'
import type { BuildResult, DomainContext, DomainModule, Platform } from './types.ts'

const unsupported = (command: string, reason: string): BuildResult => ({
  ok: false,
  command,
  exitCode: -1,
  output: '',
  durationMs: 0,
  timedOut: false,
  artifacts: [],
  reason,
})

export class BuildManager {
  private readonly artifacts: ArtifactManager

  constructor(artifacts: ArtifactManager) {
    this.artifacts = artifacts
  }

  async run(
    domain: DomainModule,
    context: DomainContext,
    input: { path: string; profile?: string },
  ): Promise<BuildResult> {
    if (!domain.platforms.includes(context.environment.platform as Platform)) {
      return unsupported(
        '',
        `Platform ${context.environment.platform} is not supported by ${domain.id}`,
      )
    }
    if (!existsSync(input.path))
      return unsupported('', `Project path does not exist: ${input.path}`)
    const result = await domain.build(context, input)
    this.artifacts.addArtifacts(`${domain.id}:${input.path}`, result.artifacts)
    return result
  }
}
