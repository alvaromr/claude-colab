// Runs with `node --test tests/`: the git hooks that keep tags in place and unfinished commits off a remote, in
// repositories of the test's own.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'colab-githooks-'))
after(() => rmSync(dir, { recursive: true, force: true }))
// Only the hooks under test: the repo's pre-commit would run the whole gate in each repository made here.
const hooks = join(dir, 'hooks')
mkdirSync(hooks)
for (const hook of ['reference-transaction', 'pre-push']) {
  symlinkSync(fileURLToPath(new URL(`../.githooks/${hook}`, import.meta.url)), join(hooks, hook))
}
// Inside a commit, where the pre-commit hook runs these tests, git exports GIT_DIR and GIT_INDEX_FILE: inherited, they
// would point every command here at the repository being committed. No GIT_ variable of the caller's goes through.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't',
}
let made = 0

/** A repository with one commit, and a bare remote it pushes to; `git(...)` runs with the hooks, `bare(...)` without. */
function repository() {
  const root = join(dir, String(made++))
  const run =
    (hooksPath: string) =>
    (...args: string[]) =>
      spawnSync('git', ['-c', `core.hooksPath=${hooksPath}`, ...args], { cwd: root, env, encoding: 'utf8' })
  mkdirSync(root)
  const bare = run('/dev/null')
  // Before anything is written: a repository reached from here would be the one the commands change.
  assert.equal(bare('rev-parse', '--git-dir').status, 128, 'a repository is reachable from the test’s folder')
  bare('init', '-q', '-b', 'main')
  bare('init', '-q', '--bare', 'remote.git')
  bare('remote', 'add', 'origin', 'remote.git')
  bare('commit', '-q', '--allow-empty', '-m', 'feat: one')
  return { git: run(hooks), bare }
}

test('a tag is made, but never moved nor deleted', () => {
  const { git } = repository()
  assert.equal(git('tag', 'v1').status, 0)
  assert.equal(git('tag', '-a', 'v2', '-m', 'v2').status, 0)
  git('commit', '-q', '--allow-empty', '-m', 'feat: two')
  for (const args of [
    ['tag', '-f', 'v1'],
    ['tag', '-f', '-a', 'v2', '-m', 'v2 again'],
    ['tag', '-d', 'v1'],
    ['update-ref', '-d', 'refs/tags/v2'],
  ]) {
    const { status, stderr } = git(...args)
    assert.notEqual(status, 0, args.join(' '))
    assert.match(stderr, /tags never move/, args.join(' '))
  }
  // Branches move freely, and packing the refs is no move.
  assert.equal(git('branch', '-f', 'other', 'HEAD~1').status, 0)
  assert.equal(git('pack-refs', '--all').status, 0)
  assert.equal(git('tag', '-f', 'v1', 'HEAD~1').status, 0, 'the same commit again is no move')
  assert.equal(git('rev-parse', 'v1').stdout, git('rev-parse', 'HEAD~1').stdout)
})

test('a push with an unfinished commit is refused, and a finished one goes', () => {
  for (const subject of ['WIP', 'wip: half', 'fixup! feat: one', 'squash! feat: one']) {
    const { git } = repository()
    git('commit', '-q', '--allow-empty', '-m', subject)
    git('commit', '-q', '--allow-empty', '-m', 'feat: after it')
    const { status, stderr } = git('push', '-q', 'origin', 'main')
    assert.notEqual(status, 0, subject)
    assert.match(stderr, /unfinished commit/, subject)
  }
  const { git } = repository()
  assert.equal(git('push', '-q', 'origin', 'main').status, 0)
  git('commit', '-q', '--allow-empty', '-m', 'feat: wiper')
  assert.equal(git('push', '-q', 'origin', 'main').status, 0, 'only what has been pushed before is left out')
  git('commit', '-q', '--allow-empty', '-m', 'WIP')
  assert.notEqual(git('push', '-q', 'origin', 'main').status, 0)
  assert.equal(git('push', '-q', 'origin', 'main~1:refs/heads/other').status, 0, 'a new branch: only its own commits')
})

test('a tag on the remote is never moved nor deleted by a push', () => {
  const { git, bare } = repository()
  git('tag', 'v1')
  assert.equal(git('push', '-q', 'origin', 'main', 'v1').status, 0)
  bare('commit', '-q', '--allow-empty', '-m', 'feat: two')
  bare('tag', '-f', 'v1')
  for (const args of [
    ['push', '-q', '--force', 'origin', 'v1'],
    ['push', '-q', 'origin', ':refs/tags/v1'],
  ]) {
    const { status, stderr } = git(...args)
    assert.notEqual(status, 0, args.join(' '))
    assert.match(stderr, /tags never move/, args.join(' '))
  }
  git('tag', 'v2')
  assert.equal(git('push', '-q', 'origin', 'main', 'v2').status, 0)
})
