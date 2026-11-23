import type { DomainReport, Json } from './types.ts'

/** Lưu artifact/report theo session; không ghi đè file người dùng. */
export class ArtifactManager {
  private readonly reports = new Map<string, DomainReport>()
  private readonly artifacts = new Map<string, Array<{ path: string; createdAt: number }>>()

  putReport(key: string, report: DomainReport): void {
    this.reports.set(key, report)
  }

  report(key: string): DomainReport | null {
    return this.reports.get(key) ?? null
  }

  addArtifacts(key: string, paths: string[]): void {
    const list = this.artifacts.get(key) ?? []
    for (const path of paths) {
      if (!list.some((entry) => entry.path === path)) list.push({ path, createdAt: Date.now() })
    }
    this.artifacts.set(key, list)
  }

  listArtifacts(key: string): Json[] {
    return (this.artifacts.get(key) ?? []).map((entry) => ({ ...entry }))
  }
}
