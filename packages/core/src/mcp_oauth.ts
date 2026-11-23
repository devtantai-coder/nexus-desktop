import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

import { NexusError } from './errors.ts'
import { httpRequest } from './http.ts'
import type { SecretStore } from './secrets.ts'
import type { Store } from './store.ts'

export type Json = any
import { nowMs } from './util.ts'

const kSettingKey = 'mcp.oauth'
const kCallbackTimeoutMs = 240_000

const randomToken = (bytes: number): string => randomBytes(bytes).toString('base64url')

const codeChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url')

const percentEncode = (value: string): string => {
  let out = ''
  for (const c of value) {
    if (/[A-Za-z0-9\-_.~]/.test(c)) out += c
    else out += `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

const originOf = (url: string): string => {
  const scheme = url.indexOf('://')
  if (scheme === -1) return url
  const slash = url.indexOf('/', scheme + 3)
  return slash === -1 ? url : url.slice(0, slash)
}

const queryValue = (query: string, key: string): string => {
  const needle = `${key}=`
  let start = 0
  while (start < query.length) {
    const end = query.indexOf('&', start)
    const pair = query.slice(start, end === -1 ? undefined : end)
    if (pair.startsWith(needle)) {
      const value = pair.slice(needle.length)
      let decoded = ''
      for (let i = 0; i < value.length; i += 1) {
        const c = value[i] as string
        if (c === '%' && i + 2 < value.length) {
          decoded += String.fromCharCode(parseInt(value.slice(i + 1, i + 3), 16))
          i += 2
        } else if (c === '+') {
          decoded += ' '
        } else {
          decoded += c
        }
      }
      return decoded
    }
    if (end === -1) break
    start = end + 1
  }
  return ''
}

const parseStringValue = (value: Json, key: string): string => {
  const item = value?.[key]
  return typeof item === 'string' ? item : ''
}

export class McpOauth {
  private readonly store: Store
  private readonly secrets: SecretStore

  constructor(store: Store, secrets: SecretStore) {
    this.store = store
    this.secrets = secrets
  }

  private load(): Json {
    const value = this.store.settingGet(kSettingKey, {})
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const cipher = value['blob']
    if (typeof cipher !== 'string' || cipher === '') return {}
    try {
      const parsed = JSON.parse(this.secrets.decrypt(cipher)) as Json
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private save(tokens: Json): void {
    this.store.settingSet(kSettingKey, { blob: this.secrets.encrypt(JSON.stringify(tokens)) })
  }

  private entry(tokens: Json, serverId: string): Json {
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return {}
    const value = tokens[serverId]
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }

  private async httpJson(
    url: string,
    method: string,
    body: string,
    contentType: string,
  ): Promise<Json> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== '') headers['Content-Type'] = contentType
    const response = await httpRequest({
      url,
      method,
      headers,
      ...(body !== '' ? { body } : {}),
      timeoutSeconds: 20,
    })
    if (response.status < 200 || response.status >= 300) {
      throw new NexusError('E_AUTH', `OAuth endpoint trả ${response.status}: ${url}`)
    }
    let parsed: Json = null
    try {
      parsed = JSON.parse(response.body)
    } catch {
      throw new NexusError('E_AUTH', `OAuth endpoint trả JSON không hợp lệ: ${url}`)
    }
    return parsed
  }

  async bearer(serverId: string): Promise<string> {
    const tokens = this.load()
    const value = this.entry(tokens, serverId)
    const token = parseStringValue(value, 'access_token')
    const expiresAt = typeof value['expires_at'] === 'number' ? value['expires_at'] : 0
    const expired = expiresAt > 0 && nowMs() >= expiresAt
    if (token !== '' && !expired) return token

    const refresh = parseStringValue(value, 'refresh_token')
    const endpoint = parseStringValue(value, 'token_endpoint')
    const clientId = parseStringValue(value, 'client_id')
    const resource = parseStringValue(value, 'resource')
    if (refresh === '' || endpoint === '') return ''
    let form = `grant_type=refresh_token&refresh_token=${percentEncode(refresh)}`
    if (clientId !== '') form += `&client_id=${percentEncode(clientId)}`
    if (resource !== '') form += `&resource=${percentEncode(resource)}`
    try {
      const fresh = await this.httpJson(endpoint, 'POST', form, 'application/x-www-form-urlencoded')
      const next = parseStringValue(fresh, 'access_token')
      if (next === '') return ''
      const expiresIn = typeof fresh?.['expires_in'] === 'number' ? fresh['expires_in'] : 0
      value['access_token'] = next
      const freshRefresh = parseStringValue(fresh, 'refresh_token')
      if (freshRefresh !== '') value['refresh_token'] = freshRefresh
      value['expires_at'] = expiresIn > 0 ? nowMs() + expiresIn * 1000 : 0
      delete value['error']
      tokens[serverId] = value
      this.save(tokens)
      return next
    } catch {
      return ''
    }
  }

  status(serverId: string): Json {
    const value = this.entry(this.load(), serverId)
    const token = parseStringValue(value, 'access_token')
    const expiresAt = typeof value['expires_at'] === 'number' ? value['expires_at'] : 0
    const valid = token !== '' && (expiresAt === 0 || nowMs() < expiresAt)
    return {
      authenticated: valid,
      expiresAt,
      error: parseStringValue(value, 'error'),
    }
  }

  clear(serverId: string): void {
    const tokens = this.load()
    delete tokens[serverId]
    this.save(tokens)
  }

  invalidate(serverId: string): void {
    const tokens = this.load()
    const value = this.entry(tokens, serverId)
    if (value && typeof value === 'object') {
      delete value['access_token']
      value['error'] = 'Server từ chối token (401). Bấm Kết nối để đăng nhập lại.'
      tokens[serverId] = value
      this.save(tokens)
    }
  }

  async start(serverId: string, resourceUrl: string): Promise<Json> {
    const origin = originOf(resourceUrl)

    let issuer = origin
    try {
      const metadata = await this.httpJson(
        `${origin}/.well-known/oauth-protected-resource`,
        'GET',
        '',
        '',
      )
      const servers = metadata?.['authorization_servers']
      if (
        Array.isArray(servers) &&
        servers.length > 0 &&
        typeof servers[0] === 'string' &&
        servers[0] !== ''
      ) {
        issuer = servers[0] as string
      }
    } catch {
      // Không có metadata công bố: dùng chính origin làm authorization server.
    }

    let serverMetadata: Json = null
    try {
      serverMetadata = await this.httpJson(
        `${issuer}/.well-known/oauth-authorization-server`,
        'GET',
        '',
        '',
      )
    } catch {
      serverMetadata = await this.httpJson(
        `${issuer}/.well-known/openid-configuration`,
        'GET',
        '',
        '',
      )
    }
    const authorizationEndpoint = parseStringValue(serverMetadata, 'authorization_endpoint')
    const tokenEndpoint = parseStringValue(serverMetadata, 'token_endpoint')
    const registrationEndpoint = parseStringValue(serverMetadata, 'registration_endpoint')
    if (authorizationEndpoint === '' || tokenEndpoint === '') {
      throw new NexusError(
        'E_AUTH',
        'Authorization server thiếu authorization_endpoint/token_endpoint',
      )
    }

    const listener = await new Promise<Server>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve(server)
      })
    })
    const address = listener.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    if (port === 0) {
      listener.close()
      throw new NexusError('E_AUTH', 'Không bind được cổng callback')
    }
    const redirectUri = `http://127.0.0.1:${port}/callback`

    let clientId = parseStringValue(this.entry(this.load(), serverId), 'client_id')
    if (clientId === '' && registrationEndpoint !== '') {
      const registration = await this.httpJson(
        registrationEndpoint,
        'POST',
        JSON.stringify({
          client_name: 'Nexus Desktop',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
        'application/json',
      )
      clientId = parseStringValue(registration, 'client_id')
    }
    if (clientId === '') {
      listener.close()
      throw new NexusError('E_AUTH', 'Không đăng ký được OAuth client với authorization server')
    }

    const verifier = randomToken(32)
    const state = randomToken(16)
    let authorizeUrl = authorizationEndpoint + (authorizationEndpoint.includes('?') ? '&' : '?')
    authorizeUrl += `response_type=code&client_id=${percentEncode(clientId)}`
    authorizeUrl += `&redirect_uri=${percentEncode(redirectUri)}`
    authorizeUrl += `&code_challenge=${codeChallenge(verifier)}&code_challenge_method=S256`
    authorizeUrl += `&state=${percentEncode(state)}`
    authorizeUrl += `&resource=${percentEncode(resourceUrl)}`

    const expectedState = state
    const resource = resourceUrl
    const onCallback = async (raw: string): Promise<string> => {
      const queryStart = raw.indexOf('?')
      const query = queryStart === -1 ? '' : (raw.slice(queryStart + 1).split(' ')[0] as string)
      const code = queryValue(query, 'code')
      const returnedState = queryValue(query, 'state')
      if (returnedState === '' && query.includes('state=') === false && resource === '') {
        return '<h2>Đăng nhập thất bại</h2><p>Thiếu code hoặc state không khớp.</p>'
      }
      if (code === '' || returnedState !== expectedState) {
        return '<h2>Đăng nhập thất bại</h2><p>Thiếu code hoặc state không khớp.</p>'
      }
      let form = `grant_type=authorization_code&code=${percentEncode(code)}`
      form += `&redirect_uri=${percentEncode(redirectUri)}`
      form += `&client_id=${percentEncode(clientId)}`
      form += `&code_verifier=${percentEncode(verifier)}`
      form += `&resource=${percentEncode(resource)}`
      try {
        const token = await this.httpJson(
          tokenEndpoint,
          'POST',
          form,
          'application/x-www-form-urlencoded',
        )
        const expiresIn = typeof token?.['expires_in'] === 'number' ? token['expires_in'] : 0
        const tokens = this.load()
        const value = this.entry(tokens, serverId)
        value['access_token'] = parseStringValue(token, 'access_token')
        value['refresh_token'] = parseStringValue(token, 'refresh_token')
        value['token_endpoint'] = tokenEndpoint
        value['client_id'] = clientId
        value['resource'] = resource
        value['expires_at'] = expiresIn > 0 ? nowMs() + expiresIn * 1000 : 0
        delete value['error']
        tokens[serverId] = value
        this.save(tokens)
        return '<h2>Đã kết nối</h2><p>Quay lại Nexus Desktop để tiếp tục.</p>'
      } catch (error) {
        const tokens = this.load()
        const value = this.entry(tokens, serverId)
        value['error'] = error instanceof Error ? error.message : String(error)
        tokens[serverId] = value
        this.save(tokens)
        return `<h2>Đổi token thất bại</h2><p>${value['error']}</p>`
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined = undefined
    const closeListener = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      try {
        listener.close()
      } catch {
        // đã đóng
      }
    }

    listener.on('request', (request, response) => {
      if (!request.url?.startsWith('/callback')) {
        response.statusCode = 404
        response.end('Not found')
        return
      }
      void onCallback(request.url).then(
        (body) => {
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(body)
          // Callback đã xong: đóng ngay, không giữ cổng/event loop đến hết timeout.
          closeListener()
        },
        (error) => {
          response.statusCode = 500
          response.end(String(error))
          closeListener()
        },
      )
    })

    timer = setTimeout(() => {
      closeListener()
      const tokens = this.load()
      const value = this.entry(tokens, serverId)
      if (!parseStringValue(value, 'access_token')) {
        value['error'] = 'Hết thời gian chờ đăng nhập OAuth.'
        tokens[serverId] = value
        this.save(tokens)
      }
    }, kCallbackTimeoutMs)
    timer.unref()

    return { url: authorizeUrl, redirectUri }
  }
}
