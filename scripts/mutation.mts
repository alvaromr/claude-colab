// `pnpm mutation [--full]`: mutation testing (Stryker) of what changed since the last run that passed, as `scope.mts`
// decides, or of everything with `--full`. The commit a passing run covers is kept in the repository's git folder
// (`git rev-parse --git-path colab-mutation`), never versioned; a run on a tree with changes keeps none, since no
// commit holds what it tested.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { mutationScope } from './scope.mts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const say = (line: string) => process.stdout.write(`mutation: ${line}\n`)
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
const lines = (text: string) => text.split('\n').filter(line => line !== '')

const { values } = parseArgs({ options: { full: { type: 'boolean' } } })
const record = join(ROOT, git('rev-parse', '--git-path', 'colab-mutation').trim())
// The config is plain JavaScript, with no types to import it by.
const config: { default: { mutate: string[] } } = await import(join(ROOT, 'stryker.config.mjs'))
const patterns = config.default.mutate
const mutated = lines(git('ls-files', '--cached', '--others', '--exclude-standard')).filter(
  file =>
    patterns.some(pattern => !pattern.startsWith('!') && matchesGlob(file, pattern)) &&
    !patterns.some(pattern => pattern.startsWith('!') && matchesGlob(file, pattern.slice(1))),
)

/** What changed since the commit of the last passing run, untracked files included; `undefined` if there is none. */
function changedSince() {
  const base = existsSync(record) ? readFileSync(record, 'utf8').trim() : ''
  try {
    git('merge-base', '--is-ancestor', base, 'HEAD')
  } catch {
    return undefined
  }
  return [...lines(git('diff', '--name-only', base)), ...lines(git('ls-files', '--others', '--exclude-standard'))]
}

const scope = values.full ? { full: 'asked for' } : mutationScope(changedSince(), mutated)
if ('full' in scope) {
  say(`every module (${scope.full})`)
  execFileSync('pnpm', ['exec', 'stryker', 'run'], { cwd: ROOT, stdio: 'inherit' })
} else if (scope.files.length === 0) {
  say('nothing it mutates changed since the last passing run')
} else {
  say(`what changed since the last passing run: ${scope.files.join(', ')}`)
  execFileSync('pnpm', ['exec', 'stryker', 'run', '--mutate', scope.files.join(',')], { cwd: ROOT, stdio: 'inherit' })
}
if (git('status', '--porcelain') === '') writeFileSync(record, git('rev-parse', 'HEAD'))
else say('the tree has changes no commit holds: this result is not kept')
