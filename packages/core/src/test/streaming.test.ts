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

const sse = (body: string): string =>
  [
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: { content: body }, finish_reason: null }],
    })}`,
    '',
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    })}`,
    '',
    'data: [DONE]',
    '',
    '',
  ].join('\n')

const toolCallSse = (): string =>
  [
    `data: ${JSON.stringify({
      id: 'chatcmpl-tool',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}`,
    '',
    `data: ${JSON.stringify({
      id: 'chatcmpl-tool',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    })}`,
    '',
    'data: [DONE]',
    '',
    '',
  ].join('\n')

describe('Providers streaming', () => {
  let tempDir = ''
  let store: Store
  let server: Server
  let baseUrl = ''
  let requests = 0
  let failFirst = false
  let toolCall = false

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'nexus-stream-test-'))
    store = new Store(join(tempDir, 'test.db'))
    store.migrate()
    store.seedDefaults()
    server = createServer((req, res) => {
      requests += 1
      req.on('data', () => undefined)
      req.on('end', () => {
        if (failFirst && requests === 1) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('upstream failed')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        res.end(toolCall ? toolCallSse() : sse('Hi from stream'))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    baseUrl = `http://127.0.0.1:${address.port}/v1`
  })

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const provider = (): Record<string, unknown> =>
    store.providerSave({
      kind: 'openai-compatible',
      name: 'stream-test',
      baseUrl,
      enabled: true,
    })

  it('streams text through the Vercel AI SDK', async () => {
    failFirst = false
    toolCall = false
    const events = new EventBus()
    const providers = new Providers(store, new SecretStore(tempDir), events)
    const deltas: string[] = []
    const result = await providers.chat(
      provider(),
      { modelId: 'test-model', temperature: 0.2, maxOutputTokens: 128 },
      [{ role: 'user', content: 'hello' }],
      [],
      false,
      (text) => {
        if (text !== '') deltas.push(text)
      },
    )
    assert.equal(result.text, 'Hi from stream')
    assert.equal(result.finish_reason, 'stop')
    assert.equal(result.usage.input_tokens, 5)
    assert.equal(result.usage.output_tokens, 2)
    assert.equal(deltas.join(''), 'Hi from stream')
  })

  it('streams tool calls through the Vercel AI SDK', async () => {
    failFirst = false
    toolCall = true
    const events = new EventBus()
    const providers = new Providers(store, new SecretStore(tempDir), events)
    const result = await providers.chat(
      provider(),
      { modelId: 'test-model', temperature: 0.2, maxOutputTokens: 128 },
      [{ role: 'user', content: 'read a.txt' }],
      [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
      false,
    )
    assert.equal(result.tool_calls.length, 1)
    assert.equal(result.tool_calls[0]?.['name'], 'read_file')
    assert.deepEqual(result.tool_calls[0]?.['arguments'], { path: 'a.txt' })
  })

  it('falls back to the legacy adapter when the SDK fails before streaming', async () => {
    requests = 0
    failFirst = true
    toolCall = false
    const events = new EventBus()
    const providers = new Providers(store, new SecretStore(tempDir), events)
    const result = await providers.chat(
      provider(),
      { modelId: 'test-model', temperature: 0.2, maxOutputTokens: 128 },
      [{ role: 'user', content: 'hello' }],
      [],
      false,
    )
    assert.equal(result.text, 'Hi from stream')
    assert.equal(requests, 2)
  })
})