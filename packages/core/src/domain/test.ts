import { existsSync } from 'node:fs'

import { countTests } from './runner.ts'
import type { DomainContext, DomainModule, TestResult } from './types.ts'

export class TestManager {
  async run(
    domain: DomainModule,
    context: DomainContext,
    input: { path: string },
  ): Promise<TestResult> {
    if (!domain.platforms.includes(context.environment.platform)) {
      return {
        ok: false,
        command: '',
        exitCode: -1,
        output: '',
        durationMs: 0,
        timedOut: false,
        passed: 0,
        failed: 0,
        reason: `Platform ${context.environment.platform} is not supported by ${domain.id}`,
      }
    }
    if (!existsSync(input.path)) {
      return {
        ok: false,
        command: '',
        exitCode: -1,
        output: '',
        durationMs: 0,
        timedOut: false,
        passed: 0,
        failed: 0,
        reason: `Project path does not exist: ${input.path}`,
      }
    }
    const result = await domain.test(context, input)
    const counts = countTests(result.output)
    return {
      ...result,
      passed: counts.passed || (result.ok ? 1 : 0),
      failed: counts.failed || (result.ok ? 0 : 1),
    }
  }
}
