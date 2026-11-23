import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  boostDomainTools,
  DOMAIN_CAPABILITY_AFFINITY,
  TOOL_CAPABILITIES,
} from '../domain/capabilities.ts'

const names = (entries: Array<{ name: string }>): string[] => entries.map((entry) => entry.name)

test('capabilities: every curated tool has at least one capability', () => {
  for (const [name, caps] of Object.entries(TOOL_CAPABILITIES)) {
    assert.ok(caps.length > 0, `${name} has empty capabilities`)
  }
})

test('capabilities: affinity covers the 10 standard domains', () => {
  assert.deepEqual(Object.keys(DOMAIN_CAPABILITY_AFFINITY).sort(), [
    'aiml',
    'database',
    'desktop',
    'devops',
    'embedded',
    'game',
    'mobile',
    'security',
    'systems',
    'web',
  ])
  for (const [domain, caps] of Object.entries(DOMAIN_CAPABILITY_AFFINITY)) {
    assert.ok(caps.length > 0, `${domain} affinity is empty`)
  }
})

test('boostDomainTools: keeps order, lifts domain-relevant tools, never prunes', () => {
  const tools = [
    { name: 'read_file' }, // file-io analysis
    { name: 'execute_command' }, // shell terminal
    { name: 'run_tests' }, // test shell
    { name: 'web_search' }, // web
    { name: 'git_status' }, // git
    { name: 'save_memory' }, // memory
  ]
  const noDomain = boostDomainTools(tools, null)
  assert.deepEqual(names(noDomain), [
    'read_file',
    'execute_command',
    'run_tests',
    'web_search',
    'git_status',
    'save_memory',
  ])

  const aiml = boostDomainTools(tools, 'aiml')
  assert.equal(aiml.length, tools.length, 'no tool is pruned')
  assert.deepEqual(names(aiml), [
    'read_file',
    'execute_command',
    'run_tests',
    'web_search',
    'git_status',
    'save_memory',
  ])

  const database = boostDomainTools(tools, 'database')
  assert.deepEqual(names(database), [
    'read_file',
    'execute_command',
    'run_tests',
    'git_status',
    'web_search',
    'save_memory',
  ])

  const unknown = boostDomainTools(tools, 'nope')
  assert.deepEqual(names(unknown), names(noDomain))

  const stable = boostDomainTools([{ name: 'web_search' }, { name: 'read_file' }], 'web')
  assert.deepEqual(names(stable), ['web_search', 'read_file'])
})
