// Runs with Vitest: the keys this machine keeps, in a home of the test's own.
import assert from 'node:assert/strict'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll as after, test } from 'vitest'
import { newKey } from '../plugins/colab/cli/wire.mts'
import { fakeProcess } from './host.mts'

const HOME_MODULE = fileURLToPath(new URL('../plugins/colab/cli/home.mts', import.meta.url))
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
  serverEnded,
  serverKey,
  socketError,
} = await import('../plugins/colab/cli/home.mts')
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

  for (const code of ['EINVAL', 'ENAMETOOLONG']) {
    assert.equal(
      socketError('/s.sock', failure(code)).message,
      'La ruta del socket es demasiado larga para este sistema: /s.sock',
      code,
    )
  }
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

test('this machine’s server opens with its saved key, else a new one, and never with one of the environment', t => {
  t.onTestFinished(() => {
    delete process.env.CLAUDE_COLAB_KEY
  })
  const fresh = serverKey(4900, false)
  assert.match(fresh, /^[\w-]{43}$/, 'none saved: a new one')
  saveKey('127.0.0.1', 4900, fresh)
  assert.equal(serverKey(4900, false), fresh, 'the saved one')
  const changed = serverKey(4900, true)
  assert.notEqual(changed, fresh, 'asked for a new one')
  assert.match(changed, /^[\w-]{43}$/)

  // Every process the session starts would inherit a key of the environment: none is read.
  const exported = newKey()
  process.env.CLAUDE_COLAB_KEY = exported
  assert.equal(serverKey(4900, false), fresh)
  assert.notEqual(serverKey(4900, true), exported)
  assert.throws(() => loadKey('192.0.2.11', 4747), /No hay clave para 192\.0\.2\.11:4747/)
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

test('the wait for this machine’s server to end tells whether it ended before its time ran out', async () => {
  const mine = { pid: process.pid, host: '127.0.0.1', port: 4747, title: 'Prueba' }
  writeFileSync(SERVER, JSON.stringify(mine))
  await assert.rejects(serverEnded({ timeout: 30, every: 5 }), /^Error: El servidor no se ha cerrado/, 'it lives on')
  // One that ends meanwhile: the wait has found it running, synchronously, before the record goes.
  const ending = serverEnded({ timeout: 1_000, every: 5 })
  rmSync(SERVER)
  await ending
  await serverEnded({ timeout: 0, every: 5 }) // none at all
})

test('a server record that is no record, or whose process is another user’s, is forgotten; one unreadable stays', () => {
  const mine = { pid: process.pid, host: '127.0.0.1', port: 4747, title: 'Prueba' }
  for (const [what, text] of [
    ['junk', 'basura'],
    ['a process of root', JSON.stringify({ ...mine, pid: 1 })],
  ] as const) {
    writeFileSync(SERVER, text)
    assert.equal(runningServer(), undefined, what)
    assert.equal(isThere(SERVER), false, `${what}: its file goes`)
  }

  writeFileSync(SERVER, JSON.stringify(mine))
  chmodSync(SERVER, 0o000)
  assert.throws(() => runningServer(), { code: 'EACCES' }, 'a failure of the disk is no server gone')
  assert.equal(isThere(SERVER), true, 'and the record of a server that may live stays')
  rmSync(SERVER)
})

test('a server written down, only for its owner, is forgotten when its process ends however it ends', () => {
  // Its process is one of the test's own (tests/host.mts), of another pid than the test's.
  for (const ending of ['exit', 'SIGINT', 'SIGTERM'] as const) {
    const serving = fakeProcess()
    markServer('127.0.0.1', 4747, 'Prueba', serving.host)
    if (ending === 'exit') serving.host.exit(0)
    else {
      assert.equal(lstatSync(SERVER).mode & 0o777, 0o600)
      assert.equal(runningServer()?.pid, serving.host.pid)
      serving.kill(ending)
    }
    assert.deepEqual(serving.exits, [0], ending)
    assert.equal(isThere(SERVER), false, `${ending}: its file goes`)
  }

  // Another took its place meanwhile: the file is no longer its own to remove.
  const serving = fakeProcess()
  markServer('127.0.0.1', 4747, 'Prueba', serving.host)
  const other = { pid: process.pid, host: '127.0.0.1', port: 4800, title: 'Otro' }
  writeFileSync(SERVER, JSON.stringify(other))
  serving.kill('SIGTERM')
  assert.deepEqual(serving.exits, [0])
  assert.deepEqual(runningServer(), other)
  rmSync(SERVER)

  // Or its file went: it ends as it would.
  const gone = fakeProcess()
  markServer('127.0.0.1', 4747, 'Prueba', gone.host)
  rmSync(SERVER)
  gone.kill('SIGTERM')
  assert.deepEqual(gone.exits, [0])
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

test('a folder under one that others may change is refused, unless that one is sticky, as /tmp is', () => {
  const shared = join(home, 'compartida')
  mkdirSync(shared)
  chmodSync(shared, 0o777)
  assert.throws(
    () => privateFolder(join(shared, 'colab')),
    new Error(
      `${shared}, por encima de la carpeta de claude-colab, lo pueden cambiar otros: que solo tú o root podáis escribir en él (chmod go-w), o ponle el bit sticky (chmod +t)`,
    ),
  )
  chmodSync(shared, 0o1777)
  assert.equal(lstatSync(privateFolder(join(shared, 'colab'))).mode & 0o777, 0o700, 'sticky: no one renames it away')
  chmodSync(shared, 0o775)
  assert.throws(() => privateFolder(join(shared, 'colab')), /lo pueden cambiar otros/, 'its group may too')
  assert.throws(
    () => privateFolder(join(shared, 'dentro', 'colab')),
    new RegExp(`^Error: ${shared}, por encima`),
    'however far above it is',
  )
})
