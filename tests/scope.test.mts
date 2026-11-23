// Runs with `node --test tests/`: which files a mutation run mutates, from what changed since the last one that passed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importsOf, matching, mutationScope, toolsOf, type Setup } from '../scripts/scope.mts'

const [protocol, wire, rooms, hub, chat] = [
  'plugins/colab/cli/protocol.mts',
  'plugins/colab/cli/wire.mts',
  'plugins/colab/cli/rooms.mts',
  'plugins/colab/cli/hub.mts',
  'plugins/colab/hooks/chat.ts',
]
const imports = {
  [protocol]: [],
  [wire]: [protocol],
  [rooms]: [protocol],
  [hub]: [wire, rooms],
  [chat]: [protocol],
  'tests/hub.test.mts': [hub, 'tests/helper.mts'],
  'tests/rooms.test.mts': [rooms],
  'tests/mod/chat.test.mts': [chat],
  'tests/helper.mts': [],
  'tests/offline.mts': [],
}
const config = {
  mutate: ['plugins/colab/cli/**/*.mts', 'plugins/colab/hooks/chat.ts'],
  commandRunner: {
    command:
      'NODE_OPTIONS=--import=./tests/offline.mts node --test tests/hub.test.mts tests/rooms.test.mts tests/mod/chat.test.mts',
  },
  concurrency: 3,
  timeoutMS: 5000,
  reporters: ['progress'],
  thresholds: { break: 100 },
}
const now: Setup = { config, mutated: [protocol, wire, rooms, hub, chat], tools: ['@stryker-mutator/core@10.1.1'] }
/** The scope when `changed` changed since the last passing run, whose setup was `now` but for `before`. */
const scope = (changed: string[], before: Partial<Setup> = {}) =>
  mutationScope(now, imports, { changed, setup: { ...now, ...before } })

test('with no earlier result, the run is full', () => {
  assert.deepEqual(mutationScope(now, imports, undefined), { full: 'no earlier result' })
})

test('a change no mutant runs, nor its tests, re-runs nothing', () => {
  assert.deepEqual(
    scope([
      'README.md',
      'package.json',
      'pnpm-workspace.yaml',
      '.node-version',
      'biome.jsonc',
      'plugins/colab/.claude-plugin/plugin.json',
      'plugins/colab/hooks/pane.tsx',
      'scripts/release.mts',
      'tests/cli.test.mts',
    ]),
    { files: [] },
  )
})

test('a changed module re-runs the mutants of every module whose code or tests run it', () => {
  assert.deepEqual(scope([rooms]), { files: [protocol, wire, rooms, hub] }, 'what hub’s tests run, rooms included')
  assert.deepEqual(scope([protocol]), { files: [protocol, wire, rooms, hub, chat] })
  assert.deepEqual(scope([chat]), { files: [protocol, chat] }, 'chat’s tests run protocol too')
})

test('with no test named in its command, a mutant runs its module alone, and what that imports', () => {
  const bare = { ...now, config: { ...config, commandRunner: { command: 'node --test' } } }
  const withGone = { ...imports, [hub]: [wire, rooms, 'plugins/colab/cli/gone.mts'] }
  assert.deepEqual(mutationScope(bare, withGone, { changed: [rooms, 'tests/hub.test.mts'], setup: bare }), {
    files: [rooms, hub],
  })
})

test('a changed test re-runs the mutants of every module it runs', () => {
  assert.deepEqual(scope(['tests/rooms.test.mts']), { files: [protocol, rooms] })
  assert.deepEqual(scope(['tests/hub.test.mts']), { files: [protocol, wire, rooms, hub] })
})

test('a shared test helper re-runs the mutants its tests run; one loaded before every test, all of them', () => {
  assert.deepEqual(scope(['tests/helper.mts']), { files: [protocol, wire, rooms, hub] })
  assert.deepEqual(scope(['tests/offline.mts']), { files: [protocol, wire, rooms, hub, chat] })
})

test('a module mutated now but not last time is mutated, whatever changed', () => {
  assert.deepEqual(scope(['stryker.config.mjs'], { mutated: [protocol, rooms, hub, chat] }), { files: [wire] })
})

test('config that changes neither the mutants nor how their tests run re-runs nothing; any other, all', () => {
  const unseen = { config: { ...config, concurrency: 1, reporters: [], thresholds: {}, mutate: [] } }
  assert.deepEqual(scope(['stryker.config.mjs'], unseen), { files: [] })
  for (const before of [
    { ...config, timeoutMS: 9000 },
    { ...config, commandRunner: { command: 'node --test tests/hub.test.mts' } },
  ]) {
    assert.deepEqual(scope(['stryker.config.mjs'], { config: before }), {
      full: 'stryker.config.mjs changes how the tests run',
    })
  }
})

test('a new version of Stryker or of the parser it mutates with re-runs all; of any other package, nothing', () => {
  assert.deepEqual(scope(['pnpm-lock.yaml'], { tools: ['@stryker-mutator/core@10.1.0'] }), {
    full: 'Stryker or its parser changed',
  })
  assert.deepEqual(scope(['pnpm-lock.yaml']), { files: [] })
})

test('the tools of a lockfile are its Stryker and Babel packages, each once, by version', () => {
  const lock = [
    'packages:',
    "  '@babel/parser@7.28.5':",
    "  '@stryker-mutator/core@10.1.1':",
    '  prettier@3.10.1:',
    'snapshots:',
    "  '@stryker-mutator/core@10.1.1(@types/node@26.6.6)':",
    "      '@stryker-mutator/api': 10.1.1",
  ].join('\n')
  assert.deepEqual(toolsOf(lock), ['@babel/parser@7.28.5', '@stryker-mutator/core@10.1.1'])
})

test('a file imports the files its relative specifiers name, static, dynamic or by URL; no package', () => {
  const text = [
    "import assert from 'node:assert/strict'",
    "import { a } from './a.mts'",
    "import type { B } from '../plugins/colab/cli/b.mts'",
    'import {',
    '  c,',
    "} from '../c.ts'",
    "import './side.mts'",
    "const d = await import('./d.mts')",
    "const e = fileURLToPath(new URL('../plugins/colab/cli/e.mts', import.meta.url))",
    "import x from 'prettier'",
  ].join('\n')
  assert.deepEqual(importsOf('tests/x.test.mts', text), [
    'tests/a.mts',
    'plugins/colab/cli/b.mts',
    'c.ts',
    'tests/side.mts',
    'tests/d.mts',
    'plugins/colab/cli/e.mts',
  ])
})

test('the files mutated are those a pattern takes and no negated one gives back', () => {
  assert.deepEqual(
    matching(['cli/**/*.mts', '!cli/main.mts', 'hooks/chat.ts'], ['cli/a.mts', 'cli/main.mts', 'hooks/chat.ts', 'x']),
    ['cli/a.mts', 'hooks/chat.ts'],
  )
})
