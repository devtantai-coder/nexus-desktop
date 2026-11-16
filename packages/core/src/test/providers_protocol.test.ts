import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { EventBus } from '../events.ts'
import { Providers } from '../providers.ts'
import { SecretStore } from '../secrets.ts'
import { Store } from '../store.ts'

const sse = (events: unknown[]): string =>
  `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`

const anthropicBody = (): string =>
  sse([
    {
      type: 'message_start',
      message: { usage: { input_tokens: 5, cache_read_input_tokens: 1 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  ])

const geminiBody = (): string =>
  sse([
    {
      candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    },
  ])

const ollamaBody = (): string =>
  [
    JSON.stringify({ message: { role: 'assistant', content: 'Hi' }, done: false }),
    JSON.stringify({
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 5,
      eval_count: 2,
    }),
    '',
  ].join('\n')

describe('Provider protocol adapters', () => {
  let dir = ''
  let store: Store
  let server: Server
  let baseUrl = ''

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-protocol-test-'))
    store = new Store(join(dir, 'test.db'))
    store.migrate()
    store.seedDefaults()
    server = createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': req.url?.includes('/api/chat')
            ? 'application/x-ndjson'
            : 'text/event-stream',
          'Cache-Control': 'no-cache',
        })
        if (req.url?.includes('/api/chat')) res.end(ollamaBody())
        else if (req.url?.includes(':streamGenerateContent')) res.end(geminiBody())
        else res.end(anthropicBody())
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const providers = (): Providers =>
    new Providers(store, new SecretStore(dir), new EventBus())

  const withKey = (kind: string): string => {
    const provider = store.providerSave({
      kind,
      name: `${kind}-test`,
      baseUrl: kind === 'google' ? `${baseUrl}/v1beta` : `${baseUrl}/v1`,
      enabled: true,
    })
    const id = String(provider['id'])
    store.providerSetKey(id, new SecretStore(dir).encrypt('test-key'), 'test-key')
    return id
  }

  const model = (providerId: string): Record<string, unknown> =>
    store.modelSave({
      providerId,
      modelId: 'test-model',
      displayName: 'Test',
      supportsTools: false,
    })

  it('streams Anthropic messages', async () => {
    const id = withKey('anthropic')
    const result = await providers().chat(
      store.providerGet(id),
      model(id),
      [{ role: 'user', content: 'hello' }],
      [],
      false,
    )
    assert.equal(result.text, 'Hi')
    assert.equal(result.finish_reason, 'end_turn')
    assert.equal(result.usage.input_tokens, 5)
    assert.equal(result.usage.output_tokens, 2)
    assert.equal(result.usage.cached_tokens, 1)
  })

  it('streams Gemini content', async () => {
    const id = withKey('google')
    const result = await providers().chat(
      store.providerGet(id),
      model(id),
      [{ role: 'user', content: 'hello' }],
      [],
      false,
    )
    assert.equal(result.text, 'Hi')
    assert.equal(result.finish_reason, 'STOP')
    assert.equal(result.usage.input_tokens, 5)
    assert.equal(result.usage.output_tokens, 2)
  })

  it('streams Ollama NDJSON', async () => {
    const provider = store.providerSave({
      kind: 'ollama',
      name: 'ollama-test',
      baseUrl,
      enabled: true,
    })
    const id = String(provider['id'])
    const result = await providers().chat(
      store.providerGet(id),
      model(id),
      [{ role: 'user', content: 'hello' }],
      [],
      false,
    )
    assert.equal(result.text, 'Hi')
    assert.equal(result.finish_reason, 'stop')
    assert.equal(result.usage.input_tokens, 5)
    assert.equal(result.usage.output_tokens, 2)
  })
})