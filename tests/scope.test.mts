// Runs with `node --test tests/`: which files a mutation run mutates, from what changed since the last one that passed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mutationScope, SHARED } from '../scripts/scope.mts'

const mutated = ['plugins/colab/cli/hub.mts', 'plugins/colab/cli/rooms.mts', 'plugins/colab/hooks/chat.ts']

test('with no earlier result, the run is full', () => {
  assert.deepEqual(mutationScope(undefined, mutated), { full: 'no earlier result' })
})

test('a change to what every mutant depends on makes the run full, and says which', () => {
  for (const file of SHARED) {
    assert.deepEqual(mutationScope(['plugins/colab/cli/hub.mts', file], mutated), { full: `${file} changed` })
  }
})

test('a changed module, or a changed test of one, is mutated; nothing else is', () => {
  assert.deepEqual(
    mutationScope(
      [
        'README.md',
        'plugins/colab/cli/rooms.mts',
        'plugins/colab/hooks/pane.tsx',
        'tests/hub.test.mts',
        'tests/mod/chat.test.mts',
        'tests/mod/pane.test.tsx',
        'tests/cli.test.mts',
        'tests/rooms.test.mts',
      ],
      mutated,
    ),
    { files: ['plugins/colab/cli/hub.mts', 'plugins/colab/cli/rooms.mts', 'plugins/colab/hooks/chat.ts'] },
  )
  assert.deepEqual(mutationScope(['README.md', 'plugins/colab/hooks/pane.tsx'], mutated), { files: [] })
})
