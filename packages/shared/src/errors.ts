import type { NexusErrorPayload, ToolRisk } from './types'

export const ERROR_CODES = [
  'E_PROVIDER',
  'E_NETWORK',
  'E_AUTH',
  'E_RATE_LIMIT',
  'E_CONTEXT_OVERFLOW',
  'E_TOOL',
  'E_PERMISSION',
  'E_FS',
  'E_TERMINAL',
  'E_LSP',
  'E_GIT',
  'E_DB',
  'E_CANCELLED',
  'E_TIMEOUT',
  'E_VALIDATION',
  'E_CONFIG',
  'E_INTERNAL',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{10,}/g, '***redacted***'],
  [/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, '$1***redacted***'],
  [/(api[_-]?key["'\s:=]+)[A-Za-z0-9._-]{8,}/gi, '$1***redacted***'],
  [/(x-api-key["'\s:=]+)[A-Za-z0-9._-]{8,}/gi, '$1***redacted***'],
]

export function redactSecrets(value: string): string {
  let out = value
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

export class NexusError extends Error {
  readonly code: ErrorCode
  readonly details?: Record<string, unknown>
  readonly retryable: boolean

  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown },
  ) {
    super(redactSecrets(message))
    this.name = 'NexusError'
    this.code = code
    this.details = options?.details
    this.retryable = options?.retryable ?? false
    if (options?.cause !== undefined) this.cause = options.cause
  }

  toPayload(): NexusErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details
        ? (JSON.parse(redactSecrets(JSON.stringify(this.details))) as Record<string, unknown>)
        : undefined,
    }
  }
}

export function normalizeError(error: unknown): NexusError {
  if (error instanceof NexusError) return error
  if (error instanceof Error) {
    const message = redactSecrets(error.message || error.name)
    if (error.name === 'AbortError') return new NexusError('E_CANCELLED', 'Operation cancelled')
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network/i.test(message)) {
      return new NexusError('E_NETWORK', message, { retryable: true, cause: error })
    }
    return new NexusError('E_INTERNAL', message, { cause: error })
  }
  return new NexusError('E_INTERNAL', redactSecrets(String(error)))
}

export function errorPayload(error: unknown): NexusErrorPayload {
  return normalizeError(error).toPayload()
}

const DANGEROUS_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+(\/|~|\$HOME)(\s|$)/,
    reason: 'recursive delete of a root or home directory',
  },
  { pattern: /\brm\s+-rf\s+(\*|\.\s*$)/, reason: 'recursive delete of the current directory' },
  { pattern: /\bmkfs(\.\w+)?\b/, reason: 'filesystem format' },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\//, reason: 'raw device write' },
  { pattern: />\s*\/dev\/(sd|nvme|disk)/, reason: 'raw device write' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, reason: 'fork bomb' },
  { pattern: /\bchmod\s+-R\s+777\s+\/(\s|$)/, reason: 'permission change on root' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: 'host power operation' },
  { pattern: /\bgit\s+push\b[^\n]*(--force|-f)\b/, reason: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'hard reset (discards local changes)' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: 'removes untracked files' },
  {
    pattern: /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b/,
    reason: 'piping remote content into a shell',
  },
  { pattern: /\bsudo\b/, reason: 'privilege escalation' },
  { pattern: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/, reason: 'package publish' },
  { pattern: /\bhistory\s+-c\b/, reason: 'destroys shell history' },
]

export function screenCommand(command: string): { dangerous: boolean; reason?: string } {
  for (const entry of DANGEROUS_COMMANDS) {
    if (entry.pattern.test(command)) return { dangerous: true, reason: entry.reason }
  }
  return { dangerous: false }
}

export interface PermissionSubject {
  risk: ToolRisk
  pathInWorkspace?: boolean
  command?: string
  outsideWorkspace?: boolean
}

export interface PermissionVerdict {
  decision: 'allow' | 'ask' | 'deny'
  reason: string
}
