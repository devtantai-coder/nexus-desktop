import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { DependencyManager } from '../domain/dependency.ts'
import { EnvironmentManager } from '../domain/environment.ts'
import { deriveRollbackCommand } from '../domain/rollback.ts'
import type { DomainContext, Platform } from '../domain/types.ts'
import { BaseDomainAdapter, defineTool } from '../domains/base.ts'
import { Store } from '../store.ts'

class RollbackDomain extends BaseDomainAdapter {
  readonly id = 'rollback-probe'
  readonly label = 'Rollback probe'
  readonly description = 'auto-rollback verification'
  readonly platforms: Platform[] = ['linux']
  readonly tools = [
    defineTool('rb-ok', 'RB OK', 'rollback-probe', 'nexus-no-such-tool-rb-ok', ['probe'], {
      installCommand: 'true',
      rollbackCommand: 'sh -c "exit 0"',
      supportedPlatforms: ['linux'],
    }),
    defineTool('rb-fail', 'RB Fail', 'rollback-probe', 'nexus-no-such-tool-rb-fail', ['probe'], {
      installCommand: 'true',
      rollbackCommand: 'sh -c "exit 1"',
      supportedPlatforms: ['linux'],
    }),
    defineTool('rb-none', 'RB None', 'rollback-probe', 'nexus-no-such-tool-rb-none', ['probe'], {
      installCommand: 'true',
      supportedPlatforms: ['linux'],
    }),
  ]
}

const withStore = async (
  fn: (store: Store, manager: DependencyManager, context: DomainContext) => Promise<void>,
): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-rollback-test-'))
  const store = new Store(join(dir, 'nexus.db'))
  store.migrate()
  try {
    const environment = new EnvironmentManager()
    const manager = new DependencyManager(store, environment)
    const context: DomainContext = {
      workspaceRoot: null,
      environment: await environment.snapshot(['node', 'nexus-no-such-tool-rb-ok']),
      settings: {},
    }
    await fn(store, manager, context)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('rollback: deriveRollbackCommand parses known package managers only', () => {
  assert.equal(deriveRollbackCommand('apt-get install -y cmake'), 'apt-get remove -y cmake')
  assert.equal(deriveRollbackCommand('apt install -y g++'), 'apt-get remove -y g++')
  assert.equal(
    deriveRollbackCommand('python3 -m pip install --user pytest'),
    'python3 -m pip uninstall -y pytest',
  )
  assert.equal(deriveRollbackCommand('pip install semgrep'), 'python3 -m pip uninstall -y semgrep')
  assert.equal(deriveRollbackCommand('uv pip install torch'), 'uv pip uninstall torch')
  assert.equal(
    deriveRollbackCommand('npm install -g gltf-validator'),
    'npm uninstall -g gltf-validator',
  )
  assert.equal(deriveRollbackCommand('cargo install cargo-watch'), 'cargo uninstall cargo-watch')
  assert.equal(deriveRollbackCommand('dnf install -y cmake'), 'dnf remove -y cmake')
  assert.equal(deriveRollbackCommand('yum install -y cmake'), 'dnf remove -y cmake')
  assert.equal(deriveRollbackCommand('pacman -S docker'), 'pacman -R docker')
  assert.equal(deriveRollbackCommand('brew install cmake'), 'brew uninstall cmake')
  assert.equal(deriveRollbackCommand('zypper install -y cmake'), 'zypper remove -y cmake')
  assert.equal(deriveRollbackCommand('flatpak install -y flathub org.x.y'), null)
  assert.equal(deriveRollbackCommand('corepack enable'), null)
  assert.equal(deriveRollbackCommand(null), null)
  assert.equal(deriveRollbackCommand('curl x | sh'), null)
})

test('rollback: single package derived from full apt command', () => {
  assert.equal(
    deriveRollbackCommand('apt-get install -y gcc-arm-none-eabi'),
    'apt-get remove -y gcc-arm-none-eabi',
  )
})

test('rollback: verified install failure triggers automatic rollback and audit log', async () => {
  await withStore(async (store, manager, context) => {
    const domain = new RollbackDomain()
    const ok = await manager.install(domain, ['rb-ok'], true, context)
    assert.equal(ok[0]?.ok, false, 'tool never becomes available, install honestly reports failure')
    assert.equal(ok[0]?.verified, false)
    assert.equal(ok[0]?.reason, 'verify-failed-rolled-back')
    assert.equal(ok[0]?.rollbackCommand, 'sh -c "exit 0"')
    const rollbackEvents = store
      .dependencyEvents(20)
      .filter((event) => event['action'] === 'rollback')
    assert.equal(rollbackEvents.length, 1)
    assert.equal(rollbackEvents[0]?.['ok'], true)

    const fail = await manager.install(domain, ['rb-fail'], true, context)
    assert.equal(fail[0]?.reason, 'verify-failed-rollback-failed')

    const none = await manager.install(domain, ['rb-none'], true, context)
    assert.equal(none[0]?.reason, 'verify-failed-rollback-unavailable')
    assert.equal(none[0]?.rollbackCommand, null)
  })
})
