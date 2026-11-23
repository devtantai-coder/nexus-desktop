import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Core } from '../index.ts'
import { DependencyManager } from '../domain/dependency.ts'
import { EnvironmentManager } from '../domain/environment.ts'
import { standardDomains } from '../domain/registry.ts'
import type { DomainContext, Platform } from '../domain/types.ts'
import { BaseDomainAdapter, defineTool } from '../domains/base.ts'
import { Store } from '../store.ts'

const withCore = async (fn: (core: Core, dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-domain-test-'))
  const core = new Core({
    databasePath: join(dir, 'nexus.db'),
    userDataDir: dir,
    appVersion: 'test',
  })
  try {
    core.initialize()
    await fn(core, dir)
  } finally {
    core.shutdown()
    rmSync(dir, { recursive: true, force: true })
  }
}

const contextFor = async (root: string | null): Promise<DomainContext> => {
  const environment = new EnvironmentManager()
  return {
    workspaceRoot: root,
    environment: await environment.snapshot([
      'node',
      'gcc',
      'g++',
      'cmake',
      'ninja',
      'nexus-no-such-tool-xyz',
    ]),
    settings: { projectsRoot: root ?? '' },
  }
}

class FakeDomain extends BaseDomainAdapter {
  readonly id = 'fake'
  readonly label = 'Fake'
  readonly description = 'approval gate probe'
  readonly platforms: Platform[] = ['linux']
  readonly tools = [
    defineTool('ghost', 'Ghost', 'fake', 'nexus-no-such-tool-xyz', ['probe'], {
      requiresRoot: true,
      installCommand: 'echo ghost',
      supportedPlatforms: ['linux'],
    }),
  ]
}

test('domain: registry, environment detection and honest metadata', async () => {
  const registry = standardDomains(
    new (await import('../domains/web/index.ts')).WebDomain(),
    new (await import('../domains/systems/index.ts')).SystemsDomain(),
    new (await import('../domains/aiml/index.ts')).AiMlDomain(),
    new (await import('../domains/embedded/index.ts')).EmbeddedDomain(),
    new (await import('../domains/devops/index.ts')).DevOpsDomain(),
    new (await import('../domains/security/index.ts')).SecurityDomain(),
    new (await import('../domains/game/index.ts')).GameDomain(),
    new (await import('../domains/database/index.ts')).DatabaseDomain(),
    new (await import('../domains/mobile/index.ts')).MobileDomain(),
    new (await import('../domains/desktop/index.ts')).DesktopDomain(),
  )
  const summaries = registry.summaries()
  assert.deepEqual(
    summaries.map((entry) => entry.id),
    [
      'web',
      'systems',
      'aiml',
      'embedded',
      'devops',
      'security',
      'game',
      'database',
      'mobile',
      'desktop',
    ],
  )
  assert.ok((summaries[0]?.toolCount ?? 0) >= 3)

  const context = await contextFor(null)
  assert.equal(context.environment.platform, 'linux')
  assert.equal(context.environment.tools['node']?.available, true)
  assert.equal(context.environment.tools['g++']?.available, true)
  assert.equal(context.environment.tools['nexus-no-such-tool-xyz']?.available, false)
  assert.ok((context.environment.tools['node']?.version ?? '').includes('v'))
  const web = registry.get('web')
  assert.ok(web !== null)
  assert.equal(web.detect(context).length, 0, 'no project root means no detection')
  const plan = web.plan(context)
  assert.ok(plan.items.length >= 3)
})

test('dependency: plan, approval gate, root refusal and audit log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-dep-test-'))
  const store = new Store(join(dir, 'nexus.db'))
  store.migrate()
  try {
    const environment = new EnvironmentManager()
    const manager = new DependencyManager(store, environment)
    const domain = new FakeDomain()
    const context = await contextFor(null)
    const plan = manager.plan(domain, context)
    assert.deepEqual(plan.missing, ['ghost'])

    const denied = await manager.install(domain, ['ghost'], false, context)
    assert.equal(denied[0]?.reason, 'requires-approval')
    const approved = await manager.install(domain, ['ghost'], true, context)
    assert.equal(approved[0]?.reason, 'requires-root')
    assert.equal(approved[0]?.manualCommand, 'echo ghost')
    assert.equal(approved[0]?.verified, false)
    assert.ok(store.dependencyEvents(10).length >= 1)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('domain IPC: web project create → build → test with real node', async () => {
  await withCore(async (core) => {
    const list = await core.request('domain.list', undefined)
    assert.deepEqual(
      list.map((entry: { id: string }) => entry.id),
      [
        'web',
        'systems',
        'aiml',
        'embedded',
        'devops',
        'security',
        'game',
        'database',
        'mobile',
        'desktop',
      ],
    )

    const tools = await core.request('domain.tools', undefined)
    assert.ok(Array.isArray(tools))
    assert.equal(
      (tools as Array<{ availability: string }>).every(
        (tool) => tool.availability === 'available' || tool.availability === 'missing',
      ),
      true,
    )

    const created = await core.request('domain.action', {
      domainId: 'web',
      action: 'project.create',
      name: 'probe-web',
    })
    assert.equal(created.ok, true)
    assert.equal(existsSync(join(created.path, 'package.json')), true)

    const build = await core.request('domain.action', {
      domainId: 'web',
      action: 'build',
      path: created.path,
    })
    assert.equal(build.ok, true, String(build.output))
    const test = await core.request('domain.action', {
      domainId: 'web',
      action: 'test',
      path: created.path,
    })
    assert.equal(test.ok, true, String(test.output))
    assert.ok(Number(test.passed) >= 1)

    const plan = await core.request('domain.dependency.plan', { domainId: 'web' })
    assert.equal((plan.missing as string[]).includes('node'), false)

    const opened = await core.request('project.open', { path: created.path })
    const detections = await core.request('domain.detect', { projectId: opened.id })
    assert.ok((detections as Array<{ domainId: string }>).some((entry) => entry.domainId === 'web'))
  })
})

test('domain IPC: systems project build and ctest with real cmake/ninja', async () => {
  await withCore(async (core) => {
    const created = await core.request('domain.action', {
      domainId: 'systems',
      action: 'project.create',
      name: 'probe-systems',
    })
    assert.equal(created.ok, true)
    const build = await core.request('domain.action', {
      domainId: 'systems',
      action: 'build',
      path: created.path,
    })
    assert.equal(build.ok, true, String(build.output))
    const test = await core.request('domain.action', {
      domainId: 'systems',
      action: 'test',
      path: created.path,
    })
    assert.equal(test.ok, true, String(test.output))
    assert.equal(Number(test.failed), 0)
  })
})

test('domain IPC: aiml project build and real pytest training smoke', async () => {
  await withCore(async (core) => {
    const created = await core.request('domain.action', {
      domainId: 'aiml',
      action: 'project.create',
      name: 'probe-aiml',
    })
    assert.equal(created.ok, true)
    assert.equal(existsSync(join(created.path, 'train.py')), true)
    const build = await core.request('domain.action', {
      domainId: 'aiml',
      action: 'build',
      path: created.path,
    })
    assert.equal(build.ok, true, String(build.output))
    const test = await core.request('domain.action', {
      domainId: 'aiml',
      action: 'test',
      path: created.path,
    })
    assert.equal(test.ok, true, String(test.output))
    assert.ok(Number(test.passed) >= 2)
  })
})

test('domain IPC: database/devops/security/desktop build and test with real tools', async () => {
  await withCore(async (core) => {
    const database = await core.request('domain.action', {
      domainId: 'database',
      action: 'project.create',
      name: 'probe-database',
    })
    assert.equal(database.ok, true)
    const dbBuild = await core.request('domain.action', {
      domainId: 'database',
      action: 'build',
      path: database.path,
    })
    assert.equal(dbBuild.ok, true, String(dbBuild.output))
    const dbTest = await core.request('domain.action', {
      domainId: 'database',
      action: 'test',
      path: database.path,
    })
    assert.equal(dbTest.ok, true, String(dbTest.output))
    assert.ok(String(dbTest.output).includes('widgets=3'))

    const devops = await core.request('domain.action', {
      domainId: 'devops',
      action: 'project.create',
      name: 'probe-devops',
    })
    assert.equal(devops.ok, true)
    const doBuild = await core.request('domain.action', {
      domainId: 'devops',
      action: 'build',
      path: devops.path,
    })
    assert.equal(doBuild.ok, true, String(doBuild.output))
    const doTest = await core.request('domain.action', {
      domainId: 'devops',
      action: 'test',
      path: devops.path,
    })
    assert.equal(doTest.ok, true, String(doTest.output))

    const security = await core.request('domain.action', {
      domainId: 'security',
      action: 'project.create',
      name: 'probe-security',
    })
    assert.equal(security.ok, true)
    const secBuild = await core.request('domain.action', {
      domainId: 'security',
      action: 'build',
      path: security.path,
    })
    assert.equal(secBuild.ok, true, String(secBuild.output))
    const secTest = await core.request('domain.action', {
      domainId: 'security',
      action: 'test',
      path: security.path,
    })
    assert.equal(secTest.ok, true, String(secTest.output))
    assert.ok(String(secTest.output).includes('18766/tcp'))

    const desktop = await core.request('domain.action', {
      domainId: 'desktop',
      action: 'project.create',
      name: 'probe-desktop',
    })
    assert.equal(desktop.ok, true)
    const dtBuild = await core.request('domain.action', {
      domainId: 'desktop',
      action: 'build',
      path: desktop.path,
    })
    assert.equal(dtBuild.ok, true, String(dtBuild.output))
    const dtTest = await core.request('domain.action', {
      domainId: 'desktop',
      action: 'test',
      path: desktop.path,
    })
    assert.equal(dtTest.ok, true, String(dtTest.output))
    assert.equal(Number(dtTest.failed), 0)
  })
})

test('domain IPC: honest status for missing tools (embedded/game/mobile)', async () => {
  await withCore(async (core) => {
    const embedded = await core.request('domain.action', {
      domainId: 'embedded',
      action: 'project.create',
      name: 'probe-embedded',
    })
    assert.equal(embedded.ok, true)
    const emBuild = await core.request('domain.action', {
      domainId: 'embedded',
      action: 'build',
      path: embedded.path,
    })
    assert.equal(typeof emBuild.ok, 'boolean')
    if (emBuild.ok !== true) {
      assert.ok(String(emBuild.reason ?? emBuild.output).includes('toolchain'))
    }

    const game = await core.request('domain.action', {
      domainId: 'game',
      action: 'project.create',
      name: 'probe-game',
    })
    assert.equal(game.ok, true)
    const gameBuild = await core.request('domain.action', {
      domainId: 'game',
      action: 'build',
      path: game.path,
    })
    assert.equal(gameBuild.ok, true, String(gameBuild.output))
    const gameTest = await core.request('domain.action', {
      domainId: 'game',
      action: 'test',
      path: game.path,
    })
    if (gameTest.ok !== true) {
      assert.ok(String(gameTest.reason ?? '').includes('godot'))
    }

    const mobile = await core.request('domain.action', {
      domainId: 'mobile',
      action: 'project.create',
      name: 'probe-mobile',
    })
    assert.equal(mobile.ok, true)
    const mobileTest = await core.request('domain.action', {
      domainId: 'mobile',
      action: 'test',
      path: mobile.path,
    })
    assert.equal(mobileTest.ok, false)
    assert.ok(String(mobileTest.reason ?? '').includes('requires-install'))
  })
})

test('domain IPC rejects outside paths and unknown actions', async () => {
  await withCore(async (core) => {
    const outside = await core
      .request('domain.action', { domainId: 'web', action: 'build', path: '/etc' })
      .then(
        () => 'resolved',
        (error: { code?: string }) => String(error.code),
      )
    assert.notEqual(outside, 'resolved')
    const unknown = await core.request('domain.action', { domainId: 'web', action: 'deploy' }).then(
      () => 'resolved',
      (error: { code?: string }) => String(error.code),
    )
    assert.notEqual(unknown, 'resolved')
    const simulated = await core.request('domain.action', { domainId: 'web', action: 'simulate' })
    assert.equal(simulated.ok, false)
    assert.equal(simulated.simulator, 'none')
  })
})
