import { readdirSync } from 'node:fs'

import { extname, relative, sep } from 'node:path'

import { NexusError } from './errors.ts'
import { httpRequest } from './http.ts'
import { riskName, type Risk } from './security.ts'
import type { Store } from './store.ts'

 
export type Json = any
import { dirname, ensureDirectory, homeDir, isProbablyBinary, isTextExtension, languageForPath, nowIso, nowMs, optString, pathJoin, readFileSync, replaceAll, runProcess, split, startsWith, toLower, trim, urlDecode, urlEncode, writeFileAtomic } from './util.ts'
import type { Workspace } from './workspace.ts'
import type { GitEngine } from './git.ts'

const MAX_PROCESS_OUTPUT = 400000
const MAX_TOOL_FILE = 512 * 1024

const requireString = (input: Json, key: string): string => {
  const value = optString(input, key)
  if (value === '') throw new NexusError('E_VALIDATION', `missing string field \`${key}\``)
  return value
}

const optionalString = (input: Json, key: string, fallback = ''): string => {
  const value = optString(input, key)
  return value === '' ? fallback : value
}

const optionalInt = (input: Json, key: string, fallback: number): number => {
  const raw = input?.[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim() !== '' && /^-?\d+$/.test(raw.trim())) {
    return Math.trunc(Number(raw))
  }
  return fallback
}

const optionalBool = (input: Json, key: string, fallback = false): boolean =>
  typeof input?.[key] === 'boolean' ? input[key] : fallback

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const requireWorkspace = (context: ToolContext): Workspace => {
  if (!context.workspace) throw new NexusError('E_CONFIG', 'No workspace is open for this task')
  return context.workspace
}

const requireGit = (context: ToolContext): GitEngine => {
  if (!context.git) throw new NexusError('E_CONFIG', 'No git repository is available for this task')
  return context.git
}

const requireProcesses = (context: ToolContext): ProcessManager => {
  if (!context.processes) throw new NexusError('E_CONFIG', 'Process manager is unavailable')
  return context.processes
}

const contentLines = (content: string): string[] => {
  if (content === '') return []
  const lines = split(content, '\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

const joinLines = (lines: string[]): string => lines.join('\n')

/** LCS length để tính +added/-removed; cap 2000 dòng mỗi bên giống bản C++. */
function lineDelta(before: string, after: string): [number, number] {
  const left = contentLines(before)
  const right = contentLines(after)
  if (left.length > 2000 || right.length > 2000) {
    return [right.length, left.length]
  }
  let previous = new Array<number>(right.length + 1).fill(0)
  let current = new Array<number>(right.length + 1).fill(0)
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) current[j] = (previous[j - 1] as number) + 1
      else current[j] = Math.max(previous[j] as number, current[j - 1] as number)
    }
    ;[previous, current] = [current, previous]
    current.fill(0)
  }
  const common = previous[right.length] as number
  return [right.length - common, left.length - common]
}

const recordChange = (
  context: ToolContext,
  path: string,
  type: string,
  before: string | undefined,
  after: string | undefined,
): void => {
  const [added, removed] = lineDelta(before ?? '', after ?? '')
  const change: Record<string, Json> = {
    path,
    changeType: type,
    addedLines: added,
    removedLines: removed,
  }
  if (before !== undefined) change['beforeContent'] = before
  if (after !== undefined) change['afterContent'] = after
  context.changes.push(change)
}

interface ExecCommandResult {
  code: number
  timedOut: boolean
  out: string
  err: string
}

const commandResult = (
  command: string,
  result: ExecCommandResult,
  durationMs: number,
): Json => ({
  command,
  exitCode: result.code,
  timedOut: result.timedOut,
  durationMs,
  stdout: result.out,
  stderr: result.err,
})

const runShell = (command: string, cwd: string, timeoutMs: number): Promise<ExecCommandResult> =>
  runProcess(['/bin/bash', '-lc', command], cwd, timeoutMs)

interface StackInfo {
  packageManager: string
  scripts: Json
  hasTsconfig: boolean
  hasCargo: boolean
  hasGo: boolean
  hasPython: boolean
  hasVitest: boolean
  hasEslint: boolean
  packageName: string
  packageMeta: Json
}

/** Đọc package.json của workspace; mọi lỗi parse đều nuốt để giống bản C++. */
const detectStack = (workspace: Workspace): StackInfo => {
  const stack: StackInfo = {
    packageManager: '',
    scripts: {},
    hasTsconfig: false,
    hasCargo: false,
    hasGo: false,
    hasPython: false,
    hasVitest: false,
    hasEslint: false,
    packageName: '',
    packageMeta: null,
  }
  let packageContent = ''
  if (workspace.exists('package.json')) {
    packageContent = workspace.readFile('package.json').content
  }
  if (packageContent !== '') {
    try {
      const packageJson = JSON.parse(packageContent) as Json
      if (packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson)) {
        stack.packageName = jsonString(packageJson, 'name')
        if (packageJson['scripts'] !== null && typeof packageJson['scripts'] === 'object') {
          stack.scripts = packageJson['scripts']
        }
        for (const section of ['dependencies', 'devDependencies']) {
          const deps = packageJson[section]
          if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue
          for (const key of Object.keys(deps)) {
            if (key === 'vitest') stack.hasVitest = true
            if (key === 'eslint') stack.hasEslint = true
          }
        }
        stack.packageMeta = packageJson
      }
    } catch {
      // bỏ qua package.json hỏng
    }
  }
  if (packageContent !== '') {
    if (workspace.exists('pnpm-lock.yaml')) stack.packageManager = 'pnpm'
    else if (workspace.exists('yarn.lock')) stack.packageManager = 'yarn'
    else if (workspace.exists('bun.lockb') || workspace.exists('bun.lock')) stack.packageManager = 'bun'
    else if (workspace.exists('package-lock.json')) stack.packageManager = 'npm'
    else if (workspace.exists('pnpm-workspace.yaml')) stack.packageManager = 'pnpm'
    else stack.packageManager = 'npm'
  }
  stack.hasTsconfig = workspace.exists('tsconfig.json')
  stack.hasCargo = workspace.exists('Cargo.toml')
  stack.hasGo = workspace.exists('go.mod')
  stack.hasPython =
    workspace.exists('pyproject.toml') ||
    workspace.exists('requirements.txt') ||
    workspace.exists('pytest.ini')
  if (workspace.exists('vitest.config.ts') || workspace.exists('vitest.config.js')) stack.hasVitest = true
  if (
    workspace.exists('eslint.config.js') ||
    workspace.exists('eslint.config.mjs') ||
    workspace.exists('.eslintrc') ||
    workspace.exists('.eslintrc.json')
  ) {
    stack.hasEslint = true
  }
  return stack
}

const jsonString = (value: Json, key: string): string =>
  typeof value?.[key] === 'string' ? (value[key] as string) : ''

const packagePrefix = (manager: string): string => {
  if (manager === 'pnpm') return 'pnpm '
  if (manager === 'yarn') return 'yarn '
  if (manager === 'bun') return 'bun '
  return 'npm '
}

const detectTestCommand = (workspace: Workspace, stack: StackInfo): string => {
  void workspace
  let script = ''
  if (
    stack.scripts !== null &&
    typeof stack.scripts === 'object' &&
    typeof stack.scripts['test'] === 'string'
  ) {
    script = stack.scripts['test']
  }
  if (script !== '' && !toLower(script).includes('no test specified')) {
    if (stack.packageManager === 'npm') return 'npm test'
    if (stack.packageManager === 'yarn') return 'yarn test'
    if (stack.packageManager === 'bun') return 'bun run test'
    return 'pnpm test'
  }
  if (stack.hasVitest) return `${packagePrefix(stack.packageManager)}exec vitest run`
  if (stack.hasCargo) return 'cargo test'
  if (stack.hasGo) return 'go test ./...'
  if (stack.hasPython) return 'python3 -m pytest -q'
  throw new NexusError('E_CONFIG', 'No test runner detected. Provide an explicit command or add a test script.')
}

const detectBuildCommand = (workspace: Workspace, stack: StackInfo): string => {
  void workspace
  let script = ''
  if (
    stack.scripts !== null &&
    typeof stack.scripts === 'object' &&
    typeof stack.scripts['build'] === 'string'
  ) {
    script = stack.scripts['build']
  }
  if (script !== '') {
    if (stack.packageManager === 'npm') return 'npm run build'
    if (stack.packageManager === 'yarn') return 'yarn build'
    if (stack.packageManager === 'bun') return 'bun run build'
    return 'pnpm run build'
  }
  if (stack.hasCargo) return 'cargo build'
  if (stack.hasGo) return 'go build ./...'
  if (stack.hasTsconfig) return `${packagePrefix(stack.packageManager)}exec tsc --noEmit`
  throw new NexusError('E_CONFIG', 'No build command detected. Provide an explicit command.')
}

function parseDiagnostics(text: string, kind: string): Json[] {
  const diagnostics: Json[] = []
  const safeInt = (value: string): number => {
    const parsed = parseInt(value, 10)
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed
  }
  const primary = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+)?:?\s+(.+)$/gm
  let match: RegExpExecArray | null = primary.exec(text)
  while (match !== null) {
    diagnostics.push({
      file: match[1] as string,
      line: safeInt(match[2] as string),
      column: safeInt(match[3] as string),
      severity: match[4] as string,
      code: match[5] ?? '',
      message: trim(match[6] as string),
    })
    match = primary.exec(text)
  }
  if (diagnostics.length === 0) {
    const alternative = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm
    let altMatch: RegExpExecArray | null = alternative.exec(text)
    while (altMatch !== null) {
      diagnostics.push({
        file: altMatch[1] as string,
        line: safeInt(altMatch[2] as string),
        column: safeInt(altMatch[3] as string),
        severity: altMatch[4] as string,
        code: altMatch[5] as string,
        message: trim(altMatch[6] as string),
      })
      altMatch = alternative.exec(text)
    }
  }
  if (diagnostics.length === 0 && kind === 'eslint') {
    const eslintPattern = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)$/gm
    let eslintMatch: RegExpExecArray | null = eslintPattern.exec(text)
    while (eslintMatch !== null) {
      diagnostics.push({
        file: '',
        line: safeInt(eslintMatch[1] as string),
        column: safeInt(eslintMatch[2] as string),
        severity: eslintMatch[3] as string,
        code: eslintMatch[5] as string,
        message: trim(eslintMatch[4] as string),
      })
      eslintMatch = eslintPattern.exec(text)
    }
  }
  return diagnostics
}

function stripHtml(html: string): string {
  const withoutBlocks = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  let text = withoutBlocks.replace(/<[^>]+>/g, ' ')
  text = replaceAll(text, '&amp;', '&')
  text = replaceAll(text, '&lt;', '<')
  text = replaceAll(text, '&gt;', '>')
  text = replaceAll(text, '&quot;', '"')
  text = replaceAll(text, '&#39;', "'")
  text = replaceAll(text, '&nbsp;', ' ')
  let collapsed = ''
  let space = false
  for (const c of text) {
    if (/\s/.test(c)) {
      if (collapsed !== '' && !space) collapsed += ' '
      space = true
    } else {
      collapsed += c
      space = false
    }
  }
  return trim(collapsed)
}

const isPrivateIPv4 = (a: number, b: number): boolean => {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function safePublicUrl(url: string): boolean {
  const lower = toLower(url)
  let schemeEnd = 0
  if (startsWith(lower, 'https://')) schemeEnd = 8
  else if (startsWith(lower, 'http://')) schemeEnd = 7
  else return false

  let authority = url.slice(schemeEnd)
  const authorityEnd = authority.search(/[/?#]/)
  if (authorityEnd !== -1) authority = authority.slice(0, authorityEnd)

  const at = authority.lastIndexOf('@')
  if (at !== -1) authority = authority.slice(at + 1)

  let host = ''
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    if (close === -1) return false
    host = authority.slice(1, close)
    const rest = authority.slice(close + 1)
    if (rest !== '' && (!rest.startsWith(':') || !/^:\d+$/.test(rest))) return false
  } else {
    const colon = authority.lastIndexOf(':')
    if (colon !== -1) {
      if (authority.indexOf(':') !== colon) return false
      const port = authority.slice(colon + 1)
      if (port === '' || !/^\d+$/.test(port)) return false
      authority = authority.slice(0, colon)
    }
    host = authority
  }
  host = toLower(host)
  while (host.endsWith('.')) host = host.slice(0, -1)
  const zone = host.indexOf('%')
  if (zone !== -1) host = host.slice(0, zone)
  if (host === '') return false

  if (
    host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '::' ||
    host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')
  ) {
    return false
  }

  if (host.includes(':')) {
    if (host.startsWith('::ffff:')) {
      host = host.slice(7)
    } else {
      if (
        host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') ||
        host.startsWith('ff')
      ) {
        return false
      }
      return true
    }
  }

  if (/^(?:0x[0-9a-f]+|[0-9]+)$/.test(host)) {
    let value: number
    try {
      value = host.startsWith('0x') ? parseInt(host.slice(2), 16) : parseInt(host, 10)
    } catch {
      return false
    }
    if (!Number.isFinite(value) || value > 0xffffffff) return false
    const ip = value >>> 0
    return !isPrivateIPv4((ip >>> 24) & 0xff, (ip >>> 16) & 0xff)
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    const c = Number(ipv4[3])
    const d = Number(ipv4[4])
    if (a > 255 || b > 255 || c > 255 || d > 255) return false
    return !isPrivateIPv4(a, b)
  }
  return true
}

interface Skill {
  id: string
  name: string
  description: string
  scope: string
  path: string
  body: string
  version: number
}

const parseFrontmatter = (raw: string): [Record<string, string>, string] => {
  const meta: Record<string, string> = {}
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return [meta, raw]
  const header = match[1] as string
  for (const line of split(header, '\n')) {
    const separator = line.indexOf(':')
    if (separator === -1 || separator === 0) continue
    const key = toLower(trim(line.slice(0, separator)))
    let value = trim(line.slice(separator + 1))
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, value.length - 1)
    }
    if (key !== '' && value !== '') meta[key] = value
  }
  return [meta, raw.slice(match[0].length)]
}

const discoverSkills = (workspace: Workspace): Skill[] => {
  const skills: Skill[] = []
  const seen = new Set<string>()
  const scan = (directory: string, scope: string): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const extension = toLower(extname(entry.name))
      if (extension !== '.md' && extension !== '.markdown') continue
      const absolutePath = pathJoin(directory, entry.name)
      const raw = readFileSync(absolutePath, 400000)
      if (raw === '') continue
      const [meta, body] = parseFrontmatter(raw)
      const id = trim(meta['id'] ?? meta['name'] ?? entry.name.slice(0, entry.name.length - extname(entry.name).length))
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      const skill: Skill = {
        id,
        name: meta['name'] ?? id,
        description: meta['description'] ?? trim(split(body, '\n')[0] ?? '').slice(0, 160),
        scope,
        path: absolutePath,
        body,
        version: 1,
      }
      const version = meta['version']
      if (version !== undefined) {
        const parsed = parseInt(version, 10)
        if (!Number.isNaN(parsed)) skill.version = parsed
      }
      skills.push(skill)
    }
  }
  scan(pathJoin(workspace.rootPath, '.nexus/skills'), 'project')
  scan(pathJoin(homeDir(), '.nexus/skills'), 'global')
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

const slugify = (value: string): string => {
  let out = ''
  let dash = false
  for (const c of toLower(value)) {
    if (/[a-z0-9]/.test(c)) {
      out += c
      dash = false
    } else if (out !== '' && !dash) {
      out += '-'
      dash = true
    }
  }
  while (out.endsWith('-')) out = out.slice(0, -1)
  return out
}

type SymbolPatternList = Array<[RegExp, string]>

const SYMBOL_PATTERNS: Record<string, SymbolPatternList> = {
  ts: [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'function'],
    [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
    [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, 'type'],
    [/^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'enum'],
    [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 'function'],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 'variable'],
  ],
  py: [
    [/^\s*(?:async\s+)?def\s+(\w+)/, 'function'],
    [/^\s*class\s+(\w+)/, 'class'],
  ],
  go: [
    [/^\s*func\s+(?:\([^)]*\)\s*)?(\w+)/, 'function'],
    [/^\s*type\s+(\w+)/, 'type'],
  ],
  rs: [
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, 'function'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/, 'struct'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/, 'enum'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/, 'trait'],
  ],
  cpp: [
    [/^\s*(?:class|struct|enum(?:\s+class)?)\s+(\w+)/, 'type'],
    [/^\s*(?:[\w:<>~*&]+\s+)+\**(\w+)\s*\([^;]*\)\s*(?:const)?\s*\{?/, 'function'],
  ],
  managed: [
    [/^\s*(?:public|private|protected|internal|static|final|abstract|open|sealed|\s)*\s*(?:class|interface|enum|struct|object)\s+(\w+)/, 'type'],
    [/^\s*(?:public|private|protected|internal|static|final|abstract|override|suspend|\s)+\s*(?:[\w<>[\],?]+\s+)(\w+)\s*\(/, 'function'],
  ],
  ruby: [
    [/^\s*def\s+(\w+[?!=]?)/, 'function'],
    [/^\s*(?:class|module)\s+(\w+)/, 'type'],
  ],
}

const symbolPatternsFor = (extension: string): SymbolPatternList => {
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return SYMBOL_PATTERNS['ts'] as SymbolPatternList
  if (extension === '.py') return SYMBOL_PATTERNS['py'] as SymbolPatternList
  if (extension === '.go') return SYMBOL_PATTERNS['go'] as SymbolPatternList
  if (extension === '.rs') return SYMBOL_PATTERNS['rs'] as SymbolPatternList
  if (['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'].includes(extension)) {
    return SYMBOL_PATTERNS['cpp'] as SymbolPatternList
  }
  if (['.java', '.kt', '.cs', '.swift'].includes(extension)) return SYMBOL_PATTERNS['managed'] as SymbolPatternList
  if (extension === '.rb') return SYMBOL_PATTERNS['ruby'] as SymbolPatternList
  return []
}

const extractSymbols = (path: string, content: string): Json[] => {
  const symbols: Json[] = []
  const extension = toLower(extname(path))
  const patterns = symbolPatternsFor(extension)
  const blocked = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'new', 'delete'])
  let lineNumber = 1
  for (const line of split(content, '\n')) {
    for (const [pattern, kind] of patterns) {
      const match = pattern.exec(line)
      if (match && match[1]) {
        const name = match[1]
        if (blocked.has(name)) continue
        if (symbols.length >= 60) return symbols
        symbols.push({ name, kind, line: lineNumber })
        break
      }
    }
    lineNumber += 1
  }
  return symbols
}

const countImports = (content: string): number => {
  let count = 0
  for (const line of split(content, '\n')) {
    const trimmed = trim(line)
    if (
      startsWith(trimmed, 'import ') || startsWith(trimmed, 'from ') ||
      startsWith(trimmed, '#include') || startsWith(trimmed, 'use ') ||
      startsWith(trimmed, 'require(') || startsWith(trimmed, 'using ')
    ) {
      count += 1
    }
  }
  return count
}

import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { uuid } from './util.ts'

const toSlash = (path: string): string => path.split(sep).join('/')
const rmSyncPath = (target: string): void => { rmSync(target, { force: true }) }

/** Process theo thời gian thực: spawn + buffer stdout/stderr (cap 400k), kill group khi stop. */
export class ProcessManager {
  private entries = new Map<string, { id: string; command: string; cwd: string; child: ChildProcess; output: string; running: boolean; exitCode: number | null }>()

  start(command: string, cwd: string): Json {
    if (trim(command) === '') throw new NexusError('E_VALIDATION', 'Command is required')
    let child: ChildProcess
    try {
      child = spawn('/bin/bash', ['-lc', command], {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      throw new NexusError('E_TERMINAL', error instanceof Error ? error.message : String(error))
    }
    const entry = {
      id: uuid(),
      command,
      cwd,
      child,
      output: '',
      running: true,
      exitCode: -1 as number | null,
    }
    this.entries.set(entry.id, entry)
    const appendOutput = (chunk: Buffer): void => {
      entry.output += chunk.toString('utf8')
      if (entry.output.length > MAX_PROCESS_OUTPUT) {
        entry.output = entry.output.slice(entry.output.length - MAX_PROCESS_OUTPUT)
      }
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)
    child.on('error', () => {
      entry.running = false
      entry.exitCode = 127
    })
    child.on('exit', (code: number | null) => {
      entry.running = false
      entry.exitCode = typeof code === 'number' ? code : 1
    })
    return { id: entry.id, pid: child.pid ?? -1, command, cwd }
  }

  output(id: string): Json {
    const entry = this.entries.get(id)
    if (!entry) throw new NexusError('E_TERMINAL', `Process ${id} not found`)
    return {
      id,
      running: entry.running,
      exitCode: entry.running ? null : entry.exitCode,
      output: entry.output,
    }
  }

  /** C++ ngăn cache `entries_` bị xoá? stop rồi output vẫn đọc được output cuối. */
  stop(id: string): Json {
    const entry = this.entries.get(id)
    if (!entry) throw new NexusError('E_TERMINAL', `Process ${id} not found`)
    if (entry.running) {
      try {
        if (entry.child.pid !== undefined) process.kill(-entry.child.pid, 'SIGTERM')
      } catch {
        entry.child.kill('SIGTERM')
      }
      setTimeout(() => {
        try {
          if (entry.child.pid !== undefined) process.kill(-entry.child.pid, 'SIGKILL')
        } catch {
          try {
            entry.child.kill('SIGKILL')
          } catch {
            // process đã thoát
          }
        }
      }, 80).unref()
      entry.running = false
      entry.exitCode = entry.exitCode ?? 137
    }
    return { id, running: false }
  }

  disposeAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.running && entry.child.pid !== undefined) {
        try {
          process.kill(-entry.child.pid, 'SIGKILL')
        } catch {
          try {
            entry.child.kill('SIGKILL')
          } catch {
            // đã thoát
          }
        }
        entry.running = false
      }
    }
    this.entries.clear()
  }
}

/** McpManager interface để tránh circular dependency; core gọi đúng các method của bản C++. */
export interface ToolMcp {
  listServers(): Promise<Json[]>
  listTools(serverId?: string): Promise<Json[]>
  call(serverId: string, tool: string, argumentsValue: Json): Promise<Json>
}

export interface ToolContext {
  store: Store
  workspace?: Workspace | null
  git?: GitEngine | null
  processes?: ProcessManager | null
  sessionId: string
  taskId: string
  projectId: string
  mcp?: ToolMcp | null
  changes: Json[]
}

export interface ToolDefinition {
  name: string
  description: string
  risk: Risk
  parameters: Json
  execute: (input: Json, context: ToolContext) => Promise<Json> | Json
  summarize?: (input: Json) => string
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  private static readonly instance = new ToolRegistry()

  static standard(): ToolRegistry {
    return ToolRegistry.instance
  }

  private constructor() {
    this.registerTools()
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  list(): Json[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: riskName(tool.risk),
    }))
  }

  schemas(): Json[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
  }

  async execute(name: string, input: Json, context: ToolContext): Promise<Json> {
    const tool = this.tools.get(name)
    if (!tool) throw new NexusError('E_TOOL', `Tool not allowed: ${name}`)
    return tool.execute(input, context)
  }

  summarize(name: string, input: Json): string {
    const tool = this.tools.get(name)
    if (!tool || !tool.summarize) return name
    return tool.summarize(input)
  }

  private add(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition)
  }

  private registerTools(): void {
    this.add({
      name: 'read_file',
      description:
        'Read a text file from the workspace. For large files pass offset (1-based first line) and limit (max lines) to read a slice instead of the whole file.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer', description: '1-based line to start from' },
          limit: { type: 'integer', description: 'maximum number of lines to return' },
        },
        required: ['path'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const path = requireString(input, 'path')
        const info = workspace.stat(path)
        if (jsonString(info, 'type') === 'directory') {
          return {
            path,
            type: 'directory',
            tree: workspace.tree(path, 1),
            hint: 'Use list_directory/list_files for deeper traversal.',
          }
        }
        const result = workspace.readFile(path)
        let content = result.content
        const countLines = (text: string): number => split(text, '\n').length - (text.endsWith('\n') ? 1 : 0)
        const totalLines = countLines(content) + (content === '' ? 0 : 1)
        void totalLines
        const totalRaw = split(content, '\n').length
        const offset = Math.max(optionalInt(input, 'offset', 1), 1)
        const limitLines = Math.max(optionalInt(input, 'limit', 0), 0)
        const sliced = offset > 1 || limitLines > 0
        const startLine = Math.min(offset, totalRaw)
        let endLine = totalRaw
        if (sliced) {
          const lines = split(content, '\n')
          const sliceStart = Math.min(startLine - 1, lines.length)
          const sliceEnd = limitLines > 0 ? Math.min(sliceStart + limitLines, lines.length) : lines.length
          const windowLines = lines.slice(sliceStart, sliceEnd)
          content = joinLines(windowLines)
          endLine = startLine + windowLines.length - 1
        }
        return {
          content,
          language: result.language,
          size: result.size,
          truncated: result.truncated || sliced,
          startLine,
          endLine,
          totalLines: totalRaw,
          mtimeMs: result.mtimeMs,
        }
      },
      summarize: (input) => `read ${optionalString(input, 'path')}`,
    })

    this.add({
      name: 'write_file',
      description: 'Create or overwrite a text file inside the workspace.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const result = workspace.writeFile(requireString(input, 'path'), requireString(input, 'content'))
        recordChange(context, result.path, result.created ? 'create' : 'modify', result.before, input['content'])
        return { path: result.path, size: result.size, created: result.created }
      },
      summarize: (input) => `write ${optionalString(input, 'path')}`,
    })

    this.add({
      name: 'edit_file',
      description: 'Replace an exact text fragment in a file. Use replaceAll to change every occurrence.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          oldText: { type: 'string' },
          newText: { type: 'string' },
          replaceAll: { type: 'boolean' },
        },
        required: ['path', 'oldText', 'newText'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const path = requireString(input, 'path')
        const oldText = requireString(input, 'oldText')
        const newText = jsonString(input, 'newText')
        const replaceEvery = optionalBool(input, 'replaceAll')
        const existing = workspace.readFile(path)
        const position = existing.content.indexOf(oldText)
        if (position === -1) throw new NexusError('E_TOOL', `Text to replace was not found in ${path}`)
        const next = replaceEvery
          ? replaceAll(existing.content, oldText, newText)
          : existing.content.slice(0, position) + newText + existing.content.slice(position + oldText.length)
        const result = workspace.writeFile(path, next)
        recordChange(context, result.path, 'modify', existing.content, next)
        return { path: result.path, size: result.size }
      },
      summarize: (input) => `edit ${optionalString(input, 'path')}`,
    })

    this.add({
      name: 'delete_file',
      description: 'Delete a file or directory inside the workspace.',
      risk: 'destructive',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const path = requireString(input, 'path')
        let before: string | undefined
        try {
          before = workspace.readFile(path).content
        } catch {
          before = undefined
        }
        workspace.remove(path)
        recordChange(context, path, 'delete', before, undefined)
        return { deleted: path }
      },
      summarize: (input) => `delete ${optionalString(input, 'path')}`,
    })

    const moveTool = (name: string, description: string): void => {
      this.add({
        name,
        description,
        risk: 'write',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
          required: ['from', 'to'],
        },
        execute: (input, context) => {
          const workspace = requireWorkspace(context)
          const from = requireString(input, 'from')
          const to = requireString(input, 'to')
          let before: string | undefined
          try {
            before = workspace.readFile(from).content
          } catch {
            before = undefined
          }
          const node = workspace.rename(from, to)
          let after: string | undefined
          try {
            after = workspace.readFile(to).content
          } catch {
            after = undefined
          }
          recordChange(context, to, 'rename', before, after)
          return node
        },
        summarize: (input) =>
          `move ${optionalString(input, 'from')} → ${optionalString(input, 'to')}`,
      })
    }
    moveTool('rename_file', 'Rename a file or directory inside the workspace.')
    moveTool('move_file', 'Move a file or directory inside the workspace.')

    this.add({
      name: 'copy_file',
      description: 'Copy a text file inside the workspace.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const source = workspace.readFile(requireString(input, 'from'))
        const result = workspace.writeFile(requireString(input, 'to'), source.content)
        recordChange(context, result.path, result.created ? 'create' : 'modify', result.before, source.content)
        return { path: result.path, bytes: result.size }
      },
      summarize: (input) => `copy ${optionalString(input, 'from')}`,
    })

    this.add({
      name: 'create_directory',
      description: 'Create a directory inside the workspace.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      execute: (input, context) => {
        return requireWorkspace(context).createDir(requireString(input, 'path'))
      },
      summarize: (input) => `mkdir ${optionalString(input, 'path')}`,
    })

    this.add({
      name: 'list_directory',
      description: 'List a directory tree inside the workspace.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          depth: { type: 'integer' },
        },
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        return workspace.tree(optionalString(input, 'path'), optionalInt(input, 'depth', 1))
      },
      summarize: (input) => `list ${optionalString(input, 'path', '.')}`,
    })

    this.add({
      name: 'list_files',
      description: 'List files and folders in a workspace directory. Alias of list_directory.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          depth: { type: 'integer' },
        },
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        return workspace.tree(optionalString(input, 'path'), optionalInt(input, 'depth', 1))
      },
      summarize: (input) => `list ${optionalString(input, 'path', '.')}`,
    })

    this.add({
      name: 'get_file_info',
      description: 'Return metadata (type, size, mtime) for a path inside the workspace.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      execute: (input, context) => {
        return requireWorkspace(context).stat(requireString(input, 'path'))
      },
      summarize: (input) => `stat ${optionalString(input, 'path')}`,
    })

    this.add({
      name: 'search_files',
      description: 'Search workspace file paths by substring and return ranked matches.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
      execute: (input, context) => {
        const limit = clamp(optionalInt(input, 'limit', 50), 1, 500)
        return requireWorkspace(context).searchFiles(requireString(input, 'query'), limit)
      },
      summarize: (input) => `find files ${optionalString(input, 'query')}`,
    })

    this.add({
      name: 'search_code',
      description: 'Search text content across workspace source files.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          regex: { type: 'boolean' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
      execute: (input, context) => {
        const limit = clamp(optionalInt(input, 'limit', 60), 1, 500)
        return requireWorkspace(context).searchCode(
          requireString(input, 'query'),
          optionalBool(input, 'regex'),
          limit,
        )
      },
      summarize: (input) => `grep ${optionalString(input, 'query')}`,
    })

    this.add({
      name: 'apply_patch',
      description:
        'Apply a multi-file patch using *** Begin Patch / *** Update File / *** Add File / *** Delete File sections.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: { patch: { type: 'string' } },
        required: ['patch'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        interface Hunk {
          oldText: string
          newText: string
        }
        interface PatchFile {
          kind: string
          path: string
          hunks: Hunk[]
          added: string[]
        }
        const patch = replaceAll(requireString(input, 'patch'), '\r\n', '\n')
        const files: PatchFile[] = []
        let current: PatchFile = { kind: '', path: '', hunks: [], added: [] }
        let active = false
        let inHunk = false
        let oldLines: string[] = []
        let newLines: string[] = []
        let hasHunk = false
        const flushHunk = (): void => {
          if (!active) return
          if (hasHunk) {
            current.hunks.push({ oldText: joinLines(oldLines), newText: joinLines(newLines) })
          }
          oldLines = []
          newLines = []
          hasHunk = false
          inHunk = false
        }
        const flushFile = (): void => {
          flushHunk()
          if (active) files.push(current)
          active = false
        }
        for (const line of split(patch, '\n')) {
          if (line === '*** Begin Patch') continue
          if (line === '*** End Patch') {
            flushFile()
            continue
          }
          if (startsWith(line, '*** Update File: ')) {
            flushFile()
            current = { kind: 'update', path: trim(line.slice(17)), hunks: [], added: [] }
            active = true
            continue
          }
          if (startsWith(line, '*** Add File: ')) {
            flushFile()
            current = { kind: 'add', path: trim(line.slice(14)), hunks: [], added: [] }
            active = true
            continue
          }
          if (startsWith(line, '*** Delete File: ')) {
            flushFile()
            current = { kind: 'delete', path: trim(line.slice(17)), hunks: [], added: [] }
            active = true
            continue
          }
          if (!active) continue
          if (startsWith(line, '@@')) {
            flushHunk()
            inHunk = true
            continue
          }
          if (current.kind === 'add') {
            if (line !== '' && line.startsWith('+')) current.added.push(line.slice(1))
            continue
          }
          if (current.kind === 'delete') continue
          if (!inHunk) {
            if (trim(line) === '') continue
            inHunk = true
            hasHunk = true
          }
          if (line !== '' && line.startsWith('+')) {
            newLines.push(line.slice(1))
          } else if (line !== '' && line.startsWith('-')) {
            oldLines.push(line.slice(1))
          } else if (line !== '' && line.startsWith(' ')) {
            oldLines.push(line.slice(1))
            newLines.push(line.slice(1))
          } else if (trim(line) === '') {
            oldLines.push('')
            newLines.push('')
          } else {
            throw new NexusError('E_VALIDATION', `Invalid patch line: ${line.slice(0, 120)}`)
          }
        }
        flushFile()
        if (files.length === 0) throw new NexusError('E_VALIDATION', 'No file sections found in patch')
        const changed: string[] = []
        for (const file of files) {
          if (file.path === '') throw new NexusError('E_VALIDATION', 'Patch file path is required')
          if (file.kind === 'add') {
            let body = joinLines(file.added)
            if (body !== '') body += '\n'
            const result = workspace.createFile(file.path, body)
            recordChange(context, result['path'] as string, 'create', undefined, body)
            changed.push(`+ ${file.path}`)
            continue
          }
          if (file.kind === 'delete') {
            let before: string | undefined
            try {
              before = workspace.readFile(file.path).content
            } catch {
              before = undefined
            }
            workspace.remove(file.path)
            recordChange(context, file.path, 'delete', before, undefined)
            changed.push(`- ${file.path}`)
            continue
          }
          const existing = workspace.readFile(file.path)
          let next = existing.content
          for (const hunk of file.hunks) {
            if (hunk.oldText === '') throw new NexusError('E_VALIDATION', 'Patch hunk has no context')
            const position = next.indexOf(hunk.oldText)
            if (position === -1) {
              throw new NexusError('E_TOOL', `Patch context not found in ${file.path}`)
            }
            next =
              next.slice(0, position) +
              hunk.newText +
              next.slice(position + hunk.oldText.length)
          }
          const result = workspace.writeFile(file.path, next)
          recordChange(context, result.path, 'modify', existing.content, next)
          changed.push(`~ ${file.path}`)
        }
        return { changed }
      },
      summarize: () => 'apply patch',
    })

    this.add({
      name: 'save_memory',
      description: 'Persist a durable project fact, decision, convention or note for future sessions.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          kind: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          scope: { type: 'string' },
        },
        required: ['content'],
      },
      execute: (input, context) => {
        const entry: Record<string, Json> = {
          kind: jsonString(input, 'kind') || 'fact',
          content: requireString(input, 'content'),
          tags: Array.isArray(input?.['tags']) ? input['tags'] : [],
        }
        const scope = jsonString(input, 'scope') || 'project'
        if (context.projectId === '' || scope === 'user') {
          // no projectId — global memory
        } else {
          entry['projectId'] = context.projectId
        }
        return context.store.memoryCreate(entry)
      },
      summarize: () => 'save memory',
    })

    this.add({
      name: 'search_memory',
      description: 'Search persistent project memory entries.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      execute: (input, context) => {
        const query = toLower(optionalString(input, 'query'))
        const limit = clamp(optionalInt(input, 'limit', 20), 1, 200)
        const memories = context.store.memoryList(
          context.projectId === '' ? undefined : context.projectId,
          limit * 3,
        )
        const matches: Json[] = []
        for (const memory of memories) {
          const content = toLower(typeof memory?.['content'] === 'string' ? memory['content'] : '')
          if (query === '' || content.includes(query)) {
            matches.push(memory)
            if (matches.length >= limit) break
          }
        }
        return { memories: matches }
      },
      summarize: () => 'search memory',
    })

    this.add({
      name: 'delete_memory',
      description: 'Delete a memory entry by id.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: (input, context) => {
        context.store.memoryRemove(requireString(input, 'id'))
        return { removed: true }
      },
      summarize: (input) => `delete memory ${optionalString(input, 'id')}`,
    })

    this.add({
      name: 'list_skills',
      description: 'List project and global skills from .nexus/skills.',
      risk: 'read',
      parameters: { type: 'object', properties: {} },
      execute: (_input, context) => {
        const skills = discoverSkills(requireWorkspace(context))
        return {
          skills: skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            scope: skill.scope,
            path: skill.path,
          })),
        }
      },
      summarize: () => 'list skills',
    })

    this.add({
      name: 'load_skill',
      description: 'Load the full instructions of a skill by id.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: (input, context) => {
        const skills = discoverSkills(requireWorkspace(context))
        const id = requireString(input, 'id')
        for (const skill of skills) {
          if (skill.id === id || skill.name === id) {
            return {
              id: skill.id,
              name: skill.name,
              description: skill.description,
              scope: skill.scope,
              instructions: skill.body,
            }
          }
        }
        throw new NexusError('E_TOOL', `Skill not found: ${id}`)
      },
      summarize: (input) => `load skill ${optionalString(input, 'id')}`,
    })

    this.add({
      name: 'create_skill',
      description: 'Create a reusable markdown skill under .nexus/skills or ~/.nexus/skills.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'string' },
          scope: { type: 'string' },
        },
        required: ['name', 'description', 'instructions'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const id = slugify(requireString(input, 'name'))
        if (id === '') throw new NexusError('E_VALIDATION', 'Invalid skill name')
        for (const skill of discoverSkills(workspace)) {
          if (skill.id === id) throw new NexusError('E_TOOL', `Skill already exists: ${id}`)
        }
        const scope = jsonString(input, 'scope') || 'project'
        const body = `---\nid: ${id}\nname: ${requireString(input, 'name')}\ndescription: ${requireString(input, 'description')}\nversion: 1\ncreatedAt: ${nowIso()}\n---\n\n${trim(requireString(input, 'instructions'))}\n`
        if (scope === 'global') {
          const target = pathJoin(pathJoin(homeDir(), '.nexus/skills'), `${id}.md`)
          ensureDirectory(dirname(target))
          writeFileAtomic(target, body)
        } else {
          const result = workspace.createFile(`.nexus/skills/${id}.md`, body)
          recordChange(context, result['path'] as string, 'create', undefined, body)
        }
        return { id, scope }
      },
      summarize: (input) => `create skill ${optionalString(input, 'name')}`,
    })

    this.add({
      name: 'update_skill',
      description: "Update an existing skill's instructions and description.",
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'string' },
        },
        required: ['id', 'instructions'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const skills = discoverSkills(workspace)
        const id = requireString(input, 'id')
        for (const skill of skills) {
          if (skill.id !== id && skill.name !== id) continue
          const description = optionalString(input, 'description') || skill.description
          const body = `---\nid: ${skill.id}\nname: ${skill.name}\ndescription: ${description}\nversion: ${skill.version + 1}\nupdatedAt: ${nowIso()}\n---\n\n${trim(requireString(input, 'instructions'))}\n`
          if (skill.scope === 'global') {
            writeFileAtomic(skill.path, body)
          } else {
            const relativeToRoot = toSlash(relative(workspace.rootPath, skill.path))
            const result = workspace.writeFile(relativeToRoot, body)
            recordChange(context, result.path, 'modify', skill.body, body)
          }
          return { id: skill.id, version: skill.version + 1 }
        }
        throw new NexusError('E_TOOL', `Skill not found: ${id}`)
      },
      summarize: (input) => `update skill ${optionalString(input, 'id')}`,
    })

    this.add({
      name: 'delete_skill',
      description: 'Delete a project or global skill by id.',
      risk: 'destructive',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          scope: { type: 'string' },
        },
        required: ['id'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const skills = discoverSkills(workspace)
        const id = requireString(input, 'id')
        const scope = optionalString(input, 'scope')
        for (const skill of skills) {
          if ((skill.id !== id && skill.name !== id) || (scope !== '' && skill.scope !== scope)) {
            continue
          }
          if (skill.scope === 'global') {
            try {
              rmSyncPath(skill.path)
            } catch {
              // đã mất — coi như đã xoá
            }
          } else {
            const relativeToRoot = toSlash(relative(workspace.rootPath, skill.path))
            workspace.remove(relativeToRoot)
          }
          return { deleted: skill.id }
        }
        throw new NexusError('E_TOOL', `Skill not found: ${id}`)
      },
      summarize: (input) => `delete skill ${optionalString(input, 'id')}`,
    })

    this.add({
      name: 'code_tree',
      description: 'Build a compact code tree with file paths, languages, line counts and imports.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxFiles: { type: 'integer' },
        },
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const maxFiles = clamp(optionalInt(input, 'maxFiles', 400), 1, 2000)
        const prefix = optionalString(input, 'path')
        const files: Json[] = []
        let count = 0
        for (const relativePath of workspace.listFilePaths(5000)) {
          if (count >= maxFiles) break
          if (!isTextExtension(relativePath)) continue
          if (prefix !== '' && !startsWith(relativePath, prefix)) continue
          const content = readFileSync(pathJoin(workspace.rootPath, relativePath), MAX_TOOL_FILE)
          if (isProbablyBinary(content)) continue
          const imports: string[] = []
          for (const line of split(content, '\n')) {
            const trimmed = trim(line)
            if (
              startsWith(trimmed, 'import ') || startsWith(trimmed, '#include') ||
              startsWith(trimmed, 'use ') || startsWith(trimmed, 'require(') ||
              startsWith(trimmed, 'from ')
            ) {
              imports.push(trimmed.slice(0, 200))
              if (imports.length >= 30) break
            }
          }
          files.push({
            path: relativePath,
            language: languageForPath(relativePath),
            lines: contentLines(content).length,
            imports,
          })
          count += 1
        }
        return { files, truncated: count >= maxFiles }
      },
      summarize: () => 'code tree',
    })

    this.add({
      name: 'find_references',
      description: 'Find identifier references across workspace source files.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['symbol'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const symbol = requireString(input, 'symbol')
        const limit = clamp(optionalInt(input, 'limit', 100), 1, 500)
        const escaped = symbol.replace(/[\\^$.*+?()[\]{}|]/g, (c) => `\\${c}`)
        const pattern = new RegExp(`\\b${escaped}\\b`)
        const matches: Json[] = []
        for (const relativePath of workspace.listFilePaths(5000)) {
          if (matches.length >= limit) break
          if (!isTextExtension(relativePath)) continue
          const content = readFileSync(pathJoin(workspace.rootPath, relativePath), MAX_TOOL_FILE)
          if (isProbablyBinary(content)) continue
          const lines = split(content, '\n')
          for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
            if (matches.length >= limit) break
            const line = lines[lineNumber] as string
            const match = pattern.exec(line)
            if (match) {
              matches.push({
                path: relativePath,
                line: lineNumber + 1,
                column: match.index + 1,
                preview: trim(line.slice(0, 240)),
              })
            }
          }
        }
        return { symbol, matches }
      },
      summarize: (input) => `references ${optionalString(input, 'symbol')}`,
    })

    this.add({
      name: 'execute_command',
      description: 'Run a shell command in the workspace and wait for it to finish.',
      risk: 'exec',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
        required: ['command'],
      },
      execute: async (input, context) => {
        const workspace = requireWorkspace(context)
        let cwd = workspace.rootPath
        const relativeCwd = optionalString(input, 'cwd')
        if (relativeCwd !== '') cwd = workspace.resolve(relativeCwd)[0]
        const command = requireString(input, 'command')
        const timeout = clamp(optionalInt(input, 'timeoutMs', 180000), 1000, 600000)
        const started = nowMs()
        const result = await runShell(command, cwd, timeout)
        return commandResult(command, result, nowMs() - started)
      },
      summarize: (input) => `$ ${optionalString(input, 'command')}`,
    })

    this.add({
      name: 'start_process',
      description: 'Start a long-running background process in the workspace.',
      risk: 'exec',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
        },
        required: ['command'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        let cwd = workspace.rootPath
        const relativeCwd = optionalString(input, 'cwd')
        if (relativeCwd !== '') cwd = workspace.resolve(relativeCwd)[0]
        return requireProcesses(context).start(requireString(input, 'command'), cwd)
      },
      summarize: (input) => `start ${optionalString(input, 'command')}`,
    })

    this.add({
      name: 'get_process_output',
      description: 'Read buffered output from a background process.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tailLines: { type: 'integer' },
        },
        required: ['id'],
      },
      execute: (input, context) => {
        const info = requireProcesses(context).output(requireString(input, 'id'))
        const lines = clamp(optionalInt(input, 'tailLines', 200), 1, 2000)
        const all = contentLines(typeof info['output'] === 'string' ? info['output'] : '')
        const tail = all.length > lines ? all.slice(all.length - lines) : all
        return { ...info, output: joinLines(tail) }
      },
      summarize: (input) => `output ${optionalString(input, 'id')}`,
    })

    this.add({
      name: 'stop_process',
      description: 'Stop a background process started with start_process.',
      risk: 'exec',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: (input, context) => requireProcesses(context).stop(requireString(input, 'id')),
      summarize: (input) => `stop ${optionalString(input, 'id')}`,
    })

    this.add({
      name: 'run_tests',
      description: 'Run the project test suite, detecting the runner when no command is given.',
      risk: 'exec',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
      },
      execute: async (input, context) => {
        const workspace = requireWorkspace(context)
        const stack = detectStack(workspace)
        let command = optionalString(input, 'command')
        if (command === '') command = detectTestCommand(workspace, stack)
        const timeout = clamp(optionalInt(input, 'timeoutMs', 480000), 1000, 900000)
        const started = nowMs()
        const result = await runShell(command, workspace.rootPath, timeout)
        const output = commandResult(command, result, nowMs() - started)
        output['passed'] = result.code === 0
        return output
      },
      summarize: () => 'run tests',
    })

    this.add({
      name: 'run_build',
      description: 'Run the project build or typecheck, detecting the command when none is given.',
      risk: 'exec',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
      },
      execute: async (input, context) => {
        const workspace = requireWorkspace(context)
        const stack = detectStack(workspace)
        let command = optionalString(input, 'command')
        if (command === '') command = detectBuildCommand(workspace, stack)
        const timeout = clamp(optionalInt(input, 'timeoutMs', 480000), 1000, 900000)
        const started = nowMs()
        const result = await runShell(command, workspace.rootPath, timeout)
        const output = commandResult(command, result, nowMs() - started)
        output['passed'] = result.code === 0
        return output
      },
      summarize: () => 'run build',
    })

    this.add({
      name: 'install_dependencies',
      description: 'Install project dependencies with the detected package manager.',
      risk: 'network',
      parameters: {
        type: 'object',
        properties: {
          manager: { type: 'string' },
          command: { type: 'string' },
        },
      },
      execute: async (input, context) => {
        const workspace = requireWorkspace(context)
        const stack = detectStack(workspace)
        let command = optionalString(input, 'command')
        if (command === '') {
          const manager = optionalString(input, 'manager') || stack.packageManager
          if (manager === 'pip') command = 'python3 -m pip install -r requirements.txt'
          else if (manager === 'cargo') command = 'cargo fetch'
          else if (manager === 'yarn') command = 'yarn install'
          else if (manager === 'bun') command = 'bun install'
          else if (manager === 'pnpm') command = 'pnpm install'
          else if (manager === 'npm') command = 'npm install'
          else throw new NexusError('E_CONFIG', 'No package manager detected; provide a command.')
        }
        const started = nowMs()
        const result = await runShell(command, workspace.rootPath, 840000)
        const output = commandResult(command, result, nowMs() - started)
        output['passed'] = result.code === 0
        return output
      },
      summarize: () => 'install dependencies',
    })

    this.add({
      name: 'inspect_package',
      description: 'Inspect project metadata and scripts.',
      risk: 'read',
      parameters: { type: 'object', properties: {} },
      execute: (_input, context) => {
        const workspace = requireWorkspace(context)
        const stack = detectStack(workspace)
        const output: Json = {
          packageManager: stack.packageManager === '' ? null : stack.packageManager,
          scripts: stack.scripts,
          hasTsconfig: stack.hasTsconfig,
          hasCargo: stack.hasCargo,
          hasGo: stack.hasGo,
          hasPython: stack.hasPython,
        }
        if (stack.packageMeta !== null && typeof stack.packageMeta === 'object') {
          const meta = stack.packageMeta as Json
          output['package'] = {
            name: jsonString(meta, 'name'),
            version: jsonString(meta, 'version'),
            description: jsonString(meta, 'description'),
            dependencies:
              meta['dependencies'] && typeof meta['dependencies'] === 'object'
                ? Object.keys(meta['dependencies'] as object).length
                : 0,
            devDependencies:
              meta['devDependencies'] && typeof meta['devDependencies'] === 'object'
                ? Object.keys(meta['devDependencies'] as object).length
                : 0,
          }
        }
        return output
      },
      summarize: () => 'inspect project',
    })

    this.add({
      name: 'analyze_errors',
      description:
        'Parse compiler/linter output or run a TypeScript typecheck and return structured diagnostics.',
      risk: 'exec',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          text: { type: 'string' },
        },
      },
      execute: async (input, context) => {
        const workspace = requireWorkspace(context)
        const text = optionalString(input, 'text')
        const kind = jsonString(input, 'kind') || 'auto'
        if (text !== '') {
          return { diagnostics: parseDiagnostics(text, kind), source: 'provided text' }
        }
        const stack = detectStack(workspace)
        let command = ''
        if (kind === 'eslint' || (kind !== 'tsc' && stack.hasEslint)) {
          const prefix = stack.packageManager === 'npm' ? 'npx ' : `${packagePrefix(stack.packageManager)}exec `
          command = `${prefix}eslint . --no-color`
        } else {
          if (!stack.hasTsconfig) {
            throw new NexusError('E_CONFIG', 'No tsconfig.json found for typechecking')
          }
          command = 'npx tsc --noEmit --pretty false'
        }
        const result = await runShell(command, workspace.rootPath, 240000)
        const combined = `${result.out}\n${result.err}`
        return {
          diagnostics: parseDiagnostics(combined, kind),
          exitCode: result.code,
          raw: result.out.slice(0, 20000),
        }
      },
      summarize: () => 'analyze errors',
    })

    this.add({
      name: 'web_fetch',
      description: 'Fetch a public http(s) page and return readable text.',
      risk: 'network',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          maxChars: { type: 'integer' },
        },
        required: ['url'],
      },
      execute: async (input) => {
        const url = requireString(input, 'url')
        if (!safePublicUrl(url)) {
          throw new NexusError('E_PERMISSION', 'Private or local URLs are blocked')
        }
        let response = {
          status: 0,
          body: '',
          headers: {} as Record<string, string>,
          error: '',
          redirectUrl: '',
        }
        let current = url
        for (let hop = 0; hop <= 5; hop += 1) {
          if (!safePublicUrl(current)) {
            throw new NexusError('E_PERMISSION', 'Private or local URLs are blocked')
          }
          response = await httpRequest({
            url: current,
            timeoutSeconds: 45,
            followRedirects: false,
            headers: { 'User-Agent': 'Mozilla/5.0 NEXUS-Desktop' },
          })
          if (response.error !== '') throw new NexusError('E_NETWORK', response.error)
          if (response.status >= 300 && response.status < 400 && response.redirectUrl !== '') {
            if (hop === 5) throw new NexusError('E_NETWORK', 'Too many redirects')
            let target = response.redirectUrl
            const targetLower = toLower(target)
            if (!startsWith(targetLower, 'http://') && !startsWith(targetLower, 'https://')) {
              const schemeEnd = current.indexOf('://')
              const originEnd =
                schemeEnd === -1 ? -1 : current.indexOf('/', schemeEnd + 3)
              if (target !== '' && target.startsWith('/') && schemeEnd !== -1) {
                target = (originEnd === -1 ? current : current.slice(0, originEnd)) + target
              } else {
                throw new NexusError('E_PERMISSION', 'Refusing non-http redirect target')
              }
            }
            current = target
            continue
          }
          break
        }
        if (response.status < 200 || response.status >= 300) {
          throw new NexusError('E_NETWORK', `HTTP ${response.status}`)
        }
        const lowerBody = toLower(response.body)
        const html = lowerBody.includes('<html')
        let text = html ? stripHtml(response.body) : response.body
        const limit = clamp(optionalInt(input, 'maxChars', 12000), 500, 200000)
        const truncated = text.length > limit
        if (truncated) text = text.slice(0, limit) + '\n…[truncated]'
        return {
          url: current,
          status: response.status,
          contentType: html ? 'text/html' : 'text/plain',
          bytes: response.body.length,
          text,
          truncated,
        }
      },
      summarize: (input) => `fetch ${optionalString(input, 'url')}`,
    })

    this.add({
      name: 'web_search',
      description: 'Search the public web with DuckDuckGo and return titles, URLs and snippets.',
      risk: 'network',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const query = requireString(input, 'query')
        const limit = clamp(optionalInt(input, 'limit', 5), 1, 10)
        const response = await httpRequest({
          url: `https://html.duckduckgo.com/html/?q=${urlEncode(query)}`,
          headers: { 'User-Agent': 'Mozilla/5.0 NEXUS-Desktop' },
        })
        if (response.error !== '') throw new NexusError('E_NETWORK', response.error)
        if (response.status < 200 || response.status >= 300) {
          throw new NexusError('E_NETWORK', `Search failed: HTTP ${response.status}`)
        }
        const body = response.body
        const linkPattern = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
        const snippetPattern = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/
        const results: Json[] = []
        let match: RegExpExecArray | null = linkPattern.exec(body)
        while (match !== null && results.length < limit) {
          const rawUrl = match[1] as string
          let resultUrl = urlDecode(rawUrl)
          if (resultUrl.includes('duckduckgo.com/l/?')) {
            const position = resultUrl.indexOf('uddg=')
            if (position !== -1) {
              const end = resultUrl.indexOf('&', position)
              const target = resultUrl.slice(position + 5, end === -1 ? undefined : end)
              resultUrl = urlDecode(target)
            }
          }
          if (startsWith(resultUrl, '//')) resultUrl = `https:${resultUrl}`
          const title = stripHtml(match[2] as string)
          const tail = body.slice(match.index)
          const snippetMatch = snippetPattern.exec(tail)
          const snippet = snippetMatch ? stripHtml(snippetMatch[1] as string) : ''
          if (resultUrl !== '' && title !== '') {
            results.push({ title, url: resultUrl, snippet })
          }
          match = linkPattern.exec(body)
        }
        if (results.length === 0) throw new NexusError('E_NETWORK', 'No search results found')
        return { query, results }
      },
      summarize: (input) => `search "${optionalString(input, 'query')}"`,
    })

    this.add({
      name: 'git_status',
      description: 'Show the workspace git status.',
      risk: 'read',
      parameters: { type: 'object', properties: {} },
      execute: async (_input, context) => requireGit(context).status(),
      summarize: () => 'git status',
    })

    this.add({
      name: 'git_diff',
      description: 'Show a git diff, optionally for one path or staged changes.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          staged: { type: 'boolean' },
        },
      },
      execute: async (input, context) => {
        const path = optionalString(input, 'path')
        return {
          diff: await requireGit(context).diff(path === '' ? undefined : path, optionalBool(input, 'staged')),
        }
      },
      summarize: () => 'git diff',
    })

    this.add({
      name: 'git_log',
      description: 'Show recent commits.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer' } },
      },
      execute: async (input, context) => {
        const limit = clamp(optionalInt(input, 'limit', 10), 1, 200)
        return { entries: await requireGit(context).log(limit) }
      },
      summarize: () => 'git log',
    })

    this.add({
      name: 'git_branch',
      description: 'List git branches and the current branch.',
      risk: 'read',
      parameters: { type: 'object', properties: {} },
      execute: async (_input, context) => requireGit(context).branches(),
      summarize: () => 'git branch',
    })

    this.add({
      name: 'git_commit',
      description: 'Stage paths (optional) and create a git commit.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
        },
        required: ['message'],
      },
      execute: async (input, context) => {
        const paths = Array.isArray(input?.['paths'])
          ? (input['paths'] as Json[]).filter((entry): entry is string => typeof entry === 'string')
          : []
        return requireGit(context).commit(requireString(input, 'message'), paths)
      },
      summarize: (input) => `git commit ${optionalString(input, 'message')}`,
    })

    this.add({
      name: 'git_checkout',
      description: 'Switch to a branch, optionally creating it.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          create: { type: 'boolean' },
        },
        required: ['branch'],
      },
      execute: async (input, context) => {
        await requireGit(context).checkout(
          requireString(input, 'branch'),
          optionalBool(input, 'create'),
        )
        return requireGit(context).status()
      },
      summarize: (input) => `git checkout ${optionalString(input, 'branch')}`,
    })

    for (const [name, description, fn] of [
      ['git_fetch', 'Fetch from the git remote.', (git: GitEngine) => git.fetch()],
      ['git_pull', 'Pull from the git remote (fast-forward only).', (git: GitEngine) => git.pull()],
      ['git_push', 'Push commits to the git remote.', (git: GitEngine) => git.push()],
    ] as Array<[string, string, (git: GitEngine) => Promise<string>]>) {
      this.add({
        name,
        description,
        risk: 'network',
        parameters: { type: 'object', properties: {} },
        execute: async (_input, context) => ({ output: await fn(requireGit(context)) }),
        summarize: () => name,
      })
    }

    this.add({
      name: 'read_multiple_files',
      description: 'Read several workspace text files in one call.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' } },
        },
        required: ['paths'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const files: Json[] = []
        if (Array.isArray(input?.['paths'])) {
          for (const entry of (input['paths'] as Json[]).slice(0, 20)) {
            if (typeof entry !== 'string') break
            const path = entry
            try {
              const result = workspace.readFile(path)
              files.push({
                path,
                language: result.language,
                content: result.content.slice(0, 400000),
                truncated: result.truncated || result.content.length > 400000,
              })
            } catch (error) {
              files.push({ path, error: error instanceof Error ? error.message : String(error) })
            }
          }
        }
        return { files }
      },
      summarize: (input) => `read ${(input?.['paths'] ?? []).length} files`,
    })

    this.add({
      name: 'repo_map',
      description: 'Build a compact repository map with source files, line counts, imports and symbols.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxFiles: { type: 'integer' },
          maxSymbols: { type: 'integer' },
        },
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const maxFiles = clamp(optionalInt(input, 'maxFiles', 300), 1, 2000)
        const maxSymbols = clamp(optionalInt(input, 'maxSymbols', 4000), 50, 20000)
        const prefix = optionalString(input, 'path')
        const files: Json[] = []
        let totalSymbols = 0
        let count = 0
        for (const relativePath of workspace.listFilePaths(8000)) {
          if (count >= maxFiles || totalSymbols >= maxSymbols) break
          if (prefix !== '' && !startsWith(relativePath, prefix)) continue
          if (!isTextExtension(relativePath)) continue
          const content = readFileSync(pathJoin(workspace.rootPath, relativePath), 256 * 1024)
          if (isProbablyBinary(content)) continue
          const symbols = extractSymbols(relativePath, content)
          totalSymbols += symbols.length
          files.push({
            path: relativePath,
            language: languageForPath(relativePath),
            lines: contentLines(content).length,
            imports: countImports(content),
            symbols,
          })
          count += 1
        }
        return {
          files,
          totalFiles: count,
          totalSymbols,
          truncated: count >= maxFiles || totalSymbols >= maxSymbols,
        }
      },
      summarize: () => 'repository map',
    })

    this.add({
      name: 'symbol_search',
      description: 'Search functions, classes, types and other symbols across the workspace.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
      execute: (input, context) => {
        const workspace = requireWorkspace(context)
        const query = toLower(requireString(input, 'query'))
        const limit = clamp(optionalInt(input, 'limit', 60), 1, 500)
        const results: Json[] = []
        for (const relativePath of workspace.listFilePaths(8000)) {
          if (results.length >= limit) break
          if (!isTextExtension(relativePath)) continue
          const content = readFileSync(pathJoin(workspace.rootPath, relativePath), MAX_TOOL_FILE)
          if (isProbablyBinary(content)) continue
          for (const symbol of extractSymbols(relativePath, content)) {
            const name = toLower(typeof symbol?.['name'] === 'string' ? symbol['name'] : '')
            if (!name.includes(query)) continue
            results.push({
              path: relativePath,
              name: symbol['name'],
              kind: symbol['kind'],
              line: symbol['line'],
            })
            if (results.length >= limit) break
          }
        }
        return { query: jsonString(input, 'query'), symbols: results }
      },
      summarize: (input) => `symbol ${optionalString(input, 'query')}`,
    })

    this.add({
      name: 'verify_changes',
      description:
        'Run the narrowest project verification (typecheck, then build, then tests) and return the result.',
      risk: 'exec',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
      },
      execute: async (input, context) => {
        const workspace = requireWorkspace(context)
        const stack = detectStack(workspace)
        let command = optionalString(input, 'command')
        const scripts =
          stack.scripts !== null && typeof stack.scripts === 'object' && !Array.isArray(stack.scripts)
            ? (stack.scripts as Json)
            : {}
        if (command === '') {
          if (typeof scripts['typecheck'] === 'string') {
            command = `${packagePrefix(stack.packageManager)}run typecheck`
          } else if (stack.hasTsconfig) {
            command = `${packagePrefix(stack.packageManager)}exec tsc --noEmit`
          } else if (typeof scripts['build'] === 'string') {
            command = `${packagePrefix(stack.packageManager)}run build`
          } else if (stack.hasCargo) command = 'cargo check'
          else if (stack.hasGo) command = 'go build ./...'
          else if (stack.hasPython) command = 'python3 -m compileall -q .'
          else throw new NexusError('E_CONFIG', 'No verification command detected')
        }
        const timeout = clamp(optionalInt(input, 'timeoutMs', 300000), 1000, 900000)
        const started = nowMs()
        const result = await runShell(command, workspace.rootPath, timeout)
        const output = commandResult(command, result, nowMs() - started)
        output['passed'] = result.code === 0 && !result.timedOut
        return output
      },
      summarize: () => 'verify changes',
    })

    this.add({
      name: 'delegate_task',
      description:
        'Delegate an isolated coding subtask to a subagent and return its final summary. Use for parallelizable or self-contained work.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          title: { type: 'string' },
          mode: { type: 'string' },
          permissionMode: { type: 'string' },
        },
        required: ['prompt'],
      },
      execute: async () => {
        throw new NexusError('E_TOOL', 'delegate_task is executed by the agent runtime')
      },
      summarize: (input) => `delegate: ${optionalString(input, 'title')}`,
    })

    this.add({
      name: 'delegate_parallel',
      description:
        'Delegate up to four independent subtasks to run in parallel and return every summary.',
      risk: 'write',
      parameters: {
        type: 'object',
        properties: {
          tasks: { type: 'array', items: { type: 'object' } },
        },
        required: ['tasks'],
      },
      execute: async () => {
        throw new NexusError('E_TOOL', 'delegate_parallel is executed by the agent runtime')
      },
      summarize: (input) =>
        `delegate ${Array.isArray(input?.['tasks']) ? (input['tasks'] as Json[]).length : 0} tasks`,
    })

    this.add({
      name: 'mcp_list_servers',
      description: 'List configured MCP servers and their running status.',
      risk: 'read',
      parameters: { type: 'object', properties: {} },
      execute: async (_input, context) => {
        if (!context.mcp) throw new NexusError('E_CONFIG', 'MCP manager is unavailable')
        return { servers: await context.mcp.listServers() }
      },
      summarize: () => 'list MCP servers',
    })

    this.add({
      name: 'mcp_list_tools',
      description: 'List tools exposed by configured MCP servers.',
      risk: 'network',
      parameters: {
        type: 'object',
        properties: { serverId: { type: 'string' } },
      },
      execute: async (input, context) => {
        if (!context.mcp) throw new NexusError('E_CONFIG', 'MCP manager is unavailable')
        return { tools: await context.mcp.listTools(optionalString(input, 'serverId')) }
      },
      summarize: () => 'list MCP tools',
    })

    this.add({
      name: 'mcp_call',
      description: 'Call a tool exposed by an MCP server.',
      risk: 'network',
      parameters: {
        type: 'object',
        properties: {
          serverId: { type: 'string' },
          tool: { type: 'string' },
          arguments: { type: 'object' },
        },
        required: ['serverId', 'tool'],
      },
      execute: async (input, context) => {
        if (!context.mcp) throw new NexusError('E_CONFIG', 'MCP manager is unavailable')
        return context.mcp.call(
          requireString(input, 'serverId'),
          requireString(input, 'tool'),
          input?.['arguments'] ?? {},
        )
      },
      summarize: (input) => `mcp ${optionalString(input, 'serverId')}/${optionalString(input, 'tool')}`,
    })
  }
}
