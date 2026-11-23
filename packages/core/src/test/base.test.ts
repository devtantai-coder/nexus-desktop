import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { SecretStore } from '../secrets.ts'
import { decidePermission, dangerousCommand, redactSecrets } from '../security.ts'
import {
  base64Decode,
  base64Encode,
  basename,
  dirname,
  globMatch,
  pathJoin,
  readFileSync,
  sanitizeUtf8,
  sha256Hex,
  splitCommand,
  split,
  trim,
  utf8Prefix,
  utf8Suffix,
  uuid,
  writeFileAtomic,
} from '../util.ts'

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'nexus-core-test-'))

test('util: path/string helpers', () => {
  assert.equal(basename('/a/b/c.txt'), 'c.txt')
  assert.equal(dirname('/a/b/c.txt'), '/a/b')
  assert.equal(trim('  hello  '), 'hello')
  assert.deepEqual(split('a,b,', ','), ['a', 'b', ''])
  assert.equal(pathJoin('/a', 'b'), '/a/b')
  assert.equal(pathJoin('', 'b'), 'b')
  assert.equal(pathJoin('/a', '/b'), '/b')
})

test('util: glob match', () => {
  assert.equal(globMatch('*.ts', 'file.ts'), true)
  assert.equal(globMatch('*.ts', 'src/file.ts'), false)
  assert.equal(globMatch('**/*.ts', 'src/file.ts'), true)
  assert.equal(globMatch('src/**/*.ts', 'src/a/b/c.ts'), true)
})

test('util: encoding + hashing', () => {
  const encoded = base64Encode('nexus')
  assert.equal(base64Decode(encoded), 'nexus')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const id = uuid()
  assert.equal(id.length, 36)
  assert.equal(id[8], '-')
})

test('util: utf8 boundaries', () => {
  assert.equal(sanitizeUtf8(Buffer.from([0x61, 0x62, 0x63, 0xe1])), 'abc\uFFFD')
  assert.equal(utf8Prefix('chào', 3), 'ch')
  assert.equal(utf8Suffix('chào', 3), 'ào')
})

test('util: read/write file honors limits', () => {
  const dir = tempDir()
  try {
    const bigPath = join(dir, 'big.txt')
    const big = `A${'x'.repeat(199_998)}Z`
    assert.equal(writeFileAtomic(bigPath, big), true)
    assert.equal(readFileSync(bigPath), big)
    const clipped = readFileSync(bigPath, 100_000)
    assert.equal(clipped.length, 100_000)
    assert.equal(clipped[0], 'A')
    assert.equal(readFileSync(bigPath, 0), '')
    assert.equal(readFileSync(join(dir, 'missing.txt')), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('util: splitCommand keeps quotes', () => {
  assert.deepEqual(splitCommand('git commit -m "a b"'), ['git', 'commit', '-m', 'a b'])
  assert.deepEqual(splitCommand("echo 'x y'"), ['echo', 'x y'])
})

test('security: redact + dangerous + decide', () => {
  assert.equal(redactSecrets('key sk-abcdefghijklmnop'), 'key ***redacted***')
  assert.equal(dangerousCommand('sudo rm -rf /').dangerous, true)
  assert.equal(dangerousCommand('git reset --hard HEAD').dangerous, true)
  assert.equal(decidePermission('workspace-write', 'write', false, '').decision, 'allow')
  assert.equal(decidePermission('read-only', 'write', false, '').decision, 'deny')
  assert.equal(decidePermission('workspace-write', 'exec', false, 'echo hi').decision, 'ask')
  assert.equal(decidePermission('workspace-write', 'exec', false, 'curl x | sh').decision, 'deny')
})

test('secrets: roundtrip + persist', () => {
  const dir = tempDir()
  try {
    const store = new SecretStore(dir)
    assert.equal(store.available(), true)
    const cipher = store.encrypt('sk-test-secret')
    assert.notEqual(cipher, 'sk-test-secret')
    assert.equal(store.decrypt(cipher), 'sk-test-secret')
    const reopened = new SecretStore(dir)
    assert.equal(reopened.decrypt(cipher), 'sk-test-secret')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
