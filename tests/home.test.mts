// Runs with `node --test tests/`: the keys this machine keeps, in a home of the test's own.
import assert from 'node:assert/strict'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { newKey } from '../cli/wire.mts'

const HOME_MODULE = fileURLToPath(new URL('../cli/home.mts', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'colab-home-'))
const children: ChildProcess[] = []
after(() => {
  for (const child of children) child.kill('SIGKILL')
  rmSync(home, { recursive: true, force: true })
})
process.env.HOME = home
delete process.env.CLAUDE_COLAB_KEY
delete process.env.CLAUDE_COLAB_SOCKET
const {
  DEFAULT_SOCKET,
  HOME,
  loadKey,
  markServer,
  privateFolder,
  runningServer,
  savedKey,
  saveKey,
  SERVER_LOG,
  socketError,
} = await import('../cli/home.mts')
const keys = join(HOME, 'keys')
const SERVER = join(HOME, 'server.json')
const fileOf = (host: string, port: number) => join(keys, encodeURIComponent(`${host}:${port}`))
const isThere = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined

/** Imports home.mts in a process of its own, with this test's home, and runs `script` there. */
function inChild(script: string, env: Record<string, string> = {}) {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', `import * as home from ${JSON.stringify(HOME_MODULE)}\n${script}`],
    { env: { ...process.env, ...env } },
  )
  children.push(child)
  let out = ''
  let complaint = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    out += chunk
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    complaint += chunk
  })
  const ended = new Promise<[number | null, NodeJS.Signals | null]>(resolve =>
    child.once('exit', (code, signal) => resolve([code, signal])),
  )
  const said = async (what: string) => {
    for (const end = Date.now() + 5_000; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 20))) {
      if (out.includes(what)) return
    }
    assert.fail(`no dijo ${what}: ${out}`)
  }
  return { child, ended, said, output: () => out, complaint: () => complaint }
}

test('its files live in a folder of the home, the local socket included unless CLAUDE_COLAB_SOCKET says another', async () => {
  assert.equal(HOME, join(home, '.claude-colab'))
  assert.equal(SERVER_LOG, join(HOME, 'server.log'))
  assert.equal(DEFAULT_SOCKET, join(HOME, 'colab.sock'))
  const told = inChild('process.stdout.write(home.DEFAULT_SOCKET)', { CLAUDE_COLAB_SOCKET: join(home, 'otro.sock') })
  await told.ended
  assert.equal(told.output(), join(home, 'otro.sock'))
})

test('a socket the system turns down for its path’s length says so; any other failure stays as it came', () => {
  const failure = (code: string) => Object.assign(new Error(code), { code })
  const denied = failure('EACCES')

  assert.equal(
    socketError('/s.sock', failure('EINVAL')).message,
    'La ruta del socket es demasiado larga para este sistema: /s.sock',
  )
  assert.equal(socketError('/s.sock', denied), denied)
})

test('a key is kept for its server alone, readable by its owner alone', () => {
  const key = newKey()

  assert.equal(savedKey('192.0.2.5', 4747), undefined, 'none yet')
  saveKey('192.0.2.5', 4747, ` ${key}\n`)
  assert.equal(savedKey('192.0.2.5', 4747), key)
  assert.equal(readFileSync(fileOf('192.0.2.5', 4747), 'utf8'), `${key}\n`, 'kept without the blanks around it')
  assert.equal(savedKey('192.0.2.5', 4748), undefined, 'another port is another server')
  assert.equal(lstatSync(fileOf('192.0.2.5', 4747)).mode & 0o777, 0o600)
  assert.equal(lstatSync(HOME).mode & 0o777, 0o700)
  assert.throws(() => saveKey('192.0.2.5', 4747, 'corta'), /La clave no es válida/)
})

test('a key file that others can read, or that is no plain file, is refused', () => {
  const key = newKey()
  saveKey('192.0.2.6', 4747, key)
  chmodSync(fileOf('192.0.2.6', 4747), 0o644)
  assert.throws(() => savedKey('192.0.2.6', 4747), /solo tuyo/)

  mkdirSync(fileOf('192.0.2.7', 4747), { mode: 0o700 })
  assert.throws(() => savedKey('192.0.2.7', 4747), /solo tuyo/)

  const elsewhere = join(home, 'otra-clave')
  writeFileSync(elsewhere, key, { mode: 0o600 })
  symlinkSync(elsewhere, fileOf('192.0.2.8', 4747))
  assert.throws(() => savedKey('192.0.2.8', 4747), /solo tuyo/, 'a link is not followed')

  const fresh = newKey()
  saveKey('192.0.2.8', 4747, fresh)
  assert.equal(lstatSync(fileOf('192.0.2.8', 4747)).isFile(), true, 'saving replaces the link with a file')
  assert.equal(readFileSync(elsewhere, 'utf8'), key, 'and leaves what it pointed at alone')
})

test('a server with no key saved for it cannot be linked to, and the message says how to save one', () => {
  assert.throws(() => loadKey('192.0.2.9', 4747), /No hay clave para 192\.0\.2\.9:4747: guárdala con claude-colab key/)
  const key = newKey()
  saveKey('192.0.2.9', 4747, key)
  assert.deepEqual(loadKey('192.0.2.9', 4747), Buffer.from(key, 'base64url'))
})

test('the machine’s server is the one written down while its process lives; one whose process ended is forgotten', () => {
  assert.equal(runningServer(), undefined, 'none written down')
  const mine = { pid: process.pid, host: '127.0.0.1', port: 4747, title: 'Prueba' }
  writeFileSync(SERVER, JSON.stringify(mine))
  assert.deepEqual(runningServer(), mine)

  const ended = spawnSync(process.execPath, ['-e', ''])
  writeFileSync(SERVER, JSON.stringify({ ...mine, pid: ended.pid }))
  assert.equal(runningServer(), undefined)
  assert.equal(isThere(SERVER), false, 'and its file goes')
})

test('a server written down, only for its owner, is forgotten when its process ends however it ends', async () => {
  for (const ending of ['exit', 'SIGINT', 'SIGTERM'] as const) {
    const serving = inChild(
      `home.markServer('127.0.0.1', 4747, 'Prueba')
process.stdout.write('listo')
${ending === 'exit' ? 'process.exit(0)' : 'setInterval(() => {}, 1000)'}`,
    )
    await serving.said('listo')
    if (ending !== 'exit') {
      assert.equal(lstatSync(SERVER).mode & 0o777, 0o600)
      assert.equal(runningServer()?.pid, serving.child.pid)
      serving.child.kill(ending)
    }
    assert.deepEqual(await serving.ended, [0, null], ending)
    assert.equal(isThere(SERVER), false, `${ending}: its file goes`)
  }

  // Another took its place meanwhile: the file is no longer its own to remove.
  const serving = inChild(`home.markServer('127.0.0.1', 4747, 'Prueba')
process.stdout.write('listo')
setInterval(() => {}, 1000)`)
  await serving.said('listo')
  const other = { pid: process.pid, host: '127.0.0.1', port: 4800, title: 'Otro' }
  writeFileSync(SERVER, JSON.stringify(other))
  serving.child.kill('SIGTERM')
  await serving.ended
  assert.deepEqual(runningServer(), other)
  rmSync(SERVER)

  // Or its file went: it ends as it would.
  const gone = inChild(`home.markServer('127.0.0.1', 4747, 'Prueba')
process.stdout.write('listo')
setInterval(() => {}, 1000)`)
  await gone.said('listo')
  rmSync(SERVER)
  gone.child.kill('SIGTERM')
  assert.deepEqual(await gone.ended, [0, null])
  assert.equal(gone.complaint(), '', 'with nothing to say about it')
})

test('a folder others can open is refused for sockets and keys, the home itself included', () => {
  const open = join(home, 'abierta')
  mkdirSync(open, { mode: 0o755 })
  chmodSync(open, 0o755)
  assert.throws(() => privateFolder(open), /tiene que ser solo tuyo/)
  assert.equal(lstatSync(privateFolder(join(home, 'nueva'))).mode & 0o777, 0o700)

  chmodSync(HOME, 0o755)
  try {
    for (const use of [
      () => saveKey('192.0.2.10', 4747, newKey()),
      () => savedKey('192.0.2.5', 4747),
      () => runningServer(),
      () => markServer('127.0.0.1', 4747, 'Prueba'),
    ]) {
      assert.throws(use, /tiene que ser solo tuyo/)
    }
  } finally {
    chmodSync(HOME, 0o700)
  }
})
