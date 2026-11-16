import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { accessSync } from 'node:fs'
import { homedir } from 'node:os'

import { NexusError } from './errors.ts'
import type { EventBus } from './events.ts'

export type Json = any
import { fileExists, isDirectory, uuid } from './util.ts'

interface Session {
  id: string
  child: ChildProcess
  pipe: boolean
  info: Json
  alive: boolean
}

const trimOrEmpty = (value: Json, key: string): string => {
  const item = value?.[key]
  return typeof item === 'string' ? item : ''
}

const numberParam = (value: Json, key: string, fallback: number): number => {
  const item = value?.[key]
  if (typeof item === 'number' && Number.isFinite(item)) return Math.trunc(item)
  if (typeof item === 'string' && /^-?\d+$/.test(item.trim())) {
    return Number.parseInt(item, 10)
  }
  return fallback
}

export class TerminalManager {
  private readonly events: EventBus
  private readonly sessions = new Map<string, Session>()
  private counter = 0
  private shellHint: boolean | null = null

  constructor(events: EventBus) {
    this.events = events
  }

  detectShell(preferred: string): string {
    if (preferred !== '' && fileExists(preferred)) return preferred
    const envShell = process.env['SHELL'] ?? ''
    if (envShell !== '' && fileExists(envShell)) return envShell
    for (const candidate of ['/bin/bash', '/bin/zsh', '/bin/sh']) {
      if (fileExists(candidate)) return candidate
    }
    return 'cmd.exe'
  }

  defaultCwd(requested: string): string {
    if (requested !== '' && isDirectory(requested)) return requested
    const home = homedir()
    if (isDirectory(home)) return home
    return process.cwd()
  }

  /** `script(1)` đem lại PTY thật trên Linux/macOS; fallback pipe cho Windows/thiếu script. */
  private scriptSupported(): boolean {
    if (this.shellHint !== null) return this.shellHint
    if (process.platform === 'win32') {
      this.shellHint = false
      return false
    }
    try {
      accessSync('/usr/bin/script')
    } catch {
      try {
        execFileSync('script', ['--version'], { stdio: 'ignore' })
      } catch {
        this.shellHint = false
        return false
      }
    }
    this.shellHint = true
    return true
  }

  create(options: Json): Json {
    const shell = this.detectShell(trimOrEmpty(options, 'shell'))
    const cwd = this.defaultCwd(trimOrEmpty(options, 'cwd'))
    const cols = clamp(numberParam(options, 'cols', 100), 2, 500)
    const rows = clamp(numberParam(options, 'rows', 30), 2, 300)
    const id = uuid()
    this.counter += 1

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      NEXUS_TERMINAL: '1',
    }

    let child: ChildProcess
    let pipe = true
    if (this.scriptSupported()) {
      const args =
        process.platform === 'darwin'
          ? ['-q', '/dev/null', shell]
          : [
              '-q',
              '-f',
              '-e',
              '-c',
              `export TERM=xterm-256color COLORTERM=truecolor NEXUS_TERMINAL=1; exec "${shell.replace(/"/g, '\\"')}"`,
              '/dev/null',
            ]
      try {
        child = spawn('script', args, {
          cwd,
          env,
          detached: process.platform !== 'darwin',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        pipe = false
      } catch {
        child = this.spawnPipe(shell, cwd, env)
      }
    } else {
      child = this.spawnPipe(shell, cwd, env)
    }
    if (child.pid === undefined) {
      throw new NexusError('E_TERMINAL', `Failed to start shell ${shell}`)
    }

    const session: Session = {
      id,
      child,
      pipe,
      alive: true,
      info: {
        id,
        title: `Terminal ${this.counter}`,
        cwd,
        shell,
        pid: child.pid,
        cols,
        rows,
      },
    }
    this.attachOutput(session)
    child.on('error', () => {
      this.reportExit(session, 127)
    })
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const exitCode =
        typeof code === 'number' ? code : signal === null ? 0 : 128 + (signalToNumber(signal) ?? 0)
      this.reportExit(session, exitCode)
    })
    this.sessions.set(id, session)
    return session.info
  }

  private spawnPipe(shell: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
    if (process.platform === 'win32') {
      return spawn('cmd.exe', [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    return spawn(shell, ['-l'], {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  private attachOutput(session: Session): void {
    const forward = (chunk: Buffer): void => {
      this.events.emit('terminal.output', {
        terminalId: session.id,
        data: chunk.toString('utf8'),
      })
    }
    session.child.stdout?.on('data', forward)
    session.child.stderr?.on('data', forward)
  }

  private reportExit(session: Session, exitCode: number): void {
    if (!session.alive) return
    session.alive = false
    this.events.emit('terminal.exit', { terminalId: session.id, exitCode })
    this.sessions.delete(session.id)
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (session === undefined || !session.alive) {
      throw new NexusError('E_TERMINAL', `Terminal ${id} not found`)
    }
    // Renderer gửi “\r” kiểu xterm; pipe-backed shell cần “\n”.
    const payload = session.pipe ? data.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : data
    try {
      session.child.stdin?.write(payload)
    } catch (error) {
      throw new NexusError('E_TERMINAL', error instanceof Error ? error.message : String(error))
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session === undefined) return
    session.info['cols'] = clamp(cols, 2, 500)
    session.info['rows'] = clamp(rows, 2, 300)
  }

  dispose(id: string): void {
    const session = this.sessions.get(id)
    if (session === undefined) return
    this.killSession(session)
    this.sessions.delete(id)
  }

  disposeAll(): void {
    for (const session of [...this.sessions.values()]) {
      this.killSession(session)
    }
    this.sessions.clear()
  }

  list(): Json[] {
    return [...this.sessions.values()].map((session) => session.info)
  }

  private killSession(session: Session): void {
    if (!session.alive) return
    session.alive = false
    const child = session.child
    if (child.pid !== undefined) {
      try {
        if (process.platform === 'win32') child.kill('SIGTERM')
        else process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          // đã thoát
        }
      }
    }
    child.stdin?.destroy()
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const signalToNumber = (signal: NodeJS.Signals): number | undefined => {
  const table: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGABRT: 6,
    SIGKILL: 9,
    SIGTERM: 15,
    SIGUSR1: 10,
    SIGSEGV: 11,
    SIGPIPE: 13,
    SIGALRM: 14,
  }
  return table[signal]
}
