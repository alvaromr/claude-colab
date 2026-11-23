// `pnpm release <version>`: releases the plugin, stopping at the first step that fails. Checks the tree and the tag,
// runs the gate, installs the release as a user would in a home of its own and smokes the installed copy, then writes
// the version and the changelog, commits and tags. It never pushes. `--dry-run` stops before changing anything.
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { bumpManifest, nextVersion, releaseChangelog, tagOf } from './bump.mts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// The plugin's folder, the marketplace's source: what an install copies.
const PLUGIN = 'plugins/colab'
const MANIFEST = `${PLUGIN}/.claude-plugin/plugin.json`
const CHANGELOG = 'CHANGELOG.md'

const say = (line: string) => process.stdout.write(`release: ${line}\n`)
/** Runs a command with its output shown; throws if it fails. */
const run = (command: string, args: string[], options: ExecFileSyncOptions = {}) =>
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options })
/** Runs a command and returns what it prints; throws if it fails. */
const output = (command: string, args: string[], options: ExecFileSyncOptions = {}) =>
  execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  }).toString()

function release() {
  const { values, positionals } = parseArgs({ options: { 'dry-run': { type: 'boolean' } }, allowPositionals: true })
  if (positionals.length !== 1) throw new Error('usage: pnpm release <x.y.z> [--dry-run]')
  const manifest = readFileSync(join(ROOT, MANIFEST), 'utf8')
  const { name, version: current } = JSON.parse(manifest) as { name: string; version: string }
  const version = nextVersion(current, String(positionals[0]))
  const tag = tagOf(name, version)
  const changes = {
    [MANIFEST]: bumpManifest(manifest, version),
    [CHANGELOG]: releaseChangelog(
      readFileSync(join(ROOT, CHANGELOG), 'utf8'),
      version,
      new Date().toISOString().slice(0, 10),
    ),
  }

  say(`${name} ${version}: checking the tree and the tag`)
  if (output('git', ['status', '--porcelain']) !== '') throw new Error('the tree has uncommitted changes')
  if (output('git', ['tag', '--list', tag]) !== '') throw new Error(`the tag ${tag} exists already`)

  // The slow checks too, which a push runs: a tag made before they fail could never be moved.
  say('running the gate and the slow checks')
  run('pnpm', ['check'])
  run('pnpm', ['check:slow'])

  const scratch = mkdtempSync(join(tmpdir(), 'colab-release-'))
  try {
    say('installing it as a user would, in a home of its own')
    const [source, home] = [join(scratch, 'source'), join(scratch, 'home')]
    for (const folder of [source, home]) mkdirSync(folder)
    // What a clone holds (what git tracks, at HEAD), with this release's version and changelog.
    run('git', ['archive', '--output', join(scratch, 'source.tar'), 'HEAD'])
    run('tar', ['-xf', join(scratch, 'source.tar'), '-C', source])
    for (const [file, text] of Object.entries(changes)) writeFileSync(join(source, file), text)
    const user = { env: { PATH: String(process.env.PATH), HOME: home } }
    run('claude', ['plugin', 'install', name, '--marketplace', source], user)
    const installed = (
      JSON.parse(output('claude', ['plugin', 'list', '--json'], user)) as {
        id: string
        version: string
        installPath: string
      }[]
    ).find(plugin => plugin.id.startsWith(`${name}@`))
    if (installed?.version !== version) throw new Error(`the installed ${name} is not ${version}`)

    say(`smoking the installed copy, in ${installed.installPath}`)
    run('claude', ['plugin', 'validate', installed.installPath], user)
    const cli = join(installed.installPath, 'cli', 'claude-colab.mts')
    run('node', [cli, '--help'], user)
    run('node', [cli, 'status'], user)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  if (values['dry-run']) {
    say(`dry run: would write ${Object.keys(changes).join(' and ')}, commit and tag ${tag}; nothing changed`)
    return
  }
  for (const [file, text] of Object.entries(changes)) writeFileSync(join(ROOT, file), text)
  try {
    say('committing; the pre-commit hook runs the gate again, on the release')
    run('git', ['commit', '--message', `chore(release): ${version}`, '--', ...Object.keys(changes)])
  } catch (error) {
    // The tree was clean: this undoes only the release's own changes.
    run('git', ['checkout', '--', ...Object.keys(changes)])
    throw error
  }
  run('claude', ['plugin', 'tag', '--message', `${name} %s`, join(ROOT, PLUGIN)])
  say(`released ${tag}; nothing is pushed`)
}

try {
  release()
} catch (error) {
  say(`failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
