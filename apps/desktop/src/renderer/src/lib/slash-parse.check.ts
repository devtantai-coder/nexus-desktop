// Self-check for the pure slash-command helpers.
// Run: node --experimental-strip-types apps/desktop/src/renderer/src/lib/slash-parse.check.ts
import assert from 'node:assert/strict'
import { BUILTIN_COMMANDS, expandTemplate, listCommands, parseSlash } from './slash-parse.ts'

assert.deepEqual(parseSlash('/new'), { name: 'new', input: '' })
assert.deepEqual(parseSlash('/model  gpt-5 '), { name: 'model', input: 'gpt-5' })
assert.deepEqual(parseSlash('/New'), { name: 'new', input: '' })
assert.equal(parseSlash('hello'), null)
assert.equal(parseSlash(''), null)
assert.equal(parseSlash('/')?.name, '')

assert.equal(listCommands([], '').length, BUILTIN_COMMANDS.length)
assert.deepEqual(
  listCommands([], 'und').map((command) => command.name),
  ['undo'],
)
assert.equal(
  listCommands([], 'tóm tắt').some((command) => command.name === 'compact'),
  true,
)

const custom = [
  {
    name: 'deploy',
    description: 'Ship to staging',
    template: 'Ship $ARGUMENTS',
    source: 'project' as const,
    path: '.nexus/commands/deploy.md',
  },
]
assert.equal(listCommands(custom, 'dep')[0]?.category, 'Lệnh riêng')
assert.equal(listCommands(custom, 'staging')[0]?.name, 'deploy')

assert.equal(expandTemplate('Fix $ARGUMENTS now', 'auth'), 'Fix auth now')
assert.equal(expandTemplate('Review this', 'extra'), 'Review this\n\nextra')
assert.equal(expandTemplate('Review this', ''), 'Review this')

console.log('slash-parse checks ok')
