import { existsSync, readdirSync } from 'node:fs'
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

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS widgets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
`
const CHECK_MJS = `import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

const db = new DatabaseSync(':memory:')
db.exec(readFileSync('schema.sql', 'utf8'))
const insert = db.prepare('INSERT INTO widgets (name) VALUES (?)')
insert.run('alpha')
insert.run('beta')
insert.run('gamma')
const row = db.prepare('SELECT count(*) AS n FROM widgets').get()
console.log('widgets=' + String(row.n))
if (Number(row.n) !== 3) process.exit(1)
`
const README = `# NEXUS Database project

Schema SQLite chạy thật qua node:sqlite (built-in). Không cần server ngoài.

\`\`\`sh
node check.mjs   # tạo bảng, insert 3 dòng, in widgets=3
\`\`\`

MySQL/PostgreSQL/MongoDB/Redis cần service thật; client có thể có sẵn nhưng service phải chạy.
`

const SERVER_NOTE = 'Client only — service thật phải chạy riêng (chưa được verify)'

export class DatabaseDomain extends BaseDomainAdapter {
  readonly id = 'database'
  readonly label = 'Database & Data'
  readonly description =
    'SQLite/MySQL/MongoDB/Redis — schema, migration, query thật; node:sqlite built-in'
  readonly platforms: Platform[] = ['linux', 'darwin', 'win32']
  readonly tools: ToolMetadata[] = [
    defineTool('sqlite3', 'SQLite CLI', 'database', 'sqlite3', ['cli', 'sql'], {
      installationGuide: 'apt-get install -y sqlite3',
      installCommand: 'apt-get install -y sqlite3',
      requiresRoot: true,
    }),
    defineTool('psql', 'PostgreSQL client', 'database', 'psql', ['cli', 'sql', 'postgres'], {
      description: `PostgreSQL client. ${SERVER_NOTE}`,
      installationGuide: 'apt-get install -y postgresql-client',
      installCommand: 'apt-get install -y postgresql-client',
      requiresRoot: true,
    }),
    defineTool('mysql', 'MySQL/MariaDB client', 'database', 'mysql', ['cli', 'sql', 'mysql'], {
      description: `MySQL/MariaDB client. ${SERVER_NOTE}`,
    }),
    defineTool('mongosh', 'MongoDB Shell', 'database', 'mongosh', ['cli', 'document', 'mongo'], {
      description: `MongoDB shell. ${SERVER_NOTE}`,
      installationGuide: 'Install from mongodb.com or your package manager',
    }),
    defineTool('redis-cli', 'Redis CLI', 'database', 'redis-cli', ['cli', 'key-value', 'redis'], {
      description: `Redis client. ${SERVER_NOTE}`,
      installationGuide: 'apt-get install -y redis-tools',
      installCommand: 'apt-get install -y redis-tools',
      requiresRoot: true,
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    if (existsSync(join(root, 'schema.sql'))) reasons.push('schema.sql')
    if (existsSync(join(root, 'migrations'))) reasons.push('migrations')
    if (existsSync(join(root, 'prisma'))) reasons.push('prisma')
    if (existsSync(join(root, 'drizzle.config.ts'))) reasons.push('drizzle')
    try {
      if (readdirSync(root).some((entry) => entry.endsWith('.sql'))) reasons.push('*.sql')
    } catch {
      // ignore unreadable root
    }
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.5 + reasons.length * 0.2), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['schema.sql', SCHEMA_SQL],
      ['check.mjs', CHECK_MJS],
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
    const result = await runCommand(
      `node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');db.exec(require('node:fs').readFileSync('schema.sql','utf8'));console.log('schema ok')"`,
      input.path,
      60_000,
    )
    return { ...result, artifacts: result.ok ? ['schema.sql'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand('node check.mjs', input.path, 60_000)
    return { ...result, passed: 0, failed: 0 }
  }
}
