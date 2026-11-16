import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Providers } from '../providers.ts'

test('providers: registry defaults', () => {
  assert.equal(Providers.defaultBaseUrl('openrouter'), 'https://openrouter.ai/api/v1')
  assert.equal(Providers.defaultBaseUrl('lmstudio'), 'http://127.0.0.1:1234/v1')
  assert.equal(Providers.defaultBaseUrl('xai'), 'https://api.x.ai/v1')
  assert.ok(Providers.defaultBaseUrl('azure-openai').includes('openai.azure.com'))
})

test('providers: defaults_for_model grok-4 ≥ 128k', () => {
  const [context] = Providers.defaultsForModel('grok-4')
  assert.ok(context >= 128000)
})

test('providers: reasoning inference by id', () => {
  assert.equal(Providers.inferSupportsReasoning('gpt-5'), true)
  assert.equal(Providers.inferSupportsReasoning('deepseek-r1'), true)
  assert.equal(Providers.inferSupportsReasoning('glm-4.6-air'), true)
  assert.equal(Providers.inferSupportsReasoning('Claude-4-Sonnet'), true)
  assert.equal(Providers.inferSupportsReasoning('gpt-4o-mini'), false)
  assert.equal(Providers.inferSupportsReasoning('llama-3.1-8b'), false)
})
