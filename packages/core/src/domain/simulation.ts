import type { DomainContext, DomainModule, Json, SimulationResult } from './types.ts'

/** Simulator luôn capability-aware: thiếu adapter hoặc executable thì trả reason, không giả kết quả. */
export class SimulationManager {
  async run(domain: DomainModule, context: DomainContext, input: Json): Promise<SimulationResult> {
    if (domain.simulate === undefined) {
      return { ok: false, simulator: 'none', reason: `${domain.id} has no simulation adapter` }
    }
    if (!domain.platforms.includes(context.environment.platform)) {
      return {
        ok: false,
        simulator: 'none',
        reason: `Platform ${context.environment.platform} unsupported`,
      }
    }
    return domain.simulate(context, input)
  }
}
