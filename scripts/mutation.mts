// `pnpm mutation [--full]`: mutation testing (Stryker) of what changed since the last run that passed, as `scope.mts`
// decides, or of everything with `--full`. The commit a passing run covers is kept in the repository's git folder
// (`git rev-parse --git-path colab-mutation`), never versioned; a run on a tree with changes keeps none, since no
// commit holds what it tested.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { MUTATION_TESTS } from '../vitest.config.mts'
import { type Config, importsOf, matching, mutationScope, type Setup, toolsOf } from './scope.mts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const say = (line: string) => process.stdout.write(`mutation: ${line}\n`)
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
const lines = (text: string) => text.split('\n').filter(line => line !== '')

const { values } = parseArgs({ options: { full: { type: 'boolean' } } })
const record = join(ROOT, git('rev-parse', '--git-path', 'colab-mutation').trim())
const files = lines(git('ls-files', '--cached', '--others', '--exclude-standard')).filter(file =>
  existsSync(join(ROOT, file)),
)
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
/** The setup a config's text and a lockfile's text make, mutating the files of the tree as it is. */
async function setupOf(configText: string, lock: string): Promise<Setup> {
  // The config is plain JavaScript with no imports, so its text loads as a module of its own.
  const config = ((await import(`data:text/javascript,${encodeURIComponent(configText)}`)) as { default: Config })
    .default
  return { config, mutated: matching(config.mutate, files), tools: toolsOf(lock) }
}
const now = await setupOf(read('stryker.config.mjs'), read('pnpm-lock.yaml'))
const imports = Object.fromEntries(
  files.filter(file => /\.(mts|ts|tsx)$/.test(file)).map(file => [file, importsOf(file, read(file))]),
)

/** What changed since the commit of the last passing run, untracked files included, and its setup; none if none. */
async function last() {
  const base = existsSync(record) ? readFileSync(record, 'utf8').trim() : ''
  try {
    git('merge-base', '--is-ancestor', base, 'HEAD')
  } catch {
    return undefined
  }
  const changed = [
    ...lines(git('diff', '--name-only', base)),
    ...lines(git('ls-files', '--others', '--exclude-standard')),
  ]
  const at = (file: string) => git('show', `${base}:${file}`)
  return { changed, setup: await setupOf(at('stryker.config.mjs'), at('pnpm-lock.yaml')) }
}

// What the run tests is the tree as it starts: a commit made while it runs is not covered by it.
const tested = git('status', '--porcelain') === '' ? git('rev-parse', 'HEAD') : undefined
const scope = values.full ? { full: 'asked for' } : mutationScope(now, MUTATION_TESTS, imports, await last())
if ('full' in scope) {
  say(`every module (${scope.full})`)
  execFileSync('pnpm', ['exec', 'stryker', 'run'], { cwd: ROOT, stdio: 'inherit' })
} else if (scope.files.length === 0) {
  say('no change since the last passing run reaches a mutant')
} else {
  say(`the modules a change since the last passing run reaches: ${scope.files.join(', ')}`)
  execFileSync('pnpm', ['exec', 'stryker', 'run', '--mutate', scope.files.join(',')], { cwd: ROOT, stdio: 'inherit' })
}
if (tested !== undefined) writeFileSync(record, tested)
else say('the tree had changes no commit holds: this result is not kept')
