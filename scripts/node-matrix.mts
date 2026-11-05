// The Node tests on each Node the project supports: the oldest that `engines` takes and the one `.node-version` pins.
// Each comes from nodejs.org, checked against its release's SHA-256 sums, and is kept in ~/.cache/claude-colab/node.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CACHE = join(homedir(), '.cache', 'claude-colab', 'node')
const range = String(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node)
const oldest = /^>=(\d+)$/.exec(range)?.[1]
if (oldest === undefined) throw new Error(`node-matrix: engines.node is ${range}, not >=<major>: say which to test`)
const versions = [...new Set([`${oldest}.0.0`, readFileSync(join(ROOT, '.node-version'), 'utf8').trim()])]

/** The folder of Node `version`'s binaries, downloaded and checked the first time. */
async function nodeOf(version: string) {
  const name = `node-v${version}-${process.platform}-${process.arch}`
  const bin = join(CACHE, name, 'bin')
  if (existsSync(join(bin, 'node'))) return bin
  const dist = `https://nodejs.org/dist/v${version}`
  const fetched = async (file: string) => {
    const response = await fetch(`${dist}/${file}`)
    if (!response.ok) throw new Error(`node-matrix: ${dist}/${file} answered ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  const tarball = `${name}.tar.gz`
  const sums = (await fetched('SHASUMS256.txt')).toString()
  const expected = sums
    .split('\n')
    .find(line => line.endsWith(`  ${tarball}`))
    ?.split(' ')[0]
  const bytes = await fetched(tarball)
  if (expected === undefined || createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`node-matrix: ${tarball} does not match its SHA-256 in ${dist}/SHASUMS256.txt`)
  }
  mkdirSync(CACHE, { recursive: true })
  const archive = join(CACHE, tarball)
  writeFileSync(archive, bytes)
  execFileSync('tar', ['xzf', archive, '-C', CACHE])
  rmSync(archive)
  return bin
}

for (const version of versions) {
  const env = { ...process.env, PATH: `${await nodeOf(version)}:${process.env.PATH}` }
  // The one the tests will run on, as the PATH they get finds it.
  const running = execFileSync('pnpm', ['exec', 'node', '--version'], { cwd: ROOT, env }).toString().trim()
  process.stdout.write(`node-matrix: the Node tests on Node ${running}, for ${version}\n`)
  execFileSync('pnpm', ['test:node'], { cwd: ROOT, stdio: 'inherit', env })
}
