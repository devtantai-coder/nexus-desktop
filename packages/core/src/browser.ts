import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Browser, Page } from '@playwright/test'
import { NexusError } from './errors.ts'
import type { Json } from './tools.ts'
import { toLower, trim, uuid } from './util.ts'

interface Session {
  id: string
  browser: Browser
  page: Page
  url: string
  createdAt: number
}

const DEFAULT_TIMEOUT = 15_000

/** Chỉ cho phép http/https — không file://, data: hay about:. */
export function browserUrl(raw: unknown): string {
  const value = trim(typeof raw === 'string' ? raw : '')
  if (value === '') throw new NexusError('E_VALIDATION', 'Browser URL is required')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new NexusError('E_VALIDATION', `Invalid URL: ${value}`)
  }
  if (toLower(parsed.protocol) !== 'http:' && toLower(parsed.protocol) !== 'https:') {
    throw new NexusError('E_VALIDATION', 'Only http:// and https:// URLs are allowed')
  }
  return parsed.toString()
}

/** Điều khiển trình duyệt headless cho agent: mở trang, đọc, tương tác, chụp ảnh. */
export class BrowserManager {
  private readonly sessions = new Map<string, Session>()

  private readonly userDataDir: string

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir
  }

  private require(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new NexusError('E_TOOL', `Browser session not found: ${id}`)
    return session
  }

  async open(input: Json): Promise<Json> {
    const url = browserUrl(input?.['url'])
    const timeout = Math.min(
      Math.max(Number(input?.['timeoutMs']) || DEFAULT_TIMEOUT, 1000),
      120_000,
    )
    const requireFromRepo = createRequire(join(process.cwd(), 'package.json'))
    const { chromium } = requireFromRepo('@playwright/test') as typeof import('@playwright/test')
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox'],
      ...(typeof process.env['NEXUS_BROWSER_EXECUTABLE'] === 'string'
        ? { executablePath: process.env['NEXUS_BROWSER_EXECUTABLE'] }
        : { channel: 'chrome' }),
    }
    let browser: Browser
    try {
      browser = await chromium.launch(launchOptions)
    } catch {
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.setDefaultTimeout(timeout)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    } catch (error) {
      await browser.close()
      throw new NexusError('E_NETWORK', error instanceof Error ? error.message : String(error))
    }
    const id = uuid()
    this.sessions.set(id, { id, browser, page, url: page.url(), createdAt: Date.now() })
    return { id, url: page.url(), title: await page.title() }
  }

  async read(input: Json): Promise<Json> {
    const session = this.require(String(input?.['sessionId'] ?? ''))
    const selector = typeof input?.['selector'] === 'string' ? input['selector'] : ''
    const target =
      selector !== '' ? session.page.locator(selector).first() : session.page.locator('body')
    await target.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT })
    const text = (await target.innerText()).slice(0, 50_000)
    return {
      sessionId: session.id,
      url: session.page.url(),
      title: await session.page.title(),
      selector,
      text,
    }
  }

  async click(input: Json): Promise<Json> {
    const session = this.require(String(input?.['sessionId'] ?? ''))
    const selector = trim(typeof input?.['selector'] === 'string' ? input['selector'] : '')
    if (selector === '') throw new NexusError('E_VALIDATION', 'Browser selector is required')
    await session.page.locator(selector).first().click({ timeout: DEFAULT_TIMEOUT })
    return { sessionId: session.id, clicked: selector, url: session.page.url() }
  }

  async fill(input: Json): Promise<Json> {
    const session = this.require(String(input?.['sessionId'] ?? ''))
    const selector = trim(typeof input?.['selector'] === 'string' ? input['selector'] : '')
    if (selector === '') throw new NexusError('E_VALIDATION', 'Browser selector is required')
    const value = typeof input?.['value'] === 'string' ? input['value'] : ''
    await session.page.locator(selector).first().fill(value, { timeout: DEFAULT_TIMEOUT })
    return { sessionId: session.id, filled: selector }
  }

  async press(input: Json): Promise<Json> {
    const session = this.require(String(input?.['sessionId'] ?? ''))
    const selector = trim(typeof input?.['selector'] === 'string' ? input['selector'] : '')
    const key = trim(typeof input?.['key'] === 'string' ? input['key'] : 'Enter')
    if (selector !== '') {
      await session.page.locator(selector).first().press(key, { timeout: DEFAULT_TIMEOUT })
    } else {
      await session.page.keyboard.press(key)
    }
    return { sessionId: session.id, pressed: key }
  }

  async screenshot(input: Json): Promise<Json> {
    const session = this.require(String(input?.['sessionId'] ?? ''))
    const dir = join(this.userDataDir, 'browser-shots')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${session.id}-${Date.now()}.png`)
    await session.page.screenshot({ path, fullPage: input?.['fullPage'] === true })
    return { sessionId: session.id, path }
  }

  async close(input: Json): Promise<Json> {
    const id = String(input?.['sessionId'] ?? '')
    const session = this.require(id)
    await session.browser.close()
    this.sessions.delete(id)
    return { closed: id }
  }

  list(): Json[] {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      url: session.url,
      title: '',
      createdAt: session.createdAt,
    }))
  }

  async call(method: string, input: Json): Promise<Json> {
    switch (method) {
      case 'open':
        return this.open(input)
      case 'read':
        return this.read(input)
      case 'click':
        return this.click(input)
      case 'fill':
        return this.fill(input)
      case 'press':
        return this.press(input)
      case 'screenshot':
        return this.screenshot(input)
      case 'close':
        return this.close(input)
      case 'list':
        return this.list()
      default:
        throw new NexusError('E_TOOL', `Unknown browser tool: ${method}`)
    }
  }

  async closeAll(): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      try {
        await session.browser.close()
      } catch {
        // already closed
      }
    }
    this.sessions.clear()
  }
}
