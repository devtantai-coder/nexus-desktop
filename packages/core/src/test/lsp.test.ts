import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { EventBus } from '../events.ts'
import { LspService } from '../lsp.ts'

const fixture = fileURLToPath(new URL('./fixtures/mock_lsp.mjs', import.meta.url))

describe('LspService', () => {
  let dir = ''
  let file = ''

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-lsp-test-'))
    file = join(dir, 'a.ts')
    writeFileSync(file, 'export const value = 1\n')
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns hover and diagnostics from a language server', async () => {
    const events = new EventBus()
    const lsp = new LspService(events, [
      {
        languageId: 'typescript',
        command: process.execPath,
        args: [fixture],
        extensions: ['.ts'],
      },
    ])
    try {
      const hover = await lsp.hover(dir, file, { line: 1, character: 1 })
      assert.equal(hover?.['contents']?.['value'], '**mock hover**')
      const diagnostics = await lsp.diagnostics(dir, file)
      assert.equal(diagnostics.length, 1)
      assert.equal(diagnostics[0]?.['message'], 'mock diagnostic')
    } finally {
      lsp.dispose()
    }
  })
})