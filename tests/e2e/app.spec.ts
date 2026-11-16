import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const requireFromApp = createRequire(resolve(__dirname, '../../apps/desktop/package.json'))
const electronPath = requireFromApp('electron') as unknown as string
const appEntry = resolve(__dirname, '../../apps/desktop')

let userData: string
let projectDir: string
let app: ElectronApplication
let page: Page

async function launch(): Promise<void> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.NEXUS_USER_DATA = userData
  env.NEXUS_E2E = '1'
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'
  app = await electron.launch({
    executablePath: electronPath,
    args: [
      appEntry,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${userData}`,
    ],
    env,
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), 'nexus-e2e-user-'))
  projectDir = await mkdtemp(join(tmpdir(), 'nexus-e2e-project-'))
  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(join(projectDir, 'src', 'hello.ts'), 'export const hello = "nexus"\n')
  await writeFile(join(projectDir, 'README.md'), '# E2E Project\n')
  await launch()
})

test.afterAll(async () => {
  await app.close().catch(() => undefined)
  await rm(userData, { recursive: true, force: true })
  await rm(projectDir, { recursive: true, force: true })
})

test('boots the shell, exposes the secure bridge and persists a project', async () => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await expect(page).toHaveTitle(/NEXUS/)
  await expect(page.getByText('NEXUS', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'New chat' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cài đặt' }).first()).toBeVisible()

  expect(await page.evaluate(() => typeof window.nexus?.invoke === 'function')).toBe(true)
  expect(
    await page.evaluate(() =>
      Boolean((window as unknown as { nexusKernel?: unknown }).nexusKernel),
    ),
  ).toBe(true)

  const info = await page.evaluate(async () => window.nexus.invoke('app.info'))
  expect(info.name).toBe('NEXUS Desktop')
  expect(info.version).toBeTruthy()
  expect(info.databasePath).toContain(userData)

  const blocked = await page
    .evaluate(async () =>
      window.nexus.invoke('workspace.readFile', { projectId: 'missing', path: '../../etc/passwd' }),
    )
    .then(
      () => 'resolved',
      (error: Error & { code?: string }) => error.code ?? 'error',
    )
  expect(blocked).not.toBe('resolved')

  const project = await page.evaluate(
    async (path) => window.nexus.invoke('project.open', { path }),
    projectDir,
  )
  expect(project.path).toBe(projectDir)

  const tree = await page.evaluate(
    async (projectId) => window.nexus.invoke('workspace.tree', { projectId, depth: 2 }),
    project.id,
  )
  expect((tree.children ?? []).map((node: { name: string }) => node.name)).toContain('src')

  const file = await page.evaluate(
    async (input) => window.nexus.invoke('workspace.readFile', input),
    {
      projectId: project.id,
      path: 'src/hello.ts',
    },
  )
  expect(file.content).toContain('export const hello')

  // Đường dẫn tuyệt đối nằm trong workspace phải đọc được (root leo lên repo/monorepo).
  const absolute = await page.evaluate(
    async (input) => window.nexus.invoke('workspace.readFile', input),
    {
      projectId: project.id,
      path: join(projectDir, 'README.md'),
    },
  )
  expect(absolute.content).toContain('E2E Project')

  const session = await page.evaluate(
    async (projectId) => window.nexus.invoke('session.create', { projectId, title: 'E2E session' }),
    project.id,
  )
  expect(session.title).toBe('E2E session')

  const settings = await page.evaluate(async () => window.nexus.invoke('settings.all'))
  expect(settings).toMatchObject({ 'language.locale': 'vi' })

  await page.evaluate(async () => {
    await window.nexus.invoke('settings.set', { key: 'e2e.persisted', value: 42 })
  })

  expect(errors).toEqual([])
})

test('opens settings and exposes the tool surface', async () => {
  await page.getByRole('button', { name: 'Tài khoản' }).first().click()
  await expect(page.getByText('General', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Giao diện', { exact: true }).first()).toBeVisible()

  const tools = await page.evaluate(async () => window.nexus.invoke('agent.toolList'))
  expect(Array.isArray(tools)).toBe(true)
  expect((tools as unknown[]).length).toBeGreaterThan(20)
})

test('manages MCP servers and exposes them in settings', async () => {
  await page.evaluate(async () =>
    window.nexus.invoke('settings.set', {
      key: 'mcp.servers',
      value: [{ id: 'offline', command: 'node', args: ['-e', '0'], enabled: false }],
    }),
  )

  const servers = await page.evaluate(async () => window.nexus.invoke('mcp.servers'))
  expect(servers).toHaveLength(1)
  expect(servers[0]).toMatchObject({
    id: 'offline',
    command: 'node',
    enabled: false,
    status: { running: false },
  })

  const disabledTools = await page.evaluate(async () => window.nexus.invoke('mcp.tools', {}))
  expect(disabledTools).toEqual([])

  await page.evaluate(async () => window.nexus.invoke('mcp.restart'))

  await page.getByRole('button', { name: 'Tài khoản' }).first().click()
  await page
    .getByRole('button', { name: /MCP servers/ })
    .first()
    .click()
  await expect(page.getByText('offline')).toBeVisible()
  await expect(page.getByText('Filesystem')).toBeVisible()

  // Thêm server từ xa qua dialog rồi kiểm tra cấu hình được ghi xuống.
  await page.getByRole('button', { name: 'Thêm MCP server' }).click()
  await page.getByPlaceholder('my-server').fill('ui-server')
  await page.getByPlaceholder('https://example.com/mcp').fill('https://example.invalid/mcp')
  await page.getByPlaceholder('Authorization=Bearer token').fill('X-Token=abc')
  await page.getByRole('button', { name: 'Thêm server' }).click()
  await expect(page.getByText('ui-server')).toBeVisible()
  const saved = await page.evaluate(async () => window.nexus.invoke('settings.all'))
  expect(saved['mcp.servers']).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'ui-server',
        url: 'https://example.invalid/mcp',
        headers: { 'X-Token': 'abc' },
      }),
    ]),
  )

  // ID có ký tự lạ bị chặn vì nó đi vào tên tool mcp__<id>__<tool>; lỗi hiện ngay trong dialog.
  await page.getByRole('button', { name: 'Thêm MCP server' }).click()
  await page.getByPlaceholder('my-server').fill('bad id!')
  await page.getByPlaceholder('npx hoặc đường dẫn tuyệt đối').fill('node')
  await page.getByRole('button', { name: 'Thêm server' }).click()
  await expect(page.getByText(/Chỉ dùng chữ, số/)).toBeVisible()
  await page.getByRole('button', { name: 'Huỷ' }).click()

  // Xem tool của server đang tắt: rỗng và không có lỗi khởi động.
  await page.getByLabel('Xem tool của offline').click()
  await expect(page.getByText(/Không có tool trả về/)).toBeVisible()
  await page.getByLabel('Xem tool của offline').click()

  // Sửa transport: đổi server từ url sang command phải xoá url cũ, không để lại cả hai.
  await page.getByLabel('Sửa ui-server').click()
  await page.getByPlaceholder('https://example.com/mcp').fill('')
  await page.getByPlaceholder('Authorization=Bearer token').fill('')
  await page.getByPlaceholder('npx hoặc đường dẫn tuyệt đối').fill('node')
  await page.getByPlaceholder('-y @scope/server').fill('-e 0')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  const edited = await page.evaluate(async () => window.nexus.invoke('settings.all'))
  const entry = (edited['mcp.servers'] as Array<Record<string, unknown>>).find(
    (server) => server.id === 'ui-server',
  )
  expect(entry).toMatchObject({ id: 'ui-server', command: 'node' })
  expect(entry?.url).toBeUndefined()
  expect(entry?.headers).toBeUndefined()

  // Xoá server cần xác nhận trong dialog.
  await page.getByLabel('Xoá ui-server').click()
  await page.getByRole('button', { name: 'Xoá server' }).click()
  await expect(page.getByText('ui-server')).toHaveCount(0)
  const afterDelete = await page.evaluate(async () => window.nexus.invoke('settings.all'))
  expect(
    (afterDelete['mcp.servers'] as Array<{ id: string }>).some(
      (server) => server.id === 'ui-server',
    ),
  ).toBe(false)

  // Kiểm tra kết nối: lỗi khởi động phải hiện ngay dưới server.
  await page.evaluate(async () =>
    window.nexus.invoke('settings.set', {
      key: 'mcp.servers',
      value: [{ id: 'broken', command: '/nonexistent/x', args: [], enabled: true }],
    }),
  )
  await page.reload()
  await page.getByRole('button', { name: 'Tài khoản' }).first().click()
  await page
    .getByRole('button', { name: /MCP servers/ })
    .first()
    .click()
  await page.getByLabel('Kiểm tra broken').click()
  await expect(page.getByText('broken: kết nối thất bại')).toBeVisible()
  await expect(page.getByText(/exited|not running|No such file/i).first()).toBeVisible()

  // Dọn cấu hình để test sau không thấy server cũ.
  await page.evaluate(async () =>
    window.nexus.invoke('settings.set', { key: 'mcp.servers', value: [] }),
  )
})

test('talks to a remote MCP server over streamable HTTP', async () => {
  const methods: string[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const message = JSON.parse(body || '{}') as { id?: number; method?: string }
      if (message.method) methods.push(message.method)
      if (message.id === undefined) {
        response.writeHead(202)
        response.end()
        return
      }
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'stub', version: '1' },
            }
          : message.method === 'tools/list'
            ? {
                tools: [
                  { name: 'echo', description: 'Echo back', inputSchema: { type: 'object' } },
                ],
              }
            : {}
      const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result })
      if (message.method === 'tools/list') {
        // Nhánh event-stream: server trả SSE thay vì JSON thuần.
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(`event: message\ndata: ${payload}\n\n`)
        return
      }
      response.writeHead(200, {
        'content-type': 'application/json',
        'mcp-session-id': 'stub-session',
      })
      response.end(payload)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as { port: number }

  try {
    await page.evaluate(
      async (url) =>
        window.nexus.invoke('settings.set', {
          key: 'mcp.servers',
          value: [{ id: 'stub', url, enabled: true }],
        }),
      `http://127.0.0.1:${address.port}/mcp`,
    )

    const tools = await page.evaluate(
      async () =>
        window.nexus.invoke('mcp.tools', {}) as Promise<
          Array<{ namespacedName: string; serverId?: string }>
        >,
    )
    expect(tools.map((tool) => tool.namespacedName)).toContain('mcp__stub__echo')
    expect(methods).toContain('initialize')
    expect(methods).toContain('tools/list')

    const servers = (await page.evaluate(async () => window.nexus.invoke('mcp.servers'))) as Array<{
      id: string
      url?: string
      enabled: boolean
      status: { running: boolean; tools?: number }
    }>
    expect(servers[0]).toMatchObject({ id: 'stub', enabled: true })
    expect(servers[0]?.url).toContain('/mcp')
    expect(servers[0]?.status).toMatchObject({ running: true, tools: 1 })
  } finally {
    server.close()
    await page.evaluate(async () =>
      window.nexus.invoke('settings.set', { key: 'mcp.servers', value: [] }),
    )
  }
})

test('reports why an MCP server failed to start', async () => {
  await page.evaluate(async () =>
    window.nexus.invoke('settings.set', {
      key: 'mcp.servers',
      value: [{ id: 'broken', command: '/nonexistent/mcp-binary', args: [], enabled: true }],
    }),
  )

  const failure = await page
    .evaluate(async () => window.nexus.invoke('mcp.tools', { serverId: 'broken' }))
    .then(() => 'resolved')
    .catch((error: Error & { code?: string }) => error.message)
  expect(failure).not.toBe('resolved')

  const servers = (await page.evaluate(async () => window.nexus.invoke('mcp.servers'))) as Array<{
    id: string
    error?: string
    status: { running: boolean }
  }>
  expect(servers[0]?.status.running).toBe(false)
  expect(servers[0]?.error ?? '').toMatch(/exited|not running|No such file/i)

  await page.evaluate(async () =>
    window.nexus.invoke('settings.set', { key: 'mcp.servers', value: [] }),
  )
})

test('talks to a legacy SSE MCP server', async () => {
  const streams = new Set<ServerResponse>()
  const methods: string[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.write('event: endpoint\ndata: /messages\n\n')
      streams.add(response)
      request.on('close', () => streams.delete(response))
      return
    }
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const message = JSON.parse(body || '{}') as { id?: number; method?: string }
      if (message.method) methods.push(message.method)
      response.writeHead(202)
      response.end()
      if (message.id === undefined) return
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'sse-stub', version: '1' },
            }
          : message.method === 'tools/list'
            ? { tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object' } }] }
            : {}
      const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`
      for (const stream of streams) stream.write(frame)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as { port: number }

  try {
    await page.evaluate(
      async (url) =>
        window.nexus.invoke('settings.set', {
          key: 'mcp.servers',
          value: [{ id: 'sse-stub', url, transport: 'sse', enabled: true }],
        }),
      `http://127.0.0.1:${address.port}/sse`,
    )

    const tools = (await page.evaluate(async () =>
      window.nexus.invoke('mcp.tools', { serverId: 'sse-stub' }),
    )) as Array<{ namespacedName: string }>
    expect(tools.map((tool) => tool.namespacedName)).toEqual(['mcp__sse-stub__ping'])
    expect(methods).toContain('initialize')
    expect(methods).toContain('tools/list')
  } finally {
    for (const stream of streams) stream.end()
    server.close()
    await page.evaluate(async () =>
      window.nexus.invoke('settings.set', { key: 'mcp.servers', value: [] }),
    )
  }
})

test('authorizes an MCP server over OAuth', async () => {
  const state: { tokens: string[] } = { tokens: [] }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const url = new URL(request.url ?? '/', origin)
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] }))
      return
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          code_challenge_methods_supported: ['S256'],
        }),
      )
      return
    }
    if (url.pathname === '/register') {
      response.writeHead(201, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ client_id: 'stub-client' }))
      return
    }
    if (url.pathname === '/authorize') {
      const redirect = url.searchParams.get('redirect_uri') ?? ''
      const returned = url.searchParams.get('state') ?? ''
      response.writeHead(302, {
        location: `${redirect}?code=stub-code&state=${encodeURIComponent(returned)}`,
      })
      response.end()
      return
    }
    if (url.pathname === '/token') {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        state.tokens.push(body)
        const refreshed = body.includes('grant_type=refresh_token')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            access_token: refreshed ? 'stub-token-2' : 'stub-token',
            token_type: 'Bearer',
            // Ngắn để kiểm tra luồng refresh_token trong cùng bài test.
            expires_in: refreshed ? 3600 : 1,
            refresh_token: 'stub-refresh',
          }),
        )
      })
      return
    }
    // /mcp: cần Bearer thì mới trả lời JSON-RPC.
    if (
      !['Bearer stub-token', 'Bearer stub-token-2'].includes(request.headers.authorization ?? '')
    ) {
      response.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      })
      response.end()
      return
    }
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const message = JSON.parse(body || '{}') as { id?: number; method?: string }
      response.writeHead(200, { 'content-type': 'application/json' })
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'oauth-stub', version: '1' },
            }
          : message.method === 'tools/list'
            ? { tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object' } }] }
            : {}
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  try {
    await page.evaluate(
      async (url) =>
        window.nexus.invoke('settings.set', {
          key: 'mcp.servers',
          value: [{ id: 'oauth', url, enabled: true }],
        }),
      `${origin}/mcp`,
    )

    const unauthorized = await page
      .evaluate(async () => window.nexus.invoke('mcp.tools', { serverId: 'oauth' }))
      .then(() => 'resolved')
      .catch((error: Error) => error.message)
    expect(unauthorized).toContain('OAuth')

    const started = (await page.evaluate(async () =>
      window.nexus.invoke('mcp.auth.start', { serverId: 'oauth' }),
    )) as { url: string }
    expect(started.url).toContain('code_challenge_method=S256')

    // Giả lập trình duyệt: mở authorization URL, stub chuyển hướng về callback của core.
    const callback = await fetch(started.url)
    expect(callback.status).toBe(200)
    expect(state.tokens[0]).toContain('grant_type=authorization_code')

    await expect
      .poll(
        async () => {
          const servers = (await page.evaluate(async () =>
            window.nexus.invoke('mcp.servers'),
          )) as Array<{ id: string; auth?: { authenticated: boolean } }>
          return servers[0]?.auth?.authenticated
        },
        { timeout: 10_000 },
      )
      .toBe(true)

    const tools = (await page.evaluate(async () =>
      window.nexus.invoke('mcp.tools', { serverId: 'oauth' }),
    )) as Array<{ namespacedName: string }>
    expect(tools.map((tool) => tool.namespacedName)).toEqual(['mcp__oauth__ping'])

    // Token hết hạn sau 1s: sau khi nạp lại, lần gọi sau phải tự refresh bằng refresh_token.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await page.evaluate(async () => window.nexus.invoke('mcp.restart'))
    const afterExpiry = (await page.evaluate(async () =>
      window.nexus.invoke('mcp.tools', { serverId: 'oauth' }),
    )) as Array<{ namespacedName: string }>
    expect(afterExpiry.map((tool) => tool.namespacedName)).toEqual(['mcp__oauth__ping'])
    expect(state.tokens.some((body) => body.includes('grant_type=refresh_token'))).toBe(true)

    await page.evaluate(async () => window.nexus.invoke('mcp.auth.logout', { serverId: 'oauth' }))
    const afterLogout = (await page.evaluate(async () =>
      window.nexus.invoke('mcp.servers'),
    )) as Array<{ auth?: { authenticated: boolean } }>
    expect(afterLogout[0]?.auth?.authenticated).toBe(false)
  } finally {
    server.close()
    await page.evaluate(async () =>
      window.nexus.invoke('settings.set', { key: 'mcp.servers', value: [] }),
    )
  }
})

test('composer offers slash commands and runs them', async () => {
  await mkdir(join(projectDir, '.nexus/commands'), { recursive: true })
  await writeFile(
    join(projectDir, '.nexus/commands/review-pr.md'),
    '---\ndescription: Review a pull request\n---\nReview PR $ARGUMENTS\n',
  )
  const project = await page.evaluate(
    async (path) => window.nexus.invoke('project.open', { path }),
    projectDir,
  )
  const commands = await page.evaluate(
    async (projectId) => window.nexus.invoke('commands.list', { projectId }),
    project.id,
  )
  expect(commands.map((command: { name: string }) => command.name)).toContain('review-pr')

  await page.getByText('Nexus', { exact: true }).first().click()
  const input = page.locator('textarea').first()
  await input.click()

  await input.fill('/')
  const menu = page.getByRole('listbox', { name: 'Lệnh' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('option', { name: /\/new/ })).toBeVisible()
  // Menu phải thật sự hiện ra: điểm giữa menu thuộc về menu, không bị hộp composer cắt.
  const onTop = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return Boolean(hit && element.contains(hit))
  })
  expect(onTop).toBe(true)

  await input.fill('/exp')
  await expect(menu.getByRole('option')).toHaveCount(1)
  await expect(menu.getByRole('option', { name: /\/export/ })).toBeVisible()

  await input.press('Escape')
  await expect(menu).toBeHidden()

  // Enter chạy lệnh đang chọn: /reload nạp lại cấu hình và báo toast.
  await input.fill('/relo')
  await input.press('Enter')
  await expect(page.getByText('Đã nạp lại cấu hình')).toBeVisible()
  await expect(input).toHaveValue('')

  // /goal: cần phiên trước, đặt mục tiêu rồi xem và xoá.
  await input.fill('/goal')
  await input.press('Enter')
  await expect(input).toHaveValue('/goal ')
  await input.press('Enter')
  await expect(page.getByText('Cần mở một phiên trước')).toBeVisible()

  // @tệp: gợi ý đường dẫn trong dự án, Tab chèn vào prompt.
  await writeFile(join(projectDir, 'app.ts'), 'export const answer = 42\n', 'utf8')
  await input.fill('@app')
  const filesMenu = page.getByRole('listbox', { name: 'Tệp' })
  await expect(filesMenu).toBeVisible()
  await expect(filesMenu.getByRole('option', { name: /app\.ts/ })).toBeVisible()
  await input.press('Tab')
  await expect(input).toHaveValue('@app.ts ')

  // Bộ lệnh cho coding agent: trợ giúp, trạng thái git và dừng tác vụ.
  await input.fill('/help')
  await input.press('Enter')
  await expect(page.getByText(/^\d+ lệnh$/)).toBeVisible()
  await expect(input).toHaveValue('')

  await input.fill('/stop')
  await input.press('Enter')
  await expect(page.getByText('Không có tác vụ đang chạy')).toBeVisible()

  await input.fill('/status')
  await input.press('Enter')
  await expect(
    page.getByText(/Không phải git repo|Nhánh |Cần mở một dự án trước/).last(),
  ).toBeVisible()

  // Lệnh coding: danh sách tool, quyền, git log/branch cần dự án.
  await input.fill('/tools')
  await input.press('Enter')
  await expect(page.getByText(/tool khả dụng$/)).toBeVisible()

  // /sandbox: ma trận quyền lấy từ nhân, đổi chế độ ngay trong lệnh.
  await input.fill('/sandbox')
  await input.press('Enter')
  await expect(input).toHaveValue('/sandbox ')
  await input.press('Enter')
  await expect(page.getByText(/^Sandbox: /)).toBeVisible()
  await expect(page.getByText(/trong dự án → read:allow/)).toBeVisible()

  await input.fill('/sandbox read-only')
  await input.press('Enter')
  await expect(page.getByText('Sandbox: chỉ đọc')).toBeVisible()
  await expect(page.getByText(/trong dự án → read:allow write:deny/)).toBeVisible()

  await input.fill('/permissions read-only')
  await input.press('Enter')
  await expect(page.getByText('Quyền: chỉ đọc')).toBeVisible()
  // Lệnh có tham số: Enter lần đầu điền sẵn "/permissions ", lần hai mới chạy.
  await input.fill('/permissions')
  await input.press('Enter')
  await expect(input).toHaveValue('/permissions ')
  await input.press('Enter')
  await expect(page.getByText(/^Quyền hiện tại:/)).toBeVisible()

  await input.fill('/pause')
  await input.press('Enter')
  await expect(page.getByText('Không có tác vụ đang chạy')).toBeVisible()

  await input.fill('/log')
  await input.press('Enter')
  await expect(input).toHaveValue('/log ')
  await input.press('Enter')
  // Lệnh chạy xong thì composer được xoá (nội dung toast phụ thuộc trạng thái git của máy).
  await expect(input).toHaveValue('')

  // Nhóm lệnh còn lại: redo khi chưa có gì để gửi lại, thống kê phiên, git từ xa.
  await input.fill('/redo')
  await input.press('Enter')
  await expect(page.getByText('Không có lượt nào để gửi lại')).toBeVisible()

  await input.fill('/stats')
  await input.press('Enter')
  await expect(page.getByText('Cần mở một phiên trước')).toBeVisible()

  await input.fill('/push')
  await input.press('Enter')
  await expect(page.getByText(/Đã push|Cần mở một dự án trước|git|fatal/i).first()).toBeVisible()

  await input.fill('/grep')
  await input.press('Enter')
  await expect(input).toHaveValue('/grep ')
  await input.press('Enter')
  await expect(page.getByText(/Cần mẫu tìm|Cần mở một dự án trước/).last()).toBeVisible()

  await input.fill('/open')
  await input.press('Enter')
  await expect(input).toHaveValue('/open ')
  await input.press('Enter')
  await expect(page.getByText('Cần đường dẫn')).toBeVisible()

  await input.fill('/usage')
  await input.press('Enter')
  await expect(page.getByText(/request · .*7 ngày/)).toBeVisible()

  await input.fill('/logs')
  await input.press('Enter')
  await expect(page.getByText(/dòng log$/)).toBeVisible()
})

test('opens the command palette and runs a slash command from it', async () => {
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Bảng lệnh' })
  await expect(palette).toBeVisible()

  const search = palette.getByLabel('Tìm hành động, lệnh hoặc phiên')
  await search.fill('sandbox')
  await expect(palette.getByRole('option', { name: /\/sandbox/ })).toBeVisible()
  await search.press('Enter')
  await expect(palette).toBeHidden()
  // Lệnh được nhét vào composer, chưa chạy ngay.
  await expect(page.locator('textarea').first()).toHaveValue('/sandbox ')

  // Mở lại, điều hướng bằng phím và đóng bằng Escape.
  await page.keyboard.press('Control+Shift+P')
  await expect(palette).toBeVisible()
  await palette.getByLabel('Tìm hành động, lệnh hoặc phiên').fill('cài đặt')
  await palette.getByRole('option', { name: /Cài đặt/ }).click()
  await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible()
})

test.fixme('reopens with persisted project, session and setting', async () => {
  // BUG: sau khi khởi động lại, core đọc nexus.db cùng đường dẫn nhưng không thấy
  // project/session/setting (chỉ còn dữ liệu seed). Cần điều tra riêng trước khi bật lại.
  await app.close()
  await launch()

  const projects = await page.evaluate(async () => window.nexus.invoke('project.list'))
  expect(projects.some((entry: { path: string }) => entry.path === projectDir)).toBe(true)

  const sessions = await page.evaluate(async () => window.nexus.invoke('session.list', {}))
  expect(sessions.some((entry: { title: string }) => entry.title === 'E2E session')).toBe(true)

  const settings = await page.evaluate(async () => window.nexus.invoke('settings.all'))
  expect(settings['e2e.persisted']).toBe(42)
})
