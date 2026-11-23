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

const SCAN_SH = `#!/bin/sh
# Chỉ quét loopback. Không quét mạng khác — security chỉ cho hệ thống bạn sở hữu/ủy quyền.
set -e
TARGET="127.0.0.1"
PORT="$1"
case "$PORT" in
  ''|*[!0-9]*) echo "usage: sh scan.sh <port>" >&2; exit 64 ;;
esac
exec nmap -Pn -p "$PORT" "$TARGET" -oN scan.txt
`
const TARGETS = `127.0.0.1
`
const SECURITY_MD = `# NEXUS Security project

Phạm vi: chỉ hệ thống bạn sở hữu hoặc được ủy quyền. Scan loopback để verify.

\`\`\`sh
sh scan.sh 18766   # quét 127.0.0.1:18766, ghi scan.txt
\`\`\`

Semgrep/Trivy/gitleaks/bandit là tùy chọn, cần cài có xác nhận trước khi dùng.
`

export class SecurityDomain extends BaseDomainAdapter {
  readonly id = 'security'
  readonly label = 'Cybersecurity'
  readonly description =
    'nmap loopback (authorized-only) + SAST/secret tool khi cài; không tấn công hệ thống ngoài'
  readonly platforms: Platform[] = ['linux', 'darwin']
  readonly tools: ToolMetadata[] = [
    defineTool('nmap', 'Nmap', 'security', 'nmap', ['network-scan', 'recon'], {
      description: 'Network scanner — authorized/own systems only; scaffold chỉ quét 127.0.0.1',
      installationGuide: 'apt-get install -y nmap',
      installCommand: 'apt-get install -y nmap',
      requiresRoot: true,
      permissions: ['exec', 'network'],
    }),
    defineTool('tshark', 'tshark', 'security', 'tshark', ['packet-capture'], {
      installationGuide: 'apt-get install -y tshark',
      installCommand: 'apt-get install -y tshark',
      requiresRoot: true,
      permissions: ['exec', 'network'],
    }),
    defineTool('semgrep', 'Semgrep', 'security', 'semgrep', ['sast'], {
      installationGuide: 'pip install semgrep (hoặc uv tool install semgrep)',
      installCommand: 'python3 -m pip install --user semgrep',
    }),
    defineTool('trivy', 'Trivy', 'security', 'trivy', ['vuln-scan', 'container-scan'], {
      installationGuide:
        'apt-get install -y trivy (cần repo Aqua) hoặc download binary từ GitHub releases',
      permissions: ['exec', 'network'],
    }),
    defineTool('gitleaks', 'gitleaks', 'security', 'gitleaks', ['secret-scan'], {
      installationGuide: 'Download binary từ GitHub releases hoặc apt',
    }),
    defineTool('bandit', 'Bandit', 'security', 'bandit', ['sast', 'python'], {
      installationGuide: 'python3 -m pip install --user bandit',
      installCommand: 'python3 -m pip install --user bandit',
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    for (const file of [
      'semgrep.yml',
      'trivy.yaml',
      '.gitleaks.toml',
      'SECURITY.md',
      'targets.txt',
    ]) {
      if (existsSync(join(root, file))) reasons.push(file)
    }
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.5 + reasons.length * 0.2), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['scan.sh', SCAN_SH],
      ['targets.txt', TARGETS],
      ['SECURITY.md', SECURITY_MD],
    ]
    for (const [relative, content] of files) {
      if (!writeFileAtomic(join(root, relative), content)) {
        return { ok: false, path: root, files: [], error: `Cannot write ${relative}` }
      }
    }
    return { ok: true, path: root, files: files.map(([relative]) => relative) }
  }

  override async build(_context: DomainContext, input: { path: string }): Promise<BuildResult> {
    const result = await runCommand('sh -n scan.sh', input.path, 30_000)
    return { ...result, artifacts: result.ok ? ['scan.sh'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand('sh scan.sh 18766', input.path, 60_000)
    return { ...result, passed: 0, failed: 0 }
  }
}
