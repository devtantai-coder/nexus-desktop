import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { isDirectory } from '../util.ts'
import type { DomainMatch } from './types.ts'

/**
 * Bộ phân loại intent domain thuần deterministic (không gọi model).
 * Lý do: chưa có provider được probe và mục tiêu là không fake. Kết quả là gợi ý
 * (confidence + reasons), không phải quyết định chắc chắn; agent vẫn tự chọn tool.
 */

interface Keyword {
  kw: string
  weight: number
}

const KEYWORDS: Record<string, Keyword[]> = {
  web: [
    { kw: 'react', weight: 3 },
    { kw: 'vue', weight: 3 },
    { kw: 'svelte', weight: 3 },
    { kw: 'nextjs', weight: 3 },
    { kw: 'vite', weight: 2 },
    { kw: 'frontend', weight: 2 },
    { kw: 'website', weight: 3 },
    { kw: 'web', weight: 1 },
    { kw: 'tailwind', weight: 2 },
    { kw: 'css', weight: 2 },
    { kw: 'html', weight: 2 },
    { kw: 'component', weight: 1 },
    { kw: 'npm', weight: 1 },
    { kw: 'typescript', weight: 1 },
    { kw: 'trang web', weight: 3 },
  ],
  systems: [
    { kw: 'cmake', weight: 3 },
    { kw: 'c++', weight: 3 },
    { kw: 'g++', weight: 3 },
    { kw: 'gcc', weight: 2 },
    { kw: 'rust', weight: 3 },
    { kw: 'cargo', weight: 2 },
    { kw: 'golang', weight: 3 },
    { kw: 'go module', weight: 2 },
    { kw: 'makefile', weight: 3 },
    { kw: 'biên dịch', weight: 3 },
    { kw: 'compile', weight: 1 },
    { kw: 'toolchain', weight: 1 },
    { kw: 'gdb', weight: 2 },
    { kw: 'ninja', weight: 2 },
  ],
  aiml: [
    { kw: 'torch', weight: 3 },
    { kw: 'pytorch', weight: 3 },
    { kw: 'tensorflow', weight: 3 },
    { kw: 'transformers', weight: 3 },
    { kw: 'machine learning', weight: 3 },
    { kw: 'deep learning', weight: 3 },
    { kw: 'neural', weight: 2 },
    { kw: 'dataset', weight: 2 },
    { kw: 'training', weight: 2 },
    { kw: 'onnx', weight: 2 },
    { kw: 'mô hình', weight: 2 },
    { kw: 'huấn luyện', weight: 3 },
    { kw: 'python', weight: 1 },
    { kw: 'scikit', weight: 2 },
    { kw: 'notebook', weight: 1 },
    { kw: 'ipynb', weight: 2 },
  ],
  embedded: [
    { kw: 'arduino', weight: 3 },
    { kw: 'esp32', weight: 3 },
    { kw: 'stm32', weight: 3 },
    { kw: 'firmware', weight: 3 },
    { kw: 'platformio', weight: 3 },
    { kw: 'microcontroller', weight: 3 },
    { kw: 'nhúng', weight: 3 },
    { kw: 'gpio', weight: 2 },
    { kw: 'mcu', weight: 2 },
    { kw: 'uart', weight: 2 },
    { kw: 'i2c', weight: 2 },
    { kw: 'spi', weight: 1 },
  ],
  database: [
    { kw: 'sqlite', weight: 3 },
    { kw: 'postgres', weight: 3 },
    { kw: 'mysql', weight: 3 },
    { kw: 'mongodb', weight: 3 },
    { kw: 'redis', weight: 3 },
    { kw: 'sql', weight: 2 },
    { kw: 'migration', weight: 2 },
    { kw: 'schema', weight: 2 },
    { kw: 'database', weight: 2 },
    { kw: 'query', weight: 1 },
    { kw: 'truy vấn', weight: 2 },
    { kw: 'cơ sở dữ liệu', weight: 3 },
  ],
  devops: [
    { kw: 'docker', weight: 3 },
    { kw: 'kubernetes', weight: 3 },
    { kw: 'k8s', weight: 3 },
    { kw: 'terraform', weight: 3 },
    { kw: 'ansible', weight: 3 },
    { kw: 'dockerfile', weight: 3 },
    { kw: 'compose', weight: 2 },
    { kw: 'ci/cd', weight: 3 },
    { kw: 'pipeline', weight: 2 },
    { kw: 'deploy', weight: 1 },
    { kw: 'helm', weight: 2 },
    { kw: 'container', weight: 2 },
    { kw: 'triển khai', weight: 2 },
  ],
  security: [
    { kw: 'nmap', weight: 3 },
    { kw: 'vulnerab', weight: 2 },
    { kw: 'sast', weight: 3 },
    { kw: 'security', weight: 2 },
    { kw: 'pentest', weight: 3 },
    { kw: 'bảo mật', weight: 3 },
    { kw: 'secret scan', weight: 3 },
    { kw: 'xss', weight: 2 },
    { kw: 'csrf', weight: 2 },
    { kw: 'audit', weight: 1 },
    { kw: 'trivy', weight: 3 },
    { kw: 'semgrep', weight: 3 },
  ],
  game: [
    { kw: 'godot', weight: 3 },
    { kw: 'unity', weight: 3 },
    { kw: 'unreal', weight: 3 },
    { kw: 'blender', weight: 2 },
    { kw: 'game', weight: 2 },
    { kw: 'trò chơi', weight: 3 },
    { kw: 'sprite', weight: 2 },
    { kw: 'scene', weight: 1 },
    { kw: 'gameplay', weight: 2 },
  ],
  mobile: [
    { kw: 'android', weight: 3 },
    { kw: 'flutter', weight: 3 },
    { kw: 'kotlin', weight: 3 },
    { kw: 'swift', weight: 3 },
    { kw: 'ios', weight: 2 },
    { kw: 'apk', weight: 3 },
    { kw: 'mobile', weight: 2 },
    { kw: 'adb', weight: 3 },
    { kw: 'điện thoại', weight: 2 },
  ],
  desktop: [
    { kw: 'qt', weight: 3 },
    { kw: 'electron', weight: 3 },
    { kw: 'qwidgets', weight: 3 },
    { kw: 'gtk', weight: 2 },
    { kw: 'desktop', weight: 2 },
    { kw: 'native app', weight: 2 },
    { kw: 'ứng dụng desktop', weight: 3 },
    { kw: 'qmake', weight: 2 },
  ],
}

const MARKER_MAP: Record<string, string> = {
  'package.json': 'web',
  'vite.config.ts': 'web',
  'vite.config.js': 'web',
  'index.html': 'web',
  'pnpm-lock.yaml': 'web',
  'CMakeLists.txt': 'systems',
  Makefile: 'systems',
  'Cargo.toml': 'systems',
  'go.mod': 'systems',
  'pom.xml': 'systems',
  'pyproject.toml': 'aiml',
  'requirements.txt': 'aiml',
  'environment.yml': 'aiml',
  'setup.py': 'aiml',
  'platformio.ini': 'embedded',
  'schema.sql': 'database',
  migrations: 'database',
  prisma: 'database',
  Dockerfile: 'devops',
  'docker-compose.yml': 'devops',
  'compose.yaml': 'devops',
  '.github/workflows': 'devops',
  Jenkinsfile: 'devops',
  'semgrep.yml': 'security',
  'trivy.yaml': 'security',
  'SECURITY.md': 'security',
  'project.godot': 'game',
  'AndroidManifest.xml': 'mobile',
  'pubspec.yaml': 'mobile',
}

const SUFFIX_MAP: Record<string, string> = {
  '.ipynb': 'aiml',
  '.ino': 'embedded',
  '.tscn': 'game',
  '.gd': 'game',
  '.pro': 'desktop',
  '.ui': 'desktop',
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const countOccurrences = (haystack: string, needle: string): number => {
  // Boundary chỉ kiểm tra chữ/số: dấu / . + - # là ranh giới hợp lệ.
  // Dùng lookahead để không tiêu thụ ký tự đó → từ lặp liền nhau vẫn đếm đủ.
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`, 'gi')
  return (haystack.match(pattern) ?? []).length
}

/** Thu thập marker file ở root (tối đa 1 cấp con cho migrations/workflows). */
export function collectMarkers(root: string): string[] {
  const markers: string[] = []
  try {
    const entries = readdirSync(root)
    for (const entry of entries) {
      if (Object.hasOwn(MARKER_MAP, entry)) {
        markers.push(entry)
        continue
      }
      const dot = entry.lastIndexOf('.')
      const suffix = dot >= 0 ? entry.slice(dot).toLowerCase() : ''
      if (Object.hasOwn(SUFFIX_MAP, suffix)) {
        markers.push(`${entry}`)
      }
      if (entry === '.github' && isDirectory(join(root, '.github', 'workflows'))) {
        markers.push('.github/workflows')
      }
    }
    if (existsSync(join(root, 'src', 'main', 'AndroidManifest.xml'))) {
      markers.push('AndroidManifest.xml')
    }
  } catch {
    return []
  }
  return markers
}

const domainOfMarker = (marker: string): string | null => {
  if (Object.hasOwn(MARKER_MAP, marker)) return MARKER_MAP[marker] ?? null
  const dot = marker.lastIndexOf('.')
  const suffix = dot >= 0 ? marker.slice(dot).toLowerCase() : ''
  if (Object.hasOwn(SUFFIX_MAP, suffix)) return SUFFIX_MAP[suffix] ?? null
  return null
}

export interface IntentInput {
  prompt: string
  markers?: string[]
  availableDomainIds?: string[]
}

/** Phân loại prompt thành tối đa 3 domain match, confidence 0..0.95. Domain không match → []. */
export function classifyPromptIntent(input: IntentInput): DomainMatch[] {
  const prompt = input.prompt.toLowerCase()
  const available = input.availableDomainIds
  const scores = new Map<string, { score: number; hits: string[] }>()
  const bump = (domain: string, weight: number, hit: string): void => {
    if (available !== undefined && !available.includes(domain)) return
    const entry = scores.get(domain) ?? { score: 0, hits: [] }
    entry.score += weight
    if (!entry.hits.includes(hit)) entry.hits.push(hit)
    scores.set(domain, entry)
  }
  for (const [domain, keywords] of Object.entries(KEYWORDS)) {
    for (const { kw, weight } of keywords) {
      const hits = countOccurrences(prompt, kw)
      if (hits > 0) bump(domain, weight * hits, kw)
    }
  }
  for (const marker of input.markers ?? []) {
    const domain = domainOfMarker(marker)
    if (domain !== null) bump(domain, 2, `marker:${marker}`)
  }
  const matches: DomainMatch[] = []
  for (const [domainId, { score, hits }] of scores) {
    if (score <= 0) continue
    matches.push({
      domainId,
      confidence: Math.min(0.95, Math.round((0.35 + 0.12 * score) * 100) / 100),
      reasons: hits.slice(0, 6),
    })
  }
  matches.sort((a, b) => b.confidence - a.confidence || a.domainId.localeCompare(b.domainId))
  return matches.slice(0, 3)
}
