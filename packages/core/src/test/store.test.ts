import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Store } from '../store.ts'
import { jsonStr } from '../util.ts'

const withStore = (fn: (store: Store, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-store-test-'))
  try {
    const store = new Store(join(dir, 'nexus.db'))
    store.migrate()
    store.seedDefaults()
    fn(store, dir)
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('store: seeds + settings roundtrip/reset', () => {
  withStore((store) => {
    const settings = store.settingsAll()
    assert.equal(settings['language.locale'], 'vi')
    assert.equal(settings['app.initialized'], true)
    store.settingSet('test.value', 42)
    assert.equal(store.settingGet('test.value', null), 42)
    store.settingReset('test.value')
    assert.equal(store.settingGet('test.value', null), null)
  })
})

test('store: provider + models incl. variants', () => {
  withStore((store) => {
    const provider = store.providerSave(
      { kind: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      undefined,
      undefined,
    )
    assert.equal(jsonStr(provider, 'name'), 'OpenAI')
    const providerId = jsonStr(provider, 'id')

    const model = store.modelSave({ providerId, modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini' })
    assert.equal(model['isDefault'], true, 'first model is default')

    const variant = store.modelSave({
      providerId,
      modelId: 'gpt-4o-mini',
      variant: 'Deep',
      displayName: 'GPT-4o mini · Deep',
      reasoningEffort: 'high',
      supportsReasoning: true,
    })
    assert.equal(jsonStr(variant, 'variant'), 'Deep')
    assert.equal(jsonStr(variant, 'reasoningEffort'), 'high')

    const found = store.modelFindByWire(providerId, 'gpt-4o-mini', 'Deep')
    assert.equal(jsonStr(found, 'variant'), 'Deep')

    const missing = store.modelFindByWire(providerId, 'gpt-4o-mini', 'Missing')
    assert.equal(jsonStr(missing, 'variant'), '')

    const base = store.modelFindByWire(providerId, 'gpt-4o-mini')
    assert.equal(jsonStr(base, 'reasoningEffort'), 'medium')

    const minimal = store.modelSave({ providerId, modelId: 'gpt-5-mini', supportsReasoning: true, reasoningEffort: 'minimal' })
    assert.equal(jsonStr(minimal, 'reasoningEffort'), 'minimal')

    const bogus = store.modelSave({ providerId, modelId: 'gpt-5-nano', reasoningEffort: 'extreme' })
    assert.equal(jsonStr(bogus, 'reasoningEffort'), 'medium')

    const resaved = store.modelSave({ providerId, modelId: 'gpt-4o-mini' })
    assert.equal(jsonStr(resaved, 'variant'), '', 'resave matches the base row')
    const models = store.modelList(undefined)
    const deepVariants = models.filter((entry) => entry['variant'] === 'Deep').length
    assert.equal(deepVariants, 1, 'variant row preserved after base resave')
  })
})

test('store: sessions + messages + tools + file changes', () => {
  withStore((store, dir) => {
    const provider = store.providerSave(
      { kind: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      undefined,
      undefined,
    )
    const providerId = jsonStr(provider, 'id')
    const project = store.projectOpen(dir, basenameSafe(dir), undefined, undefined)
    const projectId = jsonStr(project, 'id')
    const session = store.sessionCreate({ projectId, title: 'Test session', providerId, modelId: 'gpt-4o-mini' })
    const sessionId = jsonStr(session, 'id')

    const duplicated = store.sessionDuplicate(sessionId)
    assert.equal(jsonStr(duplicated, 'title'), 'Test session (bản sao)')

    const variantSession = store.sessionCreate({
      projectId,
      title: 'Variant session',
      providerId,
      modelId: 'gpt-4o-mini',
      modelVariant: 'Deep',
    })
    assert.equal(jsonStr(variantSession, 'modelVariant'), 'Deep')
    const variantCopy = store.sessionDuplicate(jsonStr(variantSession, 'id'))
    assert.equal(jsonStr(variantCopy, 'modelVariant'), 'Deep')

    store.sessionCreate({ projectId, title: '1' })
    const numericQuery = store.sessionList({ query: '1' })
    const matched = numericQuery.some((row) => row['title'] === '1')
    assert.equal(matched, true, 'session list binds numeric-looking query as text')

    const percentProject = store.projectOpen(`${dir}-percent`, '50%', undefined, undefined)
    void percentProject
    const wildcard = store.projectSearch('%', 10)
    const wildcardLiteralOnly = wildcard.every((row) => String(row['name']).includes('%'))
    assert.equal(wildcardLiteralOnly, true, 'project search escapes LIKE wildcards')

    const memory = store.memoryCreate({ projectId, kind: 'fact', content: 'remember-me' })
    assert.equal(jsonStr(memory, 'content'), 'remember-me')

    const task = store.taskCreate({ sessionId, prompt: 'Fix the bug', mode: 'agent', permissionMode: 'workspace-write' })
    assert.equal(jsonStr(task, 'title'), 'Fix the bug')

    const message = store.messageCreate({ sessionId, role: 'user', content: 'hello' })
    assert.equal(jsonStr(message, 'content'), 'hello')

    const call = store.toolCallCreate({
      taskId: jsonStr(task, 'id'),
      sessionId,
      toolName: 'read_file',
      input: { path: 'a.txt' },
      status: 'running',
    })
    const updated = store.toolCallUpdate(jsonStr(call, 'id'), { status: 'success', output: { ok: true } })
    assert.equal(jsonStr(updated, 'status'), 'success')

    const change = store.fileChangeRecord({
      taskId: jsonStr(task, 'id'),
      sessionId,
      projectId,
      path: 'a.txt',
      changeType: 'create',
      afterContent: 'hello',
      addedLines: 1,
      removedLines: 0,
    })
    assert.equal(jsonStr(change, 'status'), 'proposed')
    const accepted = store.fileChangeStatus(jsonStr(change, 'id'), 'accepted')
    assert.equal(jsonStr(accepted, 'status'), 'accepted')

    store.usageInsert({ sessionId, modelId: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50 })
    const summary = store.usageSummary(30)
    assert.equal(summary['inputTokens'], 100)

    const stats = store.stats()
    assert.equal(typeof stats['sizeBytes'], 'number')
    assert.ok(stats['sizeBytes'] > 0)

    const backupPath = join(dir, 'backup.db')
    store.backup(backupPath)
    const backupStats = new Store(backupPath).stats()
    assert.ok(backupStats['sizeBytes'] > 0)

    const exported = store.sessionExport(sessionId)
    assert.ok(exported.startsWith('# '), 'export starts with heading')
  })
})

function basenameSafe(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}
