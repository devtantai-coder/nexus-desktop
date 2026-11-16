import { NexusError } from './errors.ts'
import type { EventBus } from './events.ts'
import type { Providers } from './providers.ts'
import type { Store } from './store.ts'
import type { Json } from './tools.ts'
import { uuid } from './util.ts'
import type { Workspace } from './workspace.ts'

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyi',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.scala',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.vue',
  '.svelte',
  '.json',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.toml',
  '.html',
  '.css',
  '.scss',
  '.less',
])

const CHUNK_LINES = 40
const CHUNK_OVERLAP = 10
const MAX_FILE_BYTES = 512 * 1024
const MAX_CHUNKS = 6000
const EMBED_BATCH = 32

export interface RetrievalHit {
  path: string
  startLine: number
  endLine: number
  content: string
  score: number
}

const isTextPath = (path: string): boolean => {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

const chunkText = (
  path: string,
  content: string,
): Array<{ path: string; startLine: number; endLine: number; content: string }> => {
  if (content.length > MAX_FILE_BYTES) return []
  const lines = content.split('\n')
  const chunks: Array<{
    path: string
    startLine: number
    endLine: number
    content: string
  }> = []
  const step = Math.max(1, CHUNK_LINES - CHUNK_OVERLAP)
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + CHUNK_LINES)
    const text = lines.slice(start, end).join('\n').trim()
    if (text !== '') {
      chunks.push({ path, startLine: start + 1, endLine: end, content: text })
    }
    if (end >= lines.length) break
  }
  return chunks
}

const cosine = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export class RetrievalService {
  private readonly store: Store
  private readonly events: EventBus
  private readonly providers: Providers

  constructor(store: Store, events: EventBus, providers: Providers) {
    this.store = store
    this.events = events
    this.providers = providers
  }

  private config(): { provider: Json; model: Json } {
    const providerSetting = this.store.settingGet('retrieval.providerId', '')
    const modelSetting = this.store.settingGet('retrieval.modelId', '')
    const providerId = typeof providerSetting === 'string' ? providerSetting.trim() : ''
    const modelId = typeof modelSetting === 'string' ? modelSetting.trim() : ''
    if (providerId === '' || modelId === '') {
      throw new NexusError(
        'E_CONFIG',
        'Set retrieval.providerId and retrieval.modelId to an embedding-capable model first.',
      )
    }
    return {
      provider: this.store.providerGet(providerId),
      model: this.store.modelGet(modelId),
    }
  }

  async index(
    projectId: string,
    workspace: Workspace,
    options: { force?: boolean } = {},
  ): Promise<{ chunks: number; files: number }> {
    const { provider, model } = this.config()
    const existing = new Map<string, number>()
    for (const row of this.store.codeChunkPaths(projectId)) {
      existing.set(row.path, Number(row.mtime))
    }
    const seen = new Set<string>()
    const changed: Array<{
      path: string
      mtime: number
      chunks: Array<{ startLine: number; endLine: number; content: string }>
    }> = []
    for (const path of workspace.listFilePaths(12000)) {
      if (!isTextPath(path)) continue
      seen.add(path)
      let mtime: number
      try {
        mtime = Math.trunc(Number((workspace.stat(path) as Json)?.['mtimeMs'] ?? 0))
      } catch {
        continue
      }
      if (!options.force && existing.get(path) === mtime) continue
      let content: string
      try {
        content = workspace.readFile(path).content
      } catch {
        continue
      }
      const chunks = chunkText(path, content)
      if (chunks.length === 0) continue
      changed.push({ path, mtime, chunks })
      if (changed.length >= MAX_CHUNKS) break
    }

    for (const path of existing.keys()) {
      if (seen.has(path)) continue
      this.store.codeChunksDelete(projectId, path)
    }

    const pending: Array<{
      path: string
      mtime: number
      startLine: number
      endLine: number
      content: string
    }> = []
    for (const file of changed) {
      this.store.codeChunksDelete(projectId, file.path)
      for (const chunk of file.chunks) {
        pending.push({
          path: file.path,
          mtime: file.mtime,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
        })
      }
    }

    let inserted = 0
    for (let offset = 0; offset < pending.length; offset += EMBED_BATCH) {
      const batch = pending.slice(offset, offset + EMBED_BATCH)
      const vectors = await this.providers.embed(
        provider,
        model,
        batch.map((chunk) => chunk.content),
      )
      for (let index = 0; index < batch.length; index += 1) {
        const vector = vectors[index]
        if (!Array.isArray(vector) || vector.length === 0) continue
        const chunk = batch[index]
        if (chunk === undefined) continue
        this.store.codeChunkInsert({
          id: uuid(),
          projectId,
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          mtime: chunk.mtime,
          embedding: JSON.stringify(vector),
        })
        inserted += 1
      }
    }
    this.events.emit('nexus/retrieval-indexed', { projectId, chunks: inserted })
    return { chunks: inserted, files: changed.length }
  }

  async search(projectId: string, query: string, limit = 8): Promise<RetrievalHit[]> {
    const text = query.trim()
    if (text === '') return []
    const { provider, model } = this.config()
    const [vector] = await this.providers.embed(provider, model, [text])
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new NexusError('E_PROVIDER', 'Embedding provider returned no vector')
    }
    const scored: RetrievalHit[] = []
    for (const row of this.store.codeChunks(projectId)) {
      let stored: number[] = []
      try {
        const parsed = JSON.parse(row.embedding)
        if (Array.isArray(parsed)) stored = parsed as number[]
      } catch {
        continue
      }
      const score = cosine(vector, stored)
      if (score <= 0) continue
      scored.push({
        path: row.path,
        startLine: row.startLine,
        endLine: row.endLine,
        content: row.content,
        score,
      })
    }
    scored.sort((left, right) => right.score - left.score)
    return scored.slice(0, Math.max(1, Math.min(20, Math.trunc(limit))))
  }

  stats(projectId: string): Json {
    return { chunks: this.store.codeChunkCount(projectId) }
  }
}