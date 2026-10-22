import assert from 'node:assert/strict'
import { test } from 'node:test'

import { modelName } from './modelSelectorParts.ts'

import type { SessionConfigOption } from '../../../api/session-config-types.ts'

const model: SessionConfigOption = {
  id: 'model',
  name: 'Model',
  kind: 'model',
  currentValue: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'sonnet', name: 'Sonnet' },
  ],
}

test('an acknowledged Default without a concrete model keeps the runtime label', () => {
  assert.equal(modelName(model), 'Default')
  assert.equal(
    modelName({ ...model, options: [{ value: 'default', name: 'Default (recommended)' }] }),
    'Default (recommended)',
  )
})

test('a Default that identifies its concrete model still shows that model', () => {
  assert.equal(
    modelName({
      ...model,
      options: [
        { value: 'default', name: 'Default', description: 'Uses Sonnet' },
        { value: 'sonnet', name: 'Sonnet' },
      ],
    }),
    'Sonnet',
  )
})

test('concrete and unlisted current models retain their acknowledged names', () => {
  assert.equal(modelName({ ...model, currentValue: 'sonnet' }), 'Sonnet')
  assert.equal(modelName({ ...model, currentValue: 'new-model' }), 'new-model')
})
