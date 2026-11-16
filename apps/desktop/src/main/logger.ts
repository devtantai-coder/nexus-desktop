import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redactSecrets } from '@nexus/shared'

const MAX_LOG_BYTES = 2 * 1024 * 1024

let logFile: string | null = null
const memory: string[] = []

function ensureFile(): string {
  if (logFile) return logFile
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'main.log')
  try {
    if (existsSync(logFile) && statSync(logFile).size > MAX_LOG_BYTES) {
      renameSync(logFile, join(dir, 'main.old.log'))
    }
  } catch {
    /* rotation is best-effort */
  }
  return logFile
}

function write(level: string, message: string, details?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level} ${message}${
    details !== undefined ? ` ${safeStringify(details)}` : ''
  }`
  const redacted = redactSecrets(line)
  memory.push(redacted)
  if (memory.length > 1000) memory.shift()
  try {
    appendFileSync(ensureFile(), `${redacted}\n`, 'utf8')
  } catch {
    /* logging must never crash the app */
  }
  try {
    if (level === 'ERROR') console.error(redacted)
    else if (process.env.NEXUS_DEBUG) console.log(redacted)
  } catch {
    /* stdout/stderr can be closed (EPIPE); logging must never crash the app */
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const logger = {
  info: (message: string, details?: unknown) => write('INFO', message, details),
  warn: (message: string, details?: unknown) => write('WARN', message, details),
  error: (message: string, details?: unknown) => write('ERROR', message, details),
  debug: (message: string, details?: unknown) => {
    if (process.env.NEXUS_DEBUG) write('DEBUG', message, details)
  },
  path: (): string => ensureFile(),
  tail: (limit = 500): string[] => {
    if (!memory.length) {
      try {
        const content = require('node:fs').readFileSync(ensureFile(), 'utf8') as string
        return content.split('\n').slice(-limit)
      } catch {
        return []
      }
    }
    return memory.slice(-limit)
  },
}
