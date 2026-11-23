import { runProcess } from '../util.ts'
import type { EnvironmentSnapshot, Platform, ToolAvailability, ToolMetadata } from './types.ts'

const EXECUTABLE = /^[a-zA-Z0-9_.+-]+$/
const firstLine = (value: string): string => {
  const line = value.split(/\r?\n/).find((entry) => entry.trim() !== '') ?? ''
  return line.slice(0, 200)
}

/** Phát hiện OS/arch/PATH và phiên bản tool bằng lệnh thật, có cache ngắn hạn. */
export class EnvironmentManager {
  private cache: EnvironmentSnapshot | null = null
  private readonly cacheMs: number

  constructor(cacheMs = 30_000) {
    this.cacheMs = cacheMs
  }

  async snapshot(toolIds: string[], force = false): Promise<EnvironmentSnapshot> {
    if (
      !force &&
      this.cache !== null &&
      Date.now() - this.cache.detectedAt < this.cacheMs &&
      toolIds.every((id) => Object.prototype.hasOwnProperty.call(this.cache?.tools ?? {}, id))
    ) {
      return this.cache
    }
    const platform = (
      process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
    ) as Platform
    const tools: Record<string, ToolAvailability> = { ...(this.cache?.tools ?? {}) }
    for (const id of [...new Set(toolIds)]) {
      if (!EXECUTABLE.test(id)) continue
      tools[id] = await this.probe(id, platform)
    }
    const snapshot: EnvironmentSnapshot = {
      platform,
      arch: process.arch,
      nodeVersion: process.version,
      shell: process.env['SHELL'] ?? '',
      pathEntries: (process.env['PATH'] ?? '').split(':').filter((entry) => entry !== ''),
      tools,
      detectedAt: Date.now(),
    }
    this.cache = snapshot
    return snapshot
  }

  private async probe(executable: string, platform: Platform): Promise<ToolAvailability> {
    const checkedAt = Date.now()
    if (platform === 'win32') {
      return { available: false, version: null, path: null, checkedAt }
    }
    const located = await runProcess(['/bin/sh', '-c', `command -v ${executable}`], '', 3000)
    if (located.code !== 0 || located.out.trim() === '') {
      return { available: false, version: null, path: null, checkedAt }
    }
    const path = firstLine(located.out)
    const versionRun = await runProcess([executable, '--version'], '', 4000)
    const version = versionRun.code === 0 ? firstLine(`${versionRun.out}${versionRun.err}`) : null
    return { available: true, version, path, checkedAt }
  }

  /** Gắn availability/version/path thật vào metadata của tool. */
  decorate(tools: ToolMetadata[], snapshot: EnvironmentSnapshot): ToolMetadata[] {
    return tools.map((tool) => {
      const availability = snapshot.tools[tool.executable] ?? null
      const supported = tool.supportedPlatforms.includes(snapshot.platform)
      return {
        ...tool,
        availability: !supported
          ? 'missing'
          : availability?.available === true
            ? 'available'
            : 'missing',
        version: availability?.version ?? null,
      }
    })
  }
}
