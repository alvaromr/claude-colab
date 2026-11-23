// The tests Node runs (`pnpm test:node`, and Stryker's runs): those of cli/, of the scripts and of the mod's pure
// modules; the mod's other tests run in the engine (`pnpm test:mod`).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const OFFLINE = fileURLToPath(new URL('./tests/offline.mts', import.meta.url))
const STRYKER = process.env.STRYKER_MUTATOR_WORKER !== undefined

/**
 * The fast suite, the one mutation runs: tests/cli.test.mts drives the real CLI end to end, a process per command, so
 * running it per mutant would cost far more than it proves; those of the scripts run no mutated code. Chosen here,
 * not by Stryker's `testFiles`, under which Stryker activates a mutant of a module's top level only once the module
 * has loaded, so that no test can kill it.
 */
export const MUTATION_TESTS = [
  'tests/args.test.mts',
  'tests/commands.test.mts',
  'tests/rooms.test.mts',
  'tests/hub.test.mts',
  'tests/link.test.mts',
  'tests/home.test.mts',
  'tests/wire.test.mts',
  'tests/protocol.test.mts',
  'tests/strings.test.mts',
  'tests/mod/addresses.test.mts',
  'tests/mod/chat.test.mts',
  'tests/mod/linking.test.mts',
]

/** Under Stryker, a folder for temporary files in its sandbox, which it deletes: a test cut short by a mutant's
 * timeout never cleans up after itself. Elsewhere, none. */
function sandboxTemp() {
  if (!STRYKER) return {}
  const TMPDIR = join(process.cwd(), '.t')
  mkdirSync(TMPDIR, { recursive: true })
  return { TMPDIR }
}

export default defineConfig({
  test: {
    include: STRYKER ? MUTATION_TESTS : ['tests/**/*.test.mts'],
    // Imported as Node does, not through Vite, so that the coverage of the processes the tests start, which run the
    // same files, adds up with theirs: both read the same source.
    experimental: { viteModuleRunner: false },
    // No network but loopback, in the tests and in every process they start.
    setupFiles: [OFFLINE],
    // In Spanish: the texts' tests check both languages, and those of the CLI read its Spanish.
    env: { LC_ALL: 'es_ES.UTF-8', NODE_OPTIONS: `--import="${OFFLINE}"`, ...sandboxTemp() },
    coverage: {
      provider: 'v8',
      // The processes the tests start count too: connect and the CLI run as their own.
      autoAttachSubprocess: true,
      exclude: ['tests/**'],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    },
  },
})
