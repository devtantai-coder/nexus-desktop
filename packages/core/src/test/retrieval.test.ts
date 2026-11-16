import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { EventBus } from '../events.ts'
import { Providers } from '../providers.ts'
import { RetrievalService } from '../retrieval.ts'
import { SecretStore } from '../secrets.ts'
import { Store } from '../store.ts'
import { Workspace } from '../workspace.ts'

const vectorFor = (text: string): number[] => {
  if (text.includes('alpha')) return [1, 0, 0]
  if (text.includes('beta')) return [0, 1, 0]
  return [0, 0, 1]
}

describe('RetrievalService', () => {
  let dir = ''
  let store: Store
  let server: Server
  let baseUrl = ''
  let providerId = ''
  let modelId = ''
  const workspace = (): Workspace => new Workspace(join(dir, 'project'))

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-retrieval-test-'))
    const projectDir = join(dir, 'project')
    writeFileSync(join(dir, 'note.txt'), 'ignored')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'alpha.ts'), 'export const alpha = 1\n')
    writeFileSync(join(projectDir, 'beta.ts'), 'export const beta = 2\n')
    store = new Store(join(dir, 'test.db'))
    store.migrate()
    store.seedDefaults()
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        let input: string[]
        try {
          const parsed = JSON.parse(body) as { input?: string[] }
          input = Array.isArray(parsed.input) ? parsed.input : []
        } catch {
          input = []
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            object: 'list',
            data: input.map((text, index) => ({ index, embedding: vectorFor(text) })),
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    baseUrl = `http://127.0.0.1:${address.port}/v1`
    const provider = store.providerSave({
      kind: 'openai-compatible',
      name: 'embed-test',
      baseUrl,
      enabled: true,
    })
    providerId = String(provider['id'])
    const model = store.modelSave({
      providerId,
      modelId: 'embed-model',
      displayName: 'Embed',
      supportsTools: false,
    })
    modelId = String(model['id'])
    store.settingSet('retrieval.providerId', providerId)
    store.settingSet('retrieval.modelId', modelId)
  })

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('indexes files and returns the closest chunk', async () => {
    const providers = new Providers(store, new SecretStore(dir), new EventBus())
    const retrieval = new RetrievalService(store, new EventBus(), providers)
    const result = await retrieval.index('project-1', workspace())
    assert.ok(result.chunks > 0)
    assert.equal(retrieval.stats('project-1')['chunks'], result.chunks)
    const hits = await retrieval.search('project-1', 'alpha', 5)
    assert.ok(hits.length > 0)
    assert.equal(hits[0]?.path, 'alpha.ts')
    assert.ok((hits[0]?.score ?? 0) > 0.99)
  })
})