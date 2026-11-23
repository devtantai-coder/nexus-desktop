import type { DomainModule, DomainSummary } from './types.ts'

const DOMAIN_ID = /^[a-z][a-z0-9-]*$/

/** Đăng ký domain theo id duy nhất; module cũ không bị xoá hay ghi đè. */
export class DomainRegistry {
  private readonly domains = new Map<string, DomainModule>()

  register(domain: DomainModule): void {
    if (!DOMAIN_ID.test(domain.id)) throw new Error(`Invalid domain id: ${domain.id}`)
    if (this.domains.has(domain.id)) throw new Error(`Domain already registered: ${domain.id}`)
    this.domains.set(domain.id, domain)
  }

  get(id: string): DomainModule | null {
    return this.domains.get(id) ?? null
  }

  has(id: string): boolean {
    return this.domains.has(id)
  }

  list(): DomainModule[] {
    return [...this.domains.values()]
  }

  summaries(): DomainSummary[] {
    return this.list().map((domain) => ({
      id: domain.id,
      label: domain.label,
      description: domain.description,
      platforms: domain.platforms,
      toolCount: domain.tools.length,
      capabilities: domain.tools
        .flatMap((tool) => tool.capabilities)
        .filter((value, index, all) => all.indexOf(value) === index),
    }))
  }
}

export function standardDomains(...domains: DomainModule[]): DomainRegistry {
  const registry = new DomainRegistry()
  for (const domain of domains) registry.register(domain)
  return registry
}
