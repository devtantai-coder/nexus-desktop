import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { JsonValue } from './types.ts'

/* ---------------------------------------------------------------- thời gian & id */
export const nowMs = (): number => Date.now()
export const nowIso = (): string => new Date().toISOString()

export function uuid(): string {
  return randomUUID()
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/* ------------------------------------------------------------------ chuỗi & utf8 */
export const toLower = (value: string): string => value.toLowerCase()

export function trim(value: string): string {
  return value.trim()
}

export const startsWith = (value: string, prefix: string): boolean => value.startsWith(prefix)
export const endsWith = (value: string, suffix: string): boolean => value.endsWith(suffix)
export const split = (value: string, separator: string): string[] => value.split(separator)

export function replaceAll(value: string, needle: string, replacement: string): string {
  if (needle === '') return value
  return value.split(needle).join(replacement)
}

export function sanitizeId(value: string): string {
  let out = ''
  for (const char of value) {
    out += /[A-Za-z0-9_.-]/.test(char) ? char : '-'
  }
  return out
}

const REPLACEMENT = '\uFFFD'

/** Thay các chuỗi byte không hợp lệ bằng U+FFFD (giống sanitize_utf8 bản C++). */
export function sanitizeUtf8(value: string | Buffer): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  let index = 0
  let out = ''
  while (index < buffer.length) {
    const lead = buffer[index] as number
    if (lead < 0x80) {
      out += String.fromCharCode(lead)
      index += 1
      continue
    }
    let length = 0
    let codepoint = 0
    if ((lead & 0xe0) === 0xc0) {
      length = 2
      codepoint = lead & 0x1f
    } else if ((lead & 0xf0) === 0xe0) {
      length = 3
      codepoint = lead & 0x0f
    } else if ((lead & 0xf8) === 0xf0) {
      length = 4
      codepoint = lead & 0x07
    }
    let valid = length > 0 && index + length <= buffer.length
    for (let offset = 1; valid && offset < length; offset += 1) {
      const next = buffer[index + offset] as number
      if ((next & 0xc0) !== 0x80) {
        valid = false
        break
      }
      codepoint = ((codepoint << 6) | (next & 0x3f)) >>> 0
    }
    if (valid) {
      if (length === 2 && codepoint < 0x80) valid = false
      else if (length === 3 && (codepoint < 0x800 || (codepoint >= 0xd800 && codepoint <= 0xdfff)))
        valid = false
      else if (length === 4 && (codepoint < 0x10000 || codepoint > 0x10ffff)) valid = false
    }
    if (valid) {
      out += String.fromCodePoint(codepoint)
      index += length
    } else {
      out += REPLACEMENT
      index += 1
    }
  }
  return out
}

export function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes <= maxBytes) return value
  const buffer = Buffer.from(value, 'utf8')
  let cut = maxBytes
  while (cut > 0 && ((buffer[cut] as number) & 0xc0) === 0x80) cut -= 1
  return buffer.subarray(0, cut).toString('utf8')
}

export function utf8Suffix(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes <= maxBytes) return value
  const buffer = Buffer.from(value, 'utf8')
  let start = bytes - maxBytes
  while (start < bytes && ((buffer[start] as number) & 0xc0) === 0x80) start += 1
  return buffer.subarray(start).toString('utf8')
}

export function jsonDumpSafe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return '{}'
  }
}

/* ------------------------------------------------------------------------ đường dẫn */
export const toPosix = (path: string): string => path.replace(/\\/g, '/')

export function pathJoin(a: string, b: string): string {
  if (a === '') return b
  if (b === '') return a
  if (b.startsWith('/')) return b
  return `${a}/${b}`
}

export function basename(path: string): string {
  let clean = toPosix(path)
  while (clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1)
  const position = clean.lastIndexOf('/')
  return position === -1 ? clean : clean.slice(position + 1)
}

export function dirname(path: string): string {
  const clean = toPosix(path)
  const position = clean.lastIndexOf('/')
  if (position === -1) return '.'
  if (position === 0) return '/'
  return clean.slice(0, position)
}

export function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '.'
}

export function envOr(key: string, fallback = ''): string {
  const value = process.env[key]
  return value && value.length > 0 ? value : fallback
}

export function exeDir(): string {
  try {
    return pathDirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
}

/* ------------------------------------------------------------------------ file I/O */
export function readFileSync(path: string, maxBytes = 16 * 1024 * 1024): string {
  if (maxBytes === 0) return ''
  let fd: number | undefined
  try {
    const size = existsSync(path) ? statSync(path).size : 0
    const budget = Math.min(maxBytes, size)
    if (budget <= 0) return ''
    fd = openSync(path, 'r')
    const chunks: Buffer[] = []
    let remaining = budget
    const chunk = Buffer.allocUnsafe(Math.min(65536, Math.max(1, remaining)))
    while (remaining > 0) {
      const got = readSync(fd, chunk, 0, Math.min(chunk.length, remaining), null)
      if (got <= 0) break
      chunks.push(Buffer.from(chunk.subarray(0, got)))
      remaining -= got
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

export function ensureDirectory(path: string): boolean {
  if (path === '') return true
  try {
    mkdirSync(path, { recursive: true })
    return true
  } catch {
    return false
  }
}

export function writeFileAtomic(path: string, content: string): boolean {
  ensureDirectory(dirname(path))
  const temporary = `${path}.nexus-tmp-${randomHex(6)}`
  try {
    writeFileSync(temporary, content, 'utf8')
    renameSync(temporary, path)
    return true
  } catch {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // ignore
    }
    return false
  }
}

export function fileExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function fileMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/* -------------------------------------------------------------------- mã hoá & băm */
export const sha256Hex = (data: string): string =>
  createHash('sha256').update(data, 'utf8').digest('hex')

export const hexEncode = (data: string | Buffer): string =>
  Buffer.from(data as string, 'binary').toString('hex')

export function hexDecode(data: string): string {
  if (data.length % 2 !== 0) return ''
  return Buffer.from(data, 'hex').toString('binary')
}

export const base64Encode = (data: string | Buffer): string =>
  Buffer.from(data as string, 'binary').toString('base64')

export const base64Decode = (data: string): string => Buffer.from(data, 'base64').toString('binary')

export function urlEncode(value: string): string {
  let out = ''
  for (const byte of Buffer.from(value, 'utf8')) {
    if (/[A-Za-z0-9\-_.~]/.test(String.fromCharCode(byte))) {
      out += String.fromCharCode(byte)
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}

export function urlDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

export const jsonEscape = (value: string): string => JSON.stringify(value)

/* ---------------------------------------------------------------------- ngôn ngữ */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.xml': 'xml',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
  '.lua': 'lua',
  '.dart': 'dart',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.ini': 'ini',
  '.env': 'dotenv',
  '.txt': 'text',
  '.svg': 'xml',
  '.graphql': 'graphql',
}

function extensionOf(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export const languageForPath = (path: string): string =>
  LANGUAGE_BY_EXTENSION[extensionOf(path)] ?? 'text'

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hh',
  '.hxx',
  '.cs',
  '.rb',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.lua',
  '.dart',
  '.vue',
  '.svelte',
  '.ini',
  '.env',
  '.txt',
  '.svg',
  '.graphql',
  '.lock',
  '.gitignore',
  '.dockerfile',
  '.make',
  '.cmake',
  '.conf',
  '.properties',
])

export const isTextExtension = (path: string): boolean => TEXT_EXTENSIONS.has(extensionOf(path))

export function isProbablyBinary(data: string | Buffer): boolean {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  const length = Math.min(buffer.length, 1024)
  for (let i = 0; i < length; i += 1) {
    if (buffer[i] === 0) return true
  }
  return false
}

const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  '.DS_Store',
  '.turbo',
  '.parcel-cache',
  'release',
  '.inspect',
])

export const isIgnoredName = (name: string): boolean => IGNORED_NAMES.has(name)

export function splitCommand(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let single = false
  let doubleQuote = false
  for (const char of command) {
    if (char === "'" && !doubleQuote) {
      single = !single
      continue
    }
    if (char === '"' && !single) {
      doubleQuote = !doubleQuote
      continue
    }
    if (/\s/.test(char) && !single && !doubleQuote) {
      if (current.length > 0) {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current.length > 0) parts.push(current)
  return parts
}

/* --------------------------------------------------------------------------- glob */
export function globMatch(pattern: string, text: string): boolean {
  const memo = new Map<string, boolean>()
  const match = (p: number, t: number): boolean => {
    const key = `${p}:${t}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    let result = false
    let pi = p
    let ti = t
    while (pi < pattern.length) {
      const char = pattern[pi] as string
      if (char === '*') {
        const doubleStar = pi + 1 < pattern.length && pattern[pi + 1] === '*'
        const next = pi + (doubleStar ? 2 : 1)
        if (next >= pattern.length) {
          result = true
          break
        }
        result = false
        for (let candidate = ti; candidate <= text.length; candidate += 1) {
          if (match(next, candidate)) {
            result = true
            break
          }
          if (!doubleStar && candidate < text.length && text[candidate] === '/') break
        }
        break
      }
      if (ti >= text.length) {
        result = false
        break
      }
      if (char === '?' || char === text[ti]) {
        pi += 1
        ti += 1
        continue
      }
      result = false
      break
    }
    if (pi >= pattern.length) result = ti === text.length
    memo.set(key, result)
    return result
  }
  return match(0, 0)
}

/* ------------------------------------------------------------------------- JSON */
export function jsonStr(value: unknown, key: string, fallback = ''): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const entry = (value as Record<string, unknown>)[key]
  return typeof entry === 'string' ? entry : fallback
}

export function jsonBool(value: unknown, key: string, fallback = false): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const entry = (value as Record<string, unknown>)[key]
  return typeof entry === 'boolean' ? entry : fallback
}

export function jsonInt(value: unknown, key: string, fallback = 0): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const entry = (value as Record<string, unknown>)[key]
  if (typeof entry !== 'number' || !Number.isFinite(entry)) return fallback
  return Math.trunc(entry)
}

export function jsonDouble(value: unknown, key: string, fallback = 0): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const entry = (value as Record<string, unknown>)[key]
  return typeof entry === 'number' && Number.isFinite(entry) ? entry : fallback
}

export const optString = (value: unknown, key: string): string => jsonStr(value, key, '')

export function readJsonFile(path: string, fallback: JsonValue = {}): JsonValue {
  const content = readFileSync(path, 4 * 1024 * 1024)
  if (!content) return fallback
  try {
    return JSON.parse(content) as JsonValue
  } catch {
    return fallback
  }
}

/* --------------------------------------------------------------------- tiến trình */
export interface ExecResult {
  code: number
  timedOut: boolean
  out: string
  err: string
}

const MAX_OUTPUT = 8 * 1024 * 1024

export function runProcess(
  argv: string[],
  cwd: string,
  timeoutMs = 30_000,
  envExtra: string[] = [],
): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    const result: ExecResult = { code: -1, timedOut: false, out: '', err: '' }
    if (argv.length === 0) {
      result.err = 'missing command'
      resolvePromise(result)
      return
    }
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const entry of envExtra) {
      const separator = entry.indexOf('=')
      if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1)
    }
    let child
    try {
      child = spawn(argv[0] as string, argv.slice(1), {
        cwd: cwd || undefined,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      result.err = error instanceof Error ? error.message : String(error)
      resolvePromise(result)
      return
    }
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      // SIGKILL cả nhóm, giống bản C++ chốt group sau vòng đọc.
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // ignore: nhóm đã thoát
      }
      resolvePromise(result)
    }
    const started = nowMs()
    const timer = setInterval(() => {
      if (nowMs() - started > timeoutMs) {
        result.timedOut = true
        clearInterval(timer)
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
        } catch {
          // ignore
        }
      }
    }, 50)
    timer.unref()
    const append = (chunk: Buffer, target: 'out' | 'err'): void => {
      if (result[target].length >= MAX_OUTPUT) return
      const room = MAX_OUTPUT - result[target].length
      result[target] += chunk.subarray(0, room).toString('utf8')
    }
    child.stdout?.on('data', (chunk: Buffer) => append(chunk, 'out'))
    child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'err'))
    child.on('error', (error) => {
      result.err = error.message
      clearInterval(timer)
      finish()
    })
    child.on('close', (code, signal) => {
      clearInterval(timer)
      if (typeof code === 'number') result.code = code
      else if (signal) result.code = 128
      finish()
    })
  })
}
