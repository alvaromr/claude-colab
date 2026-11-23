// The tests Node runs (`pnpm test:node`, and Stryker's runs): those of cli/, of the scripts and of the mod's pure
// modules; the mod's other tests run in the engine (`pnpm test:mod`).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const OFFLINE = fileURLToPath(new URL('./tests/offline.mts', import.meta.url))

/** Under Stryker, a folder for temporary files in its sandbox, which it deletes: a test cut short by a mutant's
 * timeout never cleans up after itself. Elsewhere, none. */
function sandboxTemp() {
  if (process.env.STRYKER_MUTATOR_WORKER === undefined) return {}
  const TMPDIR = join(process.cwd(), '.t')
  mkdirSync(TMPDIR, { recursive: true })
  return { TMPDIR }
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mts'],
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
