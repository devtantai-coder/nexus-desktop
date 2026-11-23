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

const DOCKERFILE = `FROM node:22-alpine
WORKDIR /app
COPY . .
CMD ["node", "--version"]
`
const COMPOSE_YAML = `services:
  app:
    build: .
    image: nexus-devops-app
    healthcheck:
      test: ["CMD", "true"]
      interval: 5s
      timeout: 2s
      retries: 1
`
const CI_YAML = `name: ci
on: [push]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node --version
`
const README = `# NEXUS DevOps project

Dockerfile + docker-compose.yml + GitHub Actions workflow, validate được offline.

\`\`\`sh
docker compose config --quiet   # validate compose (không build, không pull)
python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('**/*.y*ml', recursive=True) + ['docker-compose.yml']]"
\`\`\`

Build/push/deploy cloud thật cần xác nhận của bạn và credentials thật; mặc định scaffold không deploy.
`

export class DevOpsDomain extends BaseDomainAdapter {
  readonly id = 'devops'
  readonly label = 'DevOps & Cloud'
  readonly description =
    'Docker, Compose, CI/CD YAML — validate thật; kubectl/terraform/ansible/helm khi cài'
  readonly platforms: Platform[] = ['linux', 'darwin', 'win32']
  readonly tools: ToolMetadata[] = [
    defineTool('docker', 'Docker', 'devops', 'docker', ['container', 'build', 'compose'], {
      description: 'Docker engine + compose plugin; builds pull base images over the network',
      installationGuide: 'apt-get install -y docker.io docker-compose-v2',
      installCommand: 'apt-get install -y docker.io docker-compose-v2',
      requiresRoot: true,
      permissions: ['exec', 'network'],
    }),
    defineTool('kubectl', 'kubectl', 'devops', 'kubectl', ['kubernetes', 'deploy'], {
      installationGuide: 'Install from kubernetes.io or apt kubernetes-clients',
      installCommand: 'apt-get install -y kubectl',
      requiresRoot: true,
      permissions: ['exec', 'network'],
    }),
    defineTool('terraform', 'Terraform', 'devops', 'terraform', ['iac', 'cloud'], {
      installationGuide: 'Install from HashiCorp apt repo (repo.hashicorp.com)',
      permissions: ['exec', 'network'],
    }),
    defineTool('ansible', 'Ansible', 'devops', 'ansible', ['config-mgmt'], {
      installationGuide: 'apt-get install -y ansible',
      installCommand: 'apt-get install -y ansible',
      requiresRoot: true,
    }),
    defineTool('helm', 'Helm', 'devops', 'helm', ['kubernetes', 'package'], {
      installationGuide: 'Install from helm.sh or apt helm',
      permissions: ['exec', 'network'],
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    for (const file of [
      'Dockerfile',
      'docker-compose.yml',
      'compose.yaml',
      'Jenkinsfile',
      '.gitlab-ci.yml',
    ]) {
      if (existsSync(join(root, file))) reasons.push(file)
    }
    if (existsSync(join(root, '.github', 'workflows'))) reasons.push('.github/workflows')
    if (existsSync(join(root, 'terraform'))) reasons.push('terraform')
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.5 + reasons.length * 0.2), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['Dockerfile', DOCKERFILE],
      ['docker-compose.yml', COMPOSE_YAML],
      ['.github/workflows/ci.yml', CI_YAML],
      ['README.md', README],
    ]
    for (const [relative, content] of files) {
      if (!writeFileAtomic(join(root, relative), content)) {
        return { ok: false, path: root, files: [], error: `Cannot write ${relative}` }
      }
    }
    return { ok: true, path: root, files: files.map(([relative]) => relative) }
  }

  override async build(_context: DomainContext, input: { path: string }): Promise<BuildResult> {
    const result = await runCommand('docker compose config --quiet', input.path, 60_000)
    return { ...result, artifacts: result.ok ? ['docker-compose.yml'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand(
      `python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('**/*.y*ml', recursive=True) + ['docker-compose.yml']]; print('yaml ok')"`,
      input.path,
      60_000,
    )
    return { ...result, passed: 0, failed: 0 }
  }
}
