import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { EventBus } from '../events.ts'
import { CronManager, deliver, nextRunAt } from '../cron.ts'
import type { Store } from '../store.ts'
import type { Json } from '../tools.ts'

test('nextRunAt: cron 5 trường tính đúng khung giờ và ngày trong tuần', () => {
  const monday = new Date(2026, 0, 5, 8, 0, 0).getTime()
  const expected = new Date(2026, 0, 5, 9, 30, 0).getTime()
  assert.equal(nextRunAt('30 9 * * 1-5', monday), expected)
  // Chủ nhật → thứ Hai tuần sau, không phải thứ Hai cùng tuần đã qua.
  const sunday = new Date(2026, 0, 4, 23, 0, 0).getTime()
  assert.equal(nextRunAt('30 9 * * 1-5', sunday), new Date(2026, 0, 5, 9, 30, 0).getTime())
  // step: mỗi 15 phút
  const base = new Date(2026, 0, 5, 9, 2, 0).getTime()
  assert.equal(nextRunAt('*/15 9 * * *', base), new Date(2026, 0, 5, 9, 15, 0).getTime())
})

test('nextRunAt: từ chối lịch sai cấu trúc hoặc giá trị ngoài khoảng', () => {
  assert.throws(() => nextRunAt('* * * *'), /5 fields/)
  assert.throws(() => nextRunAt('60 * * * *'), /Invalid cron field/)
  assert.throws(() => nextRunAt('*/0 * * * *'), /Invalid cron step/)
  assert.throws(() => nextRunAt('5-3 * * * *'), /Invalid cron field/)
})

test('deliver: none không gửi, webhook/discord gửi JSON tới URL http(s)', async () => {
  assert.deepEqual(await deliver('none', '', 'hi'), { delivered: false, channel: 'none' })
  await assert.rejects(() => deliver('webhook', 'file:///etc/passwd', 'hi'), /http\(s\)/)

  const received: Array<{ body: string; content: string }> = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      received.push({ body, content: String(request.headers['content-type'] ?? '') })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = address !== null && typeof address === 'object' ? address.port : 0
  try {
    const webhook = await deliver('webhook', `http://127.0.0.1:${port}/hook`, 'nội dung tiếng Việt')
    assert.equal(webhook['delivered'], true)
    assert.equal(webhook['status'], 200)
    const discord = await deliver('discord', `http://127.0.0.1:${port}/hook`, 'ping')
    assert.equal(discord['delivered'], true)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  assert.equal(received.length, 2)
  assert.deepEqual(JSON.parse(received[0]?.['body'] ?? '{}'), { text: 'nội dung tiếng Việt' })
  assert.deepEqual(JSON.parse(received[1]?.['body'] ?? '{}'), { content: 'ping' })
  assert.match(received[0]?.['content'] ?? '', /application\/json/)
})

test('deliver: telegram dùng bot token và chat_id, thiếu token thì báo lỗi', async () => {
  await assert.rejects(() => deliver('telegram', '12345', 'hi', ''), /token is not configured/)
  const saved = globalThis.fetch
  let captured = ''
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    captured = String(input)
    assert.deepEqual(JSON.parse(String(init?.['body'] ?? '{}')), { chat_id: '12345', text: 'hi' })
    return new Response('{"ok":true}', { status: 200 })
  }) as typeof fetch
  try {
    const result = await deliver('telegram', '12345', 'hi', 'token/with space')
    assert.equal(result['delivered'], true)
    assert.match(captured, /api\.telegram\.org\/bottoken%2Fwith%20space\/sendMessage/)
  } finally {
    globalThis.fetch = saved
  }
})

test('CronManager: chạy lịch đến hạn, cập nhật lần chạy và phát sự kiện', async () => {
  const job: Json = {
    id: 'job-1',
    name: 'Báo cáo',
    prompt: 'tóm tắt',
    schedule: '30 9 * * 1-5',
    channel: 'none',
    target: '',
  }
  const runs: Array<{ id: string; last: number; next: number }> = []
  const events = new EventBus()
  const seen: string[] = []
  events.on((event) => seen.push(event.type))
  const store = {
    automationGet: () => job,
    automationSetRun: (id: string, last: number, next: number) => runs.push({ id, last, next }),
    automationDue: () => [job],
  } as unknown as Store
  let dispatched = 0
  const manager = new CronManager(
    store,
    events,
    async (input) => {
      dispatched += 1
      return `summary:${String(input['prompt'])}`
    },
    () => '',
  )

  const result = await manager.runNow('job-1')
  assert.equal(result['ok'], true)
  assert.equal(dispatched, 1)
  assert.equal(runs.length, 1)
  assert.ok(Number(runs[0]?.['next']) > Number(runs[0]?.['last']))
  assert.ok(seen.includes('automation.ran'))

  await manager.tick()
  assert.equal(dispatched, 2, 'tick phải chạy lịch đến hạn')
  assert.equal(runs.length, 2)
})

test('CronManager: lỗi dispatcher được bọc và phát automation.failed', async () => {
  const job: Json = { id: 'job-2', name: 'Lỗi', schedule: '* * * * *', channel: 'none' }
  const events = new EventBus()
  const seen: string[] = []
  events.on((event) => seen.push(event.type))
  const store = {
    automationGet: (id: string) => (id === 'job-2' ? job : null),
    automationSetRun: () => undefined,
    automationDue: () => [],
  } as unknown as Store
  const manager = new CronManager(
    store,
    events,
    async () => {
      throw new Error('provider unavailable')
    },
    () => '',
  )
  const result = await manager.runNow('job-2')
  assert.equal(result['ok'], false)
  assert.match(String(result['error']), /provider unavailable/)
  assert.ok(seen.includes('automation.failed'))
  await assert.rejects(() => manager.runNow('missing'), /not found/)
})
