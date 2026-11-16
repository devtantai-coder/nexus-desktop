import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { NexusError } from './errors.ts'
import type { JsonValue } from './types.ts'
import {
  runProcess,
  split,
  startsWith,
  toPosix,
  trim,
  utf8Prefix,
} from './util.ts'

const ALLOWED_OPERATIONS = new Set([
  'status', 'diff', 'log', 'branch', 'rev-parse', 'rev-list', 'show', 'add', 'reset',
  'commit', 'checkout', 'switch', 'fetch', 'pull', 'push', 'remote', 'restore', 'stash',
  'config', 'ls-files', 'merge-base', 'symbolic-ref',
])

const CONFLICT_PAIRS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export interface GitRunResult {
  code: number
  out: string
  err: string
}

export interface GitStatusFile {
  path: string
  index: string
  worktree: string
  kind: string
  staged: boolean
  from?: string
}

const normalizeGitPath = (path: string): string => toPosix(path)

function parsePorcelain(raw: string): GitStatusFile[] {
  const tokens = raw.split('\0')
  const files: GitStatusFile[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string
    if (token.length < 3) continue
    const indexStatus = token.charAt(0)
    const worktreeStatus = token.charAt(1)
    const path = token.slice(3)
    if (path === '') continue
    const resolved = path
    let originalPath = ''
    if (indexStatus === 'R' || indexStatus === 'C') {
      const next = tokens[index + 1]
      if (next !== undefined && next.length > 0) {
        originalPath = normalizeGitPath(next)
        index += 1
      }
    }
    const pair = `${indexStatus}${worktreeStatus}`
    let kind: string
    if (CONFLICT_PAIRS.has(pair)) kind = 'conflicted'
    else if (pair === '??') kind = 'untracked'
    else if (pair === '!!') kind = 'ignored'
    else if (pair === 'R ' || pair === ' R') kind = 'renamed'
    else if (pair === 'A ' || worktreeStatus === 'A') kind = 'added'
    else if (pair === 'D ' || worktreeStatus === 'D') kind = 'deleted'
    else kind = 'modified'
    const staged = indexStatus !== ' ' && indexStatus !== '?'
    const file: GitStatusFile = {
      path: normalizeGitPath(resolved),
      index: indexStatus,
      worktree: worktreeStatus,
      kind,
      staged,
    }
    if (originalPath !== '') file.from = originalPath
    files.push(file)
  }
  return files
}

export class GitEngine {
  private readonly cwd: string
  private repoRoot: string | undefined
  private repoRootPromise: Promise<string | undefined> | null = null

  constructor(cwd: string) {
    this.cwd = toPosix(resolve(cwd))
  }

  /** Duyệt lên repo một lần rồi cache (lazy; thay cho constructor của bản C++). */
  private ensureRepoRoot(): Promise<string | undefined> {
    this.repoRootPromise ??= this.tryRun(['rev-parse', '--show-toplevel']).then((check) => {
      if (check.code === 0) {
        const root = trim(check.out)
        this.repoRoot = root || undefined
      }
      return this.repoRoot
    })
    return this.repoRootPromise
  }

  async root(): Promise<string> {
    return (await this.ensureRepoRoot()) ?? this.cwd
  }

  async isRepo(): Promise<boolean> {
    return (await this.ensureRepoRoot()) !== undefined
  }

  private async tryRun(args: string[], timeoutMs = 30_000): Promise<GitRunResult> {
    const result = await runProcess(['git', ...args], this.cwd, timeoutMs, [
      'GIT_TERMINAL_PROMPT=0',
      'GIT_OPTIONAL_LOCKS=1',
    ])
    return { code: result.code, out: result.out, err: result.err }
  }

  async run(args: string[], timeoutMs = 30_000): Promise<GitRunResult> {
    if (args.length === 0) throw new NexusError('E_GIT', 'Missing git arguments')
    if (!ALLOWED_OPERATIONS.has(args[0] as string)) {
      throw new NexusError('E_PERMISSION', `Git operation not allowed: ${args[0] as string}`)
    }
    for (const arg of args) {
      if (arg.includes('\0')) throw new NexusError('E_VALIDATION', 'Invalid git argument')
    }
    const result = await this.tryRun(args, timeoutMs)
    if (result.code !== 0) {
      let detail = trim(result.err)
      if (detail === '') detail = trim(result.out)
      if (detail.length > 1500) detail = `${utf8Prefix(detail, 1500)}…`
      throw new NexusError('E_GIT', `git ${args[0] as string} failed: ${detail}`)
    }
    return result
  }

  private async branchSummary(): Promise<Record<string, JsonValue>> {
    const summary: Record<string, JsonValue> = { ahead: 0, behind: 0 }
    const branch = await this.tryRun(['branch', '--show-current'])
    if (branch.code === 0 && trim(branch.out) !== '') summary['branch'] = trim(branch.out)
    const upstream = await this.tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    if (upstream.code === 0) {
      const name = trim(upstream.out)
      if (name !== '') {
        summary['upstream'] = name
        const counts = await this.tryRun(['rev-list', '--left-right', '--count', `${name}...HEAD`])
        if (counts.code === 0) {
          const [behindText, aheadText] = trim(counts.out).split(/\s+/)
          const behind = Number.parseInt(behindText ?? '', 10)
          const ahead = Number.parseInt(aheadText ?? '', 10)
          if (Number.isFinite(behind) && Number.isFinite(ahead)) {
            summary['behind'] = behind
            summary['ahead'] = ahead
          }
        }
      }
    }
    return summary
  }

  async status(): Promise<Record<string, JsonValue>> {
    if (!(await this.isRepo())) {
      return { ahead: 0, behind: 0, files: [], clean: true, isRepo: false }
    }
    const porcelain = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], 30_000)
    const files = parsePorcelain(porcelain.out)
    const summary = await this.branchSummary()
    summary['files'] = files as unknown as JsonValue[]
    summary['clean'] = files.length === 0
    summary['isRepo'] = true
    return summary
  }

  async diff(path: string | undefined, staged: boolean): Promise<string> {
    const args = ['diff', '--no-color']
    if (staged) args.push('--cached')
    if (path) {
      args.push('--', path)
    }
    return (await this.run(args, 30_000)).out
  }

  async log(limit: number): Promise<JsonValue[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 200)
    const result = await this.run([
      'log',
      `-n${safeLimit}`,
      '--date=iso',
      '--pretty=format:%H%x09%an%x09%ad%x09%s',
    ])
    const entries: JsonValue[] = []
    for (const line of split(result.out, '\n')) {
      if (line === '') continue
      const parts = split(line, '\t')
      entries.push({
        hash: parts[0] ?? '',
        author: parts[1] ?? '',
        date: parts[2] ?? '',
        subject: parts[3] ?? '',
      })
    }
    return entries
  }

  async branches(): Promise<Record<string, JsonValue>> {
    const result = await this.run(['branch', '--format=%(refname:short)'])
    const all = split(result.out, '\n')
      .map((line) => trim(line))
      .filter((line) => line !== '')
    const branches: Record<string, JsonValue> = { all }
    const current = await this.tryRun(['branch', '--show-current'])
    if (current.code === 0 && trim(current.out) !== '') branches['current'] = trim(current.out)
    return branches
  }

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await this.run(['add', '--', ...paths])
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    const result = await this.tryRun(['reset', 'HEAD', '--', ...paths])
    if (result.code !== 0) {
      await this.run(['reset', '--', ...paths])
    }
  }

  async commit(message: string, paths: string[]): Promise<Record<string, JsonValue>> {
    if (trim(message) === '') throw new NexusError('E_VALIDATION', 'Commit message is required')
    if (paths.length > 0) await this.stage(paths)
    const result = await this.run(['commit', '-m', message], 30_000)
    const position = result.out.indexOf(']')
    if (position !== -1) {
      const open = result.out.lastIndexOf('[', position)
      if (open !== -1) {
        const inside = result.out.slice(open + 1, position)
        const parts = split(inside, ' ')
        const hash = trim(parts[parts.length - 1] ?? '')
        if (hash.length >= 7 && /^[0-9a-fA-F]+$/.test(hash)) return { hash }
      }
    }
    const revision = await this.run(['rev-parse', 'HEAD'])
    return { hash: trim(revision.out) }
  }

  async checkout(branch: string, create: boolean): Promise<void> {
    if (trim(branch) === '') throw new NexusError('E_VALIDATION', 'Branch name is required')
    if (create) await this.run(['checkout', '-b', branch])
    else await this.run(['checkout', branch])
  }

  async fetch(): Promise<string> {
    const result = await this.run(['fetch', '--prune'], 120_000)
    return result.out + result.err
  }

  async pull(): Promise<string> {
    const result = await this.run(['pull', '--ff-only'], 180_000)
    return result.out + result.err
  }

  async push(): Promise<string> {
    const result = await this.run(['push'], 180_000)
    return result.out + result.err
  }

  async discard(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    const current = await this.status()
    const files = (current['files'] as Array<Record<string, unknown>> | undefined) ?? []
    const byPath = new Map<string, Record<string, unknown>>()
    for (const entry of files) {
      const path = entry['path']
      if (typeof path === 'string') byPath.set(path, entry)
    }
    const tracked: string[] = []
    for (const path of paths) {
      const entry = byPath.get(path)
      if (!entry || entry['kind'] === 'untracked') {
        const root = await this.root()
        const absolute = resolve(root, path)
        const posixAbsolute = toPosix(absolute)
        if (
          existsSync(posixAbsolute) &&
          (posixAbsolute === root || startsWith(posixAbsolute, `${root}/`))
        ) {
          rmSync(posixAbsolute, { recursive: true, force: true })
        }
      } else {
        tracked.push(path)
      }
    }
    if (tracked.length > 0) {
      await this.run(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked])
    }
  }

  async remoteUrl(): Promise<string | undefined> {
    const result = await this.tryRun(['remote', 'get-url', 'origin'])
    if (result.code !== 0) return undefined
    const value = trim(result.out)
    return value === '' ? undefined : value
  }
}
