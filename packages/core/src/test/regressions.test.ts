import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { nextRunAt } from '../cron.ts'
import { boostDomainTools } from '../domain/capabilities.ts'
import { classifyPromptIntent } from '../domain/intent.ts'
import { countTests } from '../domain/runner.ts'
import { deriveRollbackCommand } from '../domain/rollback.ts'
import { NexusError } from '../errors.ts'
import { httpRequest } from '../http.ts'
import { Providers } from '../providers.ts'
import { SecretStore } from '../secrets.ts'
import { redactSecrets } from '../security.ts'
import { Store } from '../store.ts'
import { globMatch, runProcess, splitCommand } from '../util.ts'
import { Workspace } from '../workspace.ts'

const withTmp = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-regression-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('regression: countTests bỏ qua dòng Test Suites của Jest', () => {
  assert.deepEqual(countTests('Test Suites: 1 failed, 1 total\nTests: 3 passed, 3 total'), {
    passed: 3,
    failed: 0,
  })
  assert.deepEqual(countTests('1 passed, 1 failed in 0.4s'), { passed: 1, failed: 1 })
})

test('regression: rollback chỉ lấy tên package, không lấy flag hay lệnh ghép', () => {
  assert.equal(deriveRollbackCommand('pip install --user foo'), 'python3 -m pip uninstall -y foo')
  assert.equal(deriveRollbackCommand('pip install -e .'), null)
  assert.equal(deriveRollbackCommand('npm install -g foo && npm install -g bar'), null)
  assert.equal(
    deriveRollbackCommand('python3 -m pip install --user pytest'),
    'python3 -m pip uninstall -y pytest',
  )
})

test('regression: intent đếm keyword theo boundary và không rò prototype qua marker', () => {
  const slash = classifyPromptIntent({ prompt: 'react/vue' })
  assert.ok(slash.some((match) => match.domainId === 'web'))
  const repeated = classifyPromptIntent({ prompt: 'cmake cmake' })
  const systems = repeated.find((match) => match.domainId === 'systems')
  assert.ok(systems !== undefined && systems.confidence >= 0.9)
  assert.deepEqual(
    classifyPromptIntent({ prompt: 'task', markers: ['constructor', '__proto__'] }),
    [],
  )
})

test('regression: boostDomainTools không crash với domain id trùng Object.prototype', () => {
  const tools = [{ name: 'read_file' }]
  assert.deepEqual(boostDomainTools(tools, 'constructor'), tools)
})

test('regression: nextRunAt bắt lịch 29/2 và dùng OR cho DOM+DOW', () => {
  assert.equal(
    nextRunAt('0 0 29 2 *', new Date(2027, 0, 1).getTime()),
    new Date(2028, 1, 29).getTime(),
  )
  assert.equal(
    nextRunAt('0 0 5 * 1', new Date(2026, 0, 6).getTime()),
    new Date(2026, 0, 12).getTime(),
  )
})

test('regression: globMatch **/ khớp 0 thư mục, ? không khớp /', () => {
  assert.equal(globMatch('**/foo', 'foo'), true)
  assert.equal(globMatch('**/*.ts', 'file.ts'), true)
  assert.equal(globMatch('a?c', 'a/c'), false)
  assert.equal(globMatch('*.ts', 'src/file.ts'), false)
})

test('regression: redact cả token base64 và message của NexusError', () => {
  assert.equal(redactSecrets('api_key=YWJjZGVmZ2hpamts+/lmnopq'), 'api_key=***redacted***')
  const error = new NexusError('E_PROVIDER', 'Provider error: invalid API key sk-abcdefghijklmnop')
  assert.ok(!error.message.includes('abcdefghijklmnop'))
})

test('regression: reasoning detection nhận qwen3 dạng : và -', () => {
  assert.equal(Providers.inferSupportsReasoning('qwen3:32b'), true)
  assert.equal(Providers.inferSupportsReasoning('Qwen/Qwen3-32B'), true)
})

test('regression: SecretStore chmod lại khoá có sẵn về 0600', () => {
  withTmp((dir) => {
    const keyPath = join(dir, 'secrets.key')
    writeFileSync(keyPath, Buffer.alloc(32, 7), { mode: 0o644 })
    new SecretStore(dir)
    assert.equal(statSync(keyPath).mode & 0o777, 0o600)
  })
})

test('regression: runProcess decode UTF-8 đúng khi byte bị chia ở 2 chunk', async () => {
  const script =
    'process.stdout.write(Buffer.from([0xe1]));' +
    'setTimeout(()=>process.stdout.write(Buffer.from([0xba,0xba,0x0a])),10)'
  const expected = Buffer.from([0xe1, 0xba, 0xba, 0x0a]).toString('utf8')
  const result = await runProcess([process.execPath, '-e', script], process.cwd(), 5000)
  assert.equal(result.out, expected)
  assert.ok(!result.out.includes('\uFFFD'))
})

test('regression: taskStepsReplace rollback transaction khi insert lỗi', () => {
  withTmp((dir) => {
    const store = new Store(join(dir, 'a.db'))
    store.migrate()
    const project = store.projectOpen(join(dir, 'proj'), 'proj')
    const session = store.sessionCreate({ projectId: String(project['id']), title: 't' })
    const task = store.taskCreate({ sessionId: String(session['id']), prompt: 'p' })
    assert.throws(() => store.taskStepsReplace('no-such-task', [{ title: 'step' }]))
    // Nếu transaction còn mở, lời gọi BEGIN tiếp theo sẽ thất bại.
    assert.doesNotThrow(() => store.taskRemove(String(task['id'])))
    store.close()
  })
})

test('regression round 3: mask chỉ lộ prefix, không lộ đầu/cuối khoá', () => {
  assert.equal(SecretStore.mask(''), '')
  assert.equal(SecretStore.mask('plainkey123456'), '****')
  const masked = SecretStore.mask('sk-abcdefghijklmnopqrstuvwxyz')
  assert.equal(masked, 'sk-****')
  assert.ok(!masked.includes('abcd') && !masked.includes('wxyz'))
})

test('regression round 3: splitCommand xử lý escape nhưng giữ quote', () => {
  assert.deepEqual(splitCommand('echo a\\ b'), ['echo', 'a b'])
  assert.deepEqual(splitCommand('git commit -m "a b"'), ['git', 'commit', '-m', 'a b'])
  assert.deepEqual(splitCommand("echo 'x y'"), ['echo', 'x y'])
  assert.deepEqual(splitCommand("echo 'a\\b'"), ['echo', 'a\\b'])
})

test('regression round 2: defaultsForModel o1 có ngữ cảnh 200k', () => {
  assert.deepEqual(Providers.defaultsForModel('o1'), [200000, 100000])
  assert.deepEqual(Providers.defaultsForModel('o1-preview'), [200000, 100000])
})

test('regression round 2: .gitignore negation đưa file vào lại danh sách', () => {
  withTmp((dir) => {
    writeFileSync(join(dir, '.gitignore'), '*.log\n!important.log\n')
    const workspace = new Workspace(dir)
    assert.equal(workspace.isIgnored('debug.log'), true)
    assert.equal(workspace.isIgnored('important.log'), false)
  })
})

test('regression round 2: httpRequest ghép byte UTF-8 bị chia ở 2 chunk', async () => {
  const payload = '{"msg":"café 😀 ok"}'
  const bytes = Buffer.from(payload, 'utf8')
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write(bytes.subarray(0, 8))
    setTimeout(() => res.end(bytes.subarray(8)), 20)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address !== null && typeof address === 'object')
    const response = await httpRequest({
      url: `http://127.0.0.1:${address.port}/`,
      timeoutSeconds: 5,
    })
    assert.equal(response.error, '')
    assert.equal(response.body, payload)
  } finally {
    server.close()
  }
})
