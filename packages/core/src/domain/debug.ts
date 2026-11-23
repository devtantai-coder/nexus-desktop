import type { DebugResult, DomainContext, DomainModule, Json } from './types.ts'

/** Chỉ gọi adapter debug khi domain khai báo; không tự ý điều khiển phần cứng thật. */
export class DebugManager {
  async run(domain: DomainModule, context: DomainContext, input: Json): Promise<DebugResult> {
    if (domain.debug === undefined) {
      return { ok: false, adapter: 'none', reason: `${domain.id} has no debug adapter` }
    }
    if (!domain.platforms.includes(context.environment.platform)) {
      return {
        ok: false,
        adapter: 'none',
        reason: `Platform ${context.environment.platform} unsupported`,
      }
    }
    return domain.debug(context, input)
  }
}
