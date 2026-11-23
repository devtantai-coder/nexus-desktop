import { NexusError } from './errors.ts'
import type { EventBus } from './events.ts'
import type { Store } from './store.ts'
import type { Json } from './tools.ts'

const RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
]

function fieldValues(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [base, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1)
      throw new NexusError('E_VALIDATION', `Invalid cron step: ${part}`)
    let from = min
    let to = max
    if (base !== '*' && base !== undefined) {
      if (base.includes('-')) {
        const [a, b] = base.split('-')
        from = Number(a)
        to = Number(b)
      } else {
        from = Number(base)
        to = stepRaw === undefined ? from : max
      }
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new NexusError('E_VALIDATION', `Invalid cron field: ${field}`)
    }
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return values
}

/** Tính lần chạy tiếp theo cho cron 5 trường (phút giờ ngày tháng thứ). */
export function nextRunAt(schedule: string, from = Date.now()): number {
  const fields = schedule.trim().split(/\s+/)
  if (fields.length !== 5) throw new NexusError('E_VALIDATION', 'Cron schedule needs 5 fields')
  const sets = fields.map((field, index) => {
    // fields.length === 5 đã được kiểm tra ở trên, nên chỉ số luôn hợp lệ.
    const range = RANGES[index] as [number, number]
    return fieldValues(field, range[0], range[1])
  })
  const minutes = sets[0] as Set<number>
  const hours = sets[1] as Set<number>
  const days = sets[2] as Set<number>
  const months = sets[3] as Set<number>
  const weekdays = sets[4] as Set<number>
  const cursor = new Date(from)
  cursor.setSeconds(0, 0)
  // Cộng epoch thay vì setMinutes(): DST fall-back có giờ lặp lại, setMinutes nhảy qua chúng.
  let cursorMs = cursor.getTime() + 60_000
  const domRestricted = fields[2] !== '*'
  const dowRestricted = fields[4] !== '*'
  // 5 năm để bắt cả lịch 29/2 (chu kỳ 4 năm).
  const limit = 5 * 366 * 24 * 60
  for (let index = 0; index < limit; index += 1) {
    const now = new Date(cursorMs)
    const dayMatch =
      domRestricted && dowRestricted
        ? // POSIX cron: khi cả ngày-tháng và thứ đều bị restrict → OR.
          days.has(now.getDate()) || weekdays.has(now.getDay())
        : (!domRestricted || days.has(now.getDate())) &&
          (!dowRestricted || weekdays.has(now.getDay()))
    const match =
      minutes.has(now.getMinutes()) &&
      hours.has(now.getHours()) &&
      dayMatch &&
      months.has(now.getMonth() + 1)
    if (match) return now.getTime()
    cursorMs += 60_000
  }
  throw new NexusError('E_VALIDATION', 'Cron schedule has no upcoming slot')
}

function httpUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const protocol = url.protocol.toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error('scheme')
    return url.toString()
  } catch {
    throw new NexusError('E_VALIDATION', 'Delivery target must be an http(s) URL')
  }
}

/** Gửi kết quả tới webhook, Discord webhook hoặc Telegram bot. */
export async function deliver(
  channel: string,
  target: string,
  message: string,
  token = '',
): Promise<Json> {
  if (channel === 'none') return { delivered: false, channel }
  const text = message.slice(0, 8000)
  if (channel === 'webhook' || channel === 'discord') {
    const response = await fetch(httpUrl(target), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(channel === 'discord' ? { content: text } : { text }),
      signal: AbortSignal.timeout(10_000),
    })
    return { delivered: response.ok, channel, status: response.status }
  }
  if (channel === 'telegram') {
    if (token === '') throw new NexusError('E_CONFIG', 'Telegram bot token is not configured')
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text }),
      signal: AbortSignal.timeout(10_000),
    })
    return { delivered: response.ok, channel, status: response.status }
  }
  throw new NexusError('E_VALIDATION', `Unknown delivery channel: ${channel}`)
}

export type AutomationDispatcher = (job: Json) => Promise<string>

/** Lên lịch chạy task định kỳ và gửi kết quả đi nơi khác. */
export class CronManager {
  private timer: NodeJS.Timeout | null = null
  private running = false

  private readonly store: Store
  private readonly events: EventBus
  private readonly dispatcher: AutomationDispatcher
  private readonly tokenProvider: () => string

  constructor(
    store: Store,
    events: EventBus,
    dispatcher: AutomationDispatcher,
    tokenProvider: () => string,
  ) {
    this.store = store
    this.events = events
    this.dispatcher = dispatcher
    this.tokenProvider = tokenProvider
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => void this.tick(), 30_000)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const job of this.store.automationDue(Date.now())) {
        await this.execute(job)
      }
    } finally {
      this.running = false
    }
  }

  async runNow(id: string): Promise<Json> {
    const job = this.store.automationGet(id)
    if (!job) throw new NexusError('E_NOT_FOUND', `Automation ${id} not found`)
    return this.execute(job)
  }

  async testChannel(channel: string, target: string): Promise<Json> {
    return deliver(
      channel,
      target,
      'NEXUS Desktop: kiểm tra kênh gửi kết quả.',
      this.tokenProvider(),
    )
  }

  private async execute(job: Json): Promise<Json> {
    const id = String(job['id'])
    const now = Date.now()
    const schedule = String(job['schedule'])
    const next = nextRunAt(schedule, now)
    this.store.automationSetRun(id, now, next)
    try {
      const summary = await this.dispatcher(job)
      const delivery = await deliver(
        String(job['channel'] ?? 'none'),
        String(job['target'] ?? ''),
        `${String(job['name'] ?? 'Automation')}\n${summary}`,
        this.tokenProvider(),
      )
      this.events.emit('automation.ran', { id, nextRunAt: next, delivery })
      return { id, ok: true, nextRunAt: next, delivery }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.events.emit('automation.failed', { id, error: message })
      return { id, ok: false, nextRunAt: next, error: message }
    }
  }
}
