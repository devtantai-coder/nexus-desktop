import { watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'

import type { EventBus } from './events.ts'
import { isIgnoredName, nowMs, split, toPosix } from './util.ts'

interface PendingChange {
  path: string
  kind: string
}

const MAX_WATCH_DELAY_MS = 250
const MAX_PENDING = 500

function ignoredComponent(relativePath: string): boolean {
  for (const part of split(relativePath, '/')) {
    if (isIgnoredName(part)) return true
  }
  return false
}

/** Giám sát workspace, phát 'workspace.file.changed' + 'git.status.changed' kiểu C++. */
export class WorkspaceWatcher {
  private readonly events: EventBus
  private readonly watchers = new Map<string, { watcher: FSWatcher; pending: Map<string, string>; batchStarted: number; timer: NodeJS.Timeout | null }>()

  constructor(events: EventBus) {
    this.events = events
  }

  watch(projectId: string, root: string): void {
    this.unwatch(projectId)
    const cwd = (() => {
      try {
        return resolve(root)
      } catch {
        return root
      }
    })()
    let watcher: FSWatcher
    try {
      watcher = watch(cwd, { recursive: true }, (eventType, filename) => {
        if (!filename) return
        const relativePath = toPosix(String(filename))
        if (relativePath === '' || ignoredComponent(relativePath)) return
        const record = this.watchers.get(projectId)
        if (!record) return
        const kind = eventType === 'rename' ? 'rename' : 'modify'
        record.pending.set(relativePath, kind)
        if (record.batchStarted === 0) record.batchStarted = nowMs()
        if (record.pending.size >= MAX_PENDING) {
          this.flush(projectId)
          return
        }
        if (record.timer) return
        record.timer = setTimeout(() => this.flush(projectId), MAX_WATCH_DELAY_MS)
        record.timer.unref()
      })
    } catch {
      // recursive watch không khả dụng — bỏ qua giám sát giống khi inotify init thất bại
      return
    }
    watcher.on('error', () => this.unwatch(projectId))
    this.watchers.set(projectId, { watcher, pending: new Map(), batchStarted: 0, timer: null })
  }

  unwatch(projectId: string): void {
    const record = this.watchers.get(projectId)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    try {
      record.watcher.close()
    } catch {
      // ignore
    }
    this.watchers.delete(projectId)
  }

  unwatchAll(): void {
    for (const projectId of [...this.watchers.keys()]) this.unwatch(projectId)
  }

  private flush(projectId: string): void {
    const record = this.watchers.get(projectId)
    if (!record) return
    if (record.timer) {
      clearTimeout(record.timer)
      record.timer = null
    }
    if (record.pending.size === 0) {
      record.batchStarted = 0
      return
    }
    const pending: PendingChange[] = [...record.pending.entries()].map(([path, kind]) => ({ path, kind }))
    record.pending.clear()
    record.batchStarted = 0
    for (const { path, kind } of pending) {
      this.events.emit('workspace.file.changed', { projectId, path, kind })
    }
    this.events.emit('git.status.changed', { projectId })
  }
}
