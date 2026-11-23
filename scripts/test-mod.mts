// `pnpm test:mod`: the mod's tests in the engine (`claude plugin test`). The engine runs only tests inside the plugin's
// folder, and follows no link out of it, while the tests stay out of what an install copies: so they run on a copy of
// the plugin with `tests/mod` beside its hooks.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const copy = mkdtempSync(join(tmpdir(), 'colab-mod-test-'))
try {
  cpSync(join(ROOT, 'plugins/colab'), copy, {
    recursive: true,
    // Written by the engine for the editor: the run lays its own.
    filter: source => !source.startsWith(join(ROOT, 'plugins/colab/.claude-plugin/types')),
  })
  cpSync(join(ROOT, 'tests/mod'), join(copy, 'tests/mod'), { recursive: true })
  execFileSync('claude', ['plugin', 'test', copy], { stdio: 'inherit' })
} catch {
  // The engine has printed what failed.
  process.exitCode = 1
} finally {
  rmSync(copy, { recursive: true, force: true })
}
