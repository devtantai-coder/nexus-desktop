import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  joinModelVariant,
  normalizeVariant,
  splitModelVariant,
} from '../../../shared/src/model_variant.ts'

test('model variant: split suffix', () => {
  assert.deepEqual(splitModelVariant('openai/gpt-4o'), {
    modelId: 'openai/gpt-4o',
    baseModelId: 'openai/gpt-4o',
    variant: '',
  })
  assert.deepEqual(splitModelVariant('openai/gpt-4o:nitro'), {
    modelId: 'openai/gpt-4o:nitro',
    baseModelId: 'openai/gpt-4o',
    variant: 'nitro',
  })
  assert.deepEqual(splitModelVariant('llama3:8b'), {
    modelId: 'llama3:8b',
    baseModelId: 'llama3',
    variant: '8b',
  })
})

test('model variant: reject malformed suffix', () => {
  assert.equal(splitModelVariant('gpt-4o:').variant, '')
  assert.equal(splitModelVariant(':nitro').variant, '')
  assert.equal(splitModelVariant('gpt-4o:nitro free').variant, '')
})

test('model variant: join and normalize', () => {
  assert.equal(joinModelVariant('openai/gpt-4o', 'nitro'), 'openai/gpt-4o:nitro')
  assert.equal(joinModelVariant('openai/gpt-4o', '  '), 'openai/gpt-4o')
  assert.equal(normalizeVariant('  nitro   fast  '), 'nitro fast')
})
