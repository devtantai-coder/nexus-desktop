import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { NexusError } from './errors.ts'
import { readFileSync, writeFileAtomic } from './util.ts'

/** Hai tệp bộ nhớ bền vững, nằm trong user-data của ứng dụng. */
export const MEMORY_FILES = ['MEMORY.md', 'USER.md'] as const
export type MemoryFileKind = (typeof MEMORY_FILES)[number]

export const MAX_MEMORY_FILE_BYTES = 200_000

const TEMPLATES: Record<MemoryFileKind, string> = {
  'MEMORY.md':
    '# MEMORY\n\nGhi chú dự án, quy ước và quy trình mà NEXUS nên nhớ giữa các phiên.\n' +
    'Mỗi dòng là một sự thật ngắn gọn; agent đọc tệp này khi bắt đầu mỗi task.\n',
  'USER.md':
    '# USER\n\nThông tin về người dùng: ngôn ngữ ưa thích, vai trò, cách làm việc.\n' +
    'Chỉ lưu thông tin người dùng thật, không lưu bí mật hay khoá API.\n',
}

export interface MemoryFileRecord {
  kind: MemoryFileKind
  path: string
  content: string
  size: number
  updatedAt: number | null
  template: boolean
}

export function isMemoryFileKind(value: unknown): value is MemoryFileKind {
  return typeof value === 'string' && (MEMORY_FILES as readonly string[]).includes(value)
}

function requireKind(value: unknown): MemoryFileKind {
  if (!isMemoryFileKind(value)) {
    throw new NexusError('E_VALIDATION', 'Memory file must be MEMORY.md or USER.md')
  }
  return value
}

/**
 * Quản lý hai tệp bộ nhớ dùng chung cho mọi phiên chat. Ghi atomic, giới hạn
 * kích thước và chỉ nhận tên tệp cố định để chặn path traversal.
 */
export class MemoryManager {
  private readonly userDataDir: string

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir
  }

  pathFor(kind: MemoryFileKind): string {
    return join(this.userDataDir, requireKind(kind))
  }

  read(kind: MemoryFileKind): MemoryFileRecord {
    const file = requireKind(kind)
    const path = this.pathFor(file)
    if (!existsSync(path)) {
      writeFileAtomic(path, TEMPLATES[file])
    }
    const content = readFileSync(path, MAX_MEMORY_FILE_BYTES)
    let updatedAt: number | null = null
    try {
      updatedAt = Math.trunc(statSync(path).mtimeMs)
    } catch {
      updatedAt = null
    }
    return {
      kind: file,
      path,
      content,
      size: content.length,
      updatedAt,
      template: content.trim() === TEMPLATES[file].trim(),
    }
  }

  files(): MemoryFileRecord[] {
    return MEMORY_FILES.map((kind) => this.read(kind))
  }

  write(kind: MemoryFileKind, content: unknown): MemoryFileRecord {
    const file = requireKind(kind)
    if (typeof content !== 'string') {
      throw new NexusError('E_VALIDATION', 'Memory content must be a string')
    }
    if (content.length > MAX_MEMORY_FILE_BYTES) {
      throw new NexusError('E_VALIDATION', 'Memory content is too large')
    }
    const path = this.pathFor(file)
    if (!writeFileAtomic(path, content)) {
      throw new NexusError('E_IO', `Cannot write ${file}`)
    }
    return this.read(file)
  }

  /** Dòng đưa vào system prompt; bỏ qua nội dung mẫu chưa được chỉnh sửa. */
  promptLines(limit = 2000): string[] {
    const lines: string[] = []
    for (const kind of MEMORY_FILES) {
      const record = this.read(kind)
      if (record.template || record.content.trim() === '') continue
      const content =
        record.content.length > limit ? `${record.content.slice(0, limit)}…` : record.content
      lines.push(`${kind}:\n${content.trim()}`)
    }
    return lines
  }
}
