import { existsSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { relative as nodeRelative, resolve as nodeResolve, sep } from 'node:path'

import { NexusError } from './errors.ts'
import type { JsonValue } from './types.ts'
import { basename, dirname, endsWith, ensureDirectory, fileExists, fileMtimeMs, fileSize, globMatch, isDirectory, isIgnoredName, isProbablyBinary, isTextExtension, languageForPath, pathJoin, readFileSync, split, startsWith, toLower, toPosix, trim, utf8Prefix, writeFileAtomic } from './util.ts'

const MAX_READ_BYTES = 1024 * 1024
const MAX_WRITE_BYTES = 8 * 1024 * 1024
const MAX_TREE_ENTRIES = 20_000

export interface ReadResult {
  content: string
  language: string
  size: number
  truncated: boolean
  mtimeMs: number
}

export interface WriteResult {
  path: string
  size: number
  created: boolean
  before?: string
}

function sanitizeRelative(input: string): string {
  const value = toPosix(trim(input))
  if (value === '' || value === '.') return ''
  if (value.startsWith('/')) {
    throw new NexusError('E_PERMISSION', `Absolute paths are not allowed: ${input}`)
  }
  const parts: string[] = []
  for (const part of split(value, '/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      throw new NexusError(
        'E_PERMISSION',
        `Path traversal is not allowed: ${input}. Use a workspace-relative path without '..'.`,
      )
    }
    parts.push(part)
  }
  return parts.join('/')
}

const stripLeadingSlash = (value: string): string => value.replace(/^\/+/, '')

const insideRoot = (root: string, candidate: string): boolean =>
  candidate === root || startsWith(candidate, `${root}/`)

function nodeFor(absolute: string, relative: string): Record<string, JsonValue> {
  const directory = isDirectory(absolute)
  const node: Record<string, JsonValue> = {
    name: relative === '' ? '.' : basename(relative),
    path: relative,
    type: directory ? 'directory' : 'file',
  }
  if (!directory) {
    node['size'] = fileSize(absolute)
    node['language'] = languageForPath(relative)
  }
  return node
}

function canonicalPath(path: string): string {
  // weakly_canonical tương đương: nếu có phần path tồn tại, thực thi realpath cho phần đó.
  try {
    return toPosix(realpathSync.native(path))
  } catch {
    try {
      // Walk up tới phần tồn tại rồi realpath… đơn giản hoá: resolve thủ công
      const absolute = nodeResolve(path)
      let current = absolute
      const tail: string[] = []
      while (!existsSync(current)) {
        const parent = dirname(current)
        if (parent === current) break
        tail.unshift(basename(current))
        current = parent
      }
      try {
        const root = realpathSync.native(current)
        return tail.length > 0 ? toPosix(`${toPosix(root)}/${tail.join('/')}`) : toPosix(root)
      } catch {
        return toPosix(absolute)
      }
    } catch {
      return toPosix(nodeResolve(path))
    }
  }
}

function isRepositoryRoot(candidate: string): boolean {
  const has = (marker: string): boolean => existsSync(pathJoin(candidate, marker))
  if (has('.git') || has('.hg') || has('pnpm-workspace.yaml') || has('lerna.json')) return true
  if (!has('package.json')) return false
  const content = readFileSync(pathJoin(candidate, 'package.json'), 256 * 1024)
  return content.includes('"workspaces"')
}

export function widenToRepository(start: string): string {
  let current = nodeResolve(start)
  const home = process.env.HOME ?? '/'
  let best = current
  for (;;) {
    if (isRepositoryRoot(current)) best = current
    const parent = dirname(current)
    if (parent === current || current === home) break
    current = parent
  }
  return toPosix(best)
}

export class Workspace {
  private readonly root: string
  private ignorePatterns: string[] = []
  private readonly ignoreCache = new Map<string, boolean>()

  constructor(rootPath: string) {
    const absolute = canonicalPath(rootPath)
    if (!isDirectory(absolute)) throw new NexusError('E_FS', `Not a directory: ${rootPath}`)
    this.root = absolute
    this.loadIgnorePatterns()
  }

  get rootPath(): string {
    return this.root
  }

  private loadIgnorePatterns(): void {
    const content = readFileSync(pathJoin(this.root, '.gitignore'), 256 * 1024)
    for (const raw of split(content, '\n')) {
      const line = trim(raw)
      if (line === '' || line.startsWith('#')) continue
      if (line.startsWith('!')) continue
      this.ignorePatterns.push(line)
    }
  }

  isIgnored(relativePath: string): boolean {
    if (relativePath === '') return false
    const cached = this.ignoreCache.get(relativePath)
    if (cached !== undefined) return cached
    let ignored = false
    for (const part of split(relativePath, '/')) {
      if (isIgnoredName(part)) {
        ignored = true
        break
      }
    }
    if (!ignored) {
      const name = basename(relativePath)
      for (const rawPattern of this.ignorePatterns) {
        let pattern = rawPattern
        if (endsWith(pattern, '/')) pattern = pattern.slice(0, -1)
        pattern = stripLeadingSlash(pattern)
        if (pattern === '') continue
        if (
          globMatch(pattern, relativePath) ||
          globMatch(pattern, name) ||
          (pattern.includes('/') && globMatch(`**/${pattern}`, relativePath))
        ) {
          ignored = true
          break
        }
      }
    }
    if (this.ignoreCache.size >= 8192) this.ignoreCache.clear()
    this.ignoreCache.set(relativePath, ignored)
    return ignored
  }

  /** Trả {absolute, relative}; ném E_PERMISSION khi thoát khỏi root. */
  resolve(relativePath: string): [string, string] {
    const value = toPosix(trim(relativePath))
    if (value && value.startsWith('/')) {
      const absolute = canonicalPath(value)
      if (!insideRoot(this.root, absolute)) {
        throw new NexusError(
          'E_PERMISSION',
          `Path escapes the workspace (${this.root}): ${relativePath}. Use a path inside the workspace root.`,
        )
      }
      const relative = absolute === this.root ? '' : toPosix(nodeRelative(this.root, absolute).split(sep).join('/'))
      return [absolute, relative]
    }
    const clean = sanitizeRelative(value)
    const candidate = clean === '' ? this.root : `${this.root}/${clean}`
    const absolute = canonicalPath(candidate)
    if (!insideRoot(this.root, absolute)) {
      throw new NexusError(
        'E_PERMISSION',
        `Path escapes the workspace (${this.root}): ${relativePath}. Use a path inside the workspace root.`,
      )
    }
    let relative = clean
    if (absolute !== this.root) {
      const rel = nodeRelative(this.root, absolute).split(sep).join('/')
      relative = toPosix(rel)
      if (relative === '') relative = clean
    }
    return [absolute, relative]
  }

  readFile(relativePath: string): ReadResult {
    const [absolute, relative] = this.resolve(relativePath)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new NexusError('E_FS', `Cannot read ${relative}: not found`)
    }
    const size = fileSize(absolute)
    const limit = Math.min(size, MAX_READ_BYTES)
    const content = readFileSync(absolute, limit)
    if (isProbablyBinary(content)) {
      throw new NexusError('E_FS', `Refusing to read binary file: ${relative}`)
    }
    return {
      content,
      language: languageForPath(relative),
      size,
      truncated: size > limit,
      mtimeMs: fileMtimeMs(absolute),
    }
  }

  writeFile(relativePath: string, content: string, readBefore = true): WriteResult {
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > MAX_WRITE_BYTES) {
      throw new NexusError('E_FS', 'File exceeds the write limit (8388608 bytes)')
    }
    const [absolute, relative] = this.resolve(relativePath)
    if (relative === '') throw new NexusError('E_PERMISSION', 'Refusing to overwrite the workspace root')
    if (this.isIgnored(relative)) {
      throw new NexusError('E_PERMISSION', `Path is ignored by workspace rules: ${relative}`)
    }
    const result: WriteResult = { path: relative, size: bytes, created: false }
    if (readBefore && fileExists(absolute)) {
      const before = readFileSync(absolute, MAX_WRITE_BYTES)
      if (!isProbablyBinary(before)) result.before = before
      result.created = false
    } else {
      result.created = !fileExists(absolute)
    }
    if (!writeFileAtomic(absolute, content)) {
      throw new NexusError('E_FS', `Failed to write ${relative}`)
    }
    return result
  }

  createFile(relativePath: string, content = ''): Record<string, JsonValue> {
    const result = this.writeFile(relativePath, content, false)
    return {
      name: basename(result.path),
      path: result.path,
      type: 'file',
      size: result.size,
      language: languageForPath(result.path),
    }
  }

  createDir(relativePath: string): Record<string, JsonValue> {
    const [absolute, relative] = this.resolve(relativePath)
    if (relative === '') throw new NexusError('E_VALIDATION', 'A directory name is required')
    if (this.isIgnored(relative)) {
      throw new NexusError('E_PERMISSION', `Path is ignored by workspace rules: ${relative}`)
    }
    if (!ensureDirectory(absolute)) {
      throw new NexusError('E_FS', `Failed to create directory ${relative}`)
    }
    return { name: basename(relative), path: relative, type: 'directory' }
  }

  rename(from: string, to: string): Record<string, JsonValue> {
    const source = this.resolve(from)
    const target = this.resolve(to)
    if (target[1] === '') throw new NexusError('E_PERMISSION', 'Refusing to overwrite the workspace root')
    if (this.isIgnored(target[1])) {
      throw new NexusError('E_PERMISSION', `Path is ignored by workspace rules: ${target[1]}`)
    }
    ensureDirectory(dirname(target[0]))
    try {
      renameSync(source[0], target[0])
    } catch (error) {
      throw new NexusError(
        'E_FS',
        `Failed to rename ${source[1]} → ${target[1]}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return nodeFor(target[0], target[1])
  }

  remove(relativePath: string): void {
    const [absolute, relative] = this.resolve(relativePath)
    if (relative === '') throw new NexusError('E_PERMISSION', 'Refusing to delete the workspace root')
    if (this.isIgnored(relative)) {
      throw new NexusError('E_PERMISSION', `Path is ignored by workspace rules: ${relative}`)
    }
    try {
      rmSync(absolute, { recursive: true, force: true })
    } catch (error) {
      throw new NexusError(
        'E_FS',
        `Failed to delete ${relative}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  stat(relativePath: string): Record<string, JsonValue> {
    const [absolute, relative] = this.resolve(relativePath)
    if (!existsSync(absolute)) throw new NexusError('E_FS', `Path not found: ${relative}`)
    const directory = isDirectory(absolute)
    return {
      path: relative,
      type: directory ? 'directory' : 'file',
      size: directory ? 0 : fileSize(absolute),
      mtimeMs: fileMtimeMs(absolute),
    }
  }

  exists(relativePath: string): boolean {
    try {
      const [absolute] = this.resolve(relativePath)
      return existsSync(absolute)
    } catch {
      return false
    }
  }

  tree(relativePath = '', depth = 3): Record<string, JsonValue> {
    const [base, baseRelative] = this.resolve(relativePath)
    const maxDepth = Math.min(Math.max(Math.trunc(depth) || 1, 1), 12)
    let entries = 0
    let truncated = false

    const walk = (absolute: string, relative: string, level: number): Record<string, JsonValue> => {
      if (!isDirectory(absolute)) return nodeFor(absolute, relative)
      const node: Record<string, JsonValue> = {
        name: relative === '' ? '.' : basename(relative),
        path: relative,
        type: 'directory',
        children: [] as JsonValue[],
      }
      if (level >= maxDepth) {
        node['truncated'] = true
        return node
      }
      let dirents: import('node:fs').Dirent[]
      try {
        dirents = readdirSync(absolute, { withFileTypes: true })
      } catch {
        node['truncated'] = true
        return node
      }
      dirents.sort((a, b) => {
        const aDir = a.isDirectory()
        const bDir = b.isDirectory()
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      for (const dirent of dirents) {
        if (entries >= MAX_TREE_ENTRIES) {
          truncated = true
          node['truncated'] = true
          break
        }
        if (dirent.isSymbolicLink()) continue
        const childRel = relative === '' ? dirent.name : `${relative}/${dirent.name}`
        if (this.isIgnored(childRel)) continue
        entries += 1
        try {
          const child = walk(pathJoin(absolute, dirent.name), childRel, level + 1)
          ;(node['children'] as JsonValue[]).push(child)
        } catch {
          // bỏ qua node lỗi, giống bản C++
        }
      }
      return node
    }

    const result = walk(base, baseRelative, 0)
    if (truncated) result['truncated'] = true
    return result
  }

  private walkFiles(base: string, limit: number, visitor: (relative: string, absolute: string) => void): void {
    const [rootAbsolute, rootRelative] = this.resolve(base)
    let visited = 0
    const walk = (absolute: string, relative: string): void => {
      if (visited >= limit) return
      let dirents: import('node:fs').Dirent[]
      try {
        dirents = readdirSync(absolute, { withFileTypes: true })
      } catch {
        return
      }
      dirents.sort((a, b) => a.name.localeCompare(b.name))
      for (const dirent of dirents) {
        if (visited >= limit) return
        if (dirent.isSymbolicLink()) continue
        const childRel = relative === '' ? dirent.name : `${relative}/${dirent.name}`
        if (this.isIgnored(childRel)) continue
        const childAbsolute = pathJoin(absolute, dirent.name)
        if (dirent.isDirectory()) {
          walk(childAbsolute, childRel)
        } else if (dirent.isFile()) {
          visitor(childRel, childAbsolute)
          visited += 1
        }
      }
    }
    walk(rootAbsolute, rootRelative)
  }

  listFilePaths(limit = 5000): string[] {
    const paths: string[] = []
    this.walkFiles('', limit, (relative) => paths.push(relative))
    return paths
  }

  searchFiles(query: string, limit = 50): JsonValue[] {
    const needle = toLower(query)
    const scored: Array<{ score: number; path: string }> = []
    this.walkFiles('', 5000, (relative) => {
      if (scored.length >= limit * 4) return
      const lower = toLower(relative)
      const index = lower.indexOf(needle)
      if (index === -1) return
      const name = basename(lower)
      const nameIndex = name.indexOf(needle)
      let score: number
      if (nameIndex === 0) score = 6
      else if (nameIndex !== -1) score = 4
      else score = 2
      score += Math.max(0, 3 - split(relative, '/').length * 0.2)
      scored.push({ score, path: relative })
    })
    scored.sort((a, b) => b.score - a.score)
    const result: JsonValue[] = []
    for (const entry of scored.slice(0, Math.max(1, limit))) {
      result.push({ path: entry.path, score: Math.round(entry.score * 100) / 100 })
    }
    return result
  }

  searchCode(query: string, useRegex: boolean, limit = 60): JsonValue[] {
    let matcher: RegExp | null = null
    let needleLower = ''
    if (useRegex) {
      try {
        matcher = new RegExp(query, 'i')
      } catch {
        throw new NexusError('E_VALIDATION', `Invalid search pattern: ${query}`)
      }
    } else {
      needleLower = toLower(query)
    }
    const results: JsonValue[] = []
    let done = false
    let scanned = 0
    this.walkFiles('', 5000, (relative, absolute) => {
      if (done) return
      if (!isTextExtension(relative)) return
      if (fileSize(absolute) > 512 * 1024) return
      scanned += 1
      if (scanned > 5000) return
      const content = readFileSync(absolute, 512 * 1024)
      if (isProbablyBinary(content)) return
      const lines = content.split('\n')
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (done) return
        const line = lines[lineIndex] as string
        let column = -1
        if (matcher) {
          const match = matcher.exec(line)
          if (match) column = match.index + 1
        } else {
          const position = toLower(line).indexOf(needleLower)
          if (position !== -1) column = position + 1
        }
        if (column >= 0) {
          results.push({
            path: relative,
            line: lineIndex + 1,
            column,
            preview: trim(utf8Prefix(line, 240)),
          })
          if (results.length >= limit) {
            done = true
          }
        }
      }
    })
    return results
  }
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, Workspace>()

  ensure(projectId: string, root: string): Workspace {
    const canonical = canonicalPath(root)
    const widened = widenToRepository(canonical)
    const normalized = canonicalPath(widened)
    const existing = this.workspaces.get(projectId)
    if (existing && existing.rootPath === normalized) return existing
    this.workspaces.delete(projectId)
    const workspace = new Workspace(widened)
    this.workspaces.set(projectId, workspace)
    return workspace
  }

  get(projectId: string): Workspace {
    const workspace = this.workspaces.get(projectId)
    if (!workspace) {
      throw new NexusError('E_FS', `Workspace for project ${projectId} is not open`)
    }
    return workspace
  }

  has(projectId: string): boolean {
    return this.workspaces.has(projectId)
  }

  rootOf(projectId: string): string {
    return this.get(projectId).rootPath
  }

  close(projectId: string): void {
    this.workspaces.delete(projectId)
  }

  closeAll(): void {
    this.workspaces.clear()
  }
}
