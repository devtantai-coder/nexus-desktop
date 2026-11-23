import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { writeFileAtomic } from '../../util.ts'
import { runCommand } from '../../domain/runner.ts'
import type {
  BuildResult,
  DomainContext,
  DomainMatch,
  Platform,
  ProjectInput,
  ProjectResult,
  TestResult,
  ToolMetadata,
} from '../../domain/types.ts'
import { BaseDomainAdapter, defineTool } from '../base.ts'

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'nexus-web-project',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { build: 'node --check src/main.js', test: 'node --test' },
  },
  null,
  2,
)

const MAIN_JS = `export function greet(name) {\n  return \`Hello, \${name}!\`\n}\n`
const TEST_JS = `import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { greet } from '../src/main.js'\n\ntest('greet returns a greeting', () => {\n  assert.equal(greet('NEXUS'), 'Hello, NEXUS!')\n})\n`
const INDEX_HTML = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>NEXUS Web</title></head><body><script type="module" src="/src/main.js"></script></body></html>\n`

export class WebDomain extends BaseDomainAdapter {
  readonly id = 'web'
  readonly label = 'Web Development'
  readonly description = 'HTML/CSS/JS/TS, Node.js, Vite, pnpm/npm/bun and browser tooling'
  readonly platforms: Platform[] = ['linux', 'darwin', 'win32']
  readonly tools: ToolMetadata[] = [
    defineTool('node', 'Node.js', 'web', 'node', ['runtime', 'build', 'test'], {
      description: 'JavaScript runtime used for web projects and test execution',
      installationGuide: 'Install Node.js >= 22 from nodejs.org or your package manager',
      requiresRoot: true,
    }),
    defineTool('npm', 'npm', 'web', 'npm', ['package-manager'], {
      installationGuide: 'Bundled with Node.js',
      installCommand: 'corepack enable',
    }),
    defineTool('pnpm', 'pnpm', 'web', 'pnpm', ['package-manager'], {
      installationGuide: 'corepack enable && corepack prepare pnpm@latest --activate',
      installCommand: 'corepack enable',
    }),
    defineTool('bun', 'bun', 'web', 'bun', ['runtime', 'package-manager'], {
      installationGuide: 'Install from bun.sh',
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    if (existsSync(join(root, 'package.json'))) reasons.push('package.json')
    if (existsSync(join(root, 'vite.config.ts')) || existsSync(join(root, 'vite.config.js'))) {
      reasons.push('vite.config')
    }
    if (existsSync(join(root, 'index.html'))) reasons.push('index.html')
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.5 + reasons.length * 0.15), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['package.json', PACKAGE_JSON],
      ['index.html', INDEX_HTML],
      ['src/main.js', MAIN_JS],
      ['test/smoke.test.js', TEST_JS],
    ]
    for (const [relative, content] of files) {
      if (!writeFileAtomic(join(root, relative), content)) {
        return { ok: false, path: root, files: [], error: `Cannot write ${relative}` }
      }
    }
    return { ok: true, path: root, files: files.map(([relative]) => relative) }
  }

  override async build(_context: DomainContext, input: { path: string }): Promise<BuildResult> {
    const result = await runCommand('node --check src/main.js', input.path, 120_000)
    return { ...result, artifacts: result.ok ? ['src/main.js'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand('node --test', input.path, 180_000)
    return { ...result, passed: 0, failed: 0 }
  }
}
