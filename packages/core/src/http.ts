/** HTTP mặc định cho provider/MCP: fetch + web stream, giữ đúng ngữ nghĩa curl ở bản C++. */

export interface HttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutSeconds?: number
  followRedirects?: boolean
  /** Mặc định 'application/json'; đặt 'text/event-stream' cho SSE. */
  accept?: string
}

export interface HttpResponse {
  status: number
  body: string
  headers: Record<string, string>
  /** Mã lỗi mạng/timeout ("" khi thành công). */
  error: string
  /** Location khi followRedirects=false và server trả 3xx. */
  redirectUrl: string
}

export type HttpDataCallback = (chunk: Buffer) => boolean

const MAX_BODY = 16 * 1024 * 1024
const DEFAULT_TIMEOUT_SECONDS = 300

function mergeSignals(external: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!external) return timeout
  // AbortSignal.any có từ Node 20.3 / browsers hiện đại.
  try {
    return AbortSignal.any([external, timeout])
  } catch {
    return external
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted)
}

export async function httpRequest(
  request: HttpRequest,
  onData?: HttpDataCallback,
  abort?: AbortSignal,
): Promise<HttpResponse> {
  const response: HttpResponse = { status: 0, body: '', headers: {}, error: '', redirectUrl: '' }
  const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
  const headers: Record<string, string> = { ...(request.headers ?? {}) }
  if (!hasHeader(headers, 'Accept')) headers['Accept'] = 'application/json'
  if (!hasHeader(headers, 'User-Agent')) headers['User-Agent'] = 'NEXUS-Desktop/0.1'
  const signal =
    timeoutSeconds === 0
      ? abort // timeoutSeconds=0 => stream vô hạn (SSE), chỉ dừng khi caller abort.
      : mergeSignals(abort, AbortSignal.timeout(timeoutSeconds * 1000))
  const init: RequestInit = {
    method: (request.method ?? 'GET').toUpperCase(),
    headers,
    redirect: request.followRedirects === false ? 'manual' : 'follow',
    signal,
  }
  if (request.body !== undefined && request.body.length > 0) init.body = request.body
  let raw: Response
  try {
    raw = await fetch(request.url, init)
  } catch (error) {
    if (abort?.aborted) response.error = 'cancelled'
    else response.error = error instanceof Error ? error.message : String(error)
    return response
  }
  response.status = raw.status
  raw.headers.forEach((value, key) => {
    response.headers[key.toLowerCase()] = value
  })
  if (request.followRedirects === false) {
    const location = raw.headers.get('location')
    if (location) response.redirectUrl = location
  }
  const reader = raw.body?.getReader()
  if (!reader) {
    response.body = await raw.text().catch(() => '')
    return response
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.length === 0) continue
      const chunk = Buffer.from(value)
      if (response.body.length < MAX_BODY) {
        const room = MAX_BODY - Buffer.byteLength(response.body, 'utf8')
        if (room > 0) response.body += chunk.subarray(0, room).toString('utf8')
      }
      if (onData) {
        try {
          if (!onData(chunk)) {
            // Caller dừng đọc (ví dụ stream SSE xong) — huỷ phần còn lại.
            await reader.cancel().catch(() => undefined)
            break
          }
        } catch (error) {
          response.error = error instanceof Error ? error.message : String(error)
          break
        }
      }
    }
  } catch (error) {
    if (!response.error) response.error = error instanceof Error ? error.message : String(error)
  }
  if (abort?.aborted) response.error = 'cancelled'
  return response
}
