// Runs with Vitest: the claude-colab command end to end, as people run it, in a home of the test's own.
import assert from 'node:assert/strict'
import { type ChildProcess, execFile, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net, { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll as after, test } from 'vitest'
import { invitation, newKey } from '../plugins/colab/cli/wire.mts'

type Line = Record<string, unknown>

const CLI = fileURLToPath(new URL('../plugins/colab/cli/claude-colab.mts', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'colab-cli-'))
const env = { ...process.env, HOME: home, CLAUDE_COLAB_SOCKET: '' }
const started: ChildProcess[] = []
// Every server these tests open carries this name. `serve --background` runs apart from the test, so a failure (or
// broken code, as a mutant) that keeps `stop` from ending it would leave it running: it is ended here by its name.
const RUN = `prueba-${process.pid}`
const serve = (...args: string[]) => ['serve', '--name', RUN, ...args]
// No test takes this long; one that does is stopped, and its processes with it.
const LIMIT = { timeout: 30_000 }
after(() => {
  for (const child of started) child.kill('SIGKILL')
  spawnSync('pkill', ['-KILL', '-f', RUN])
  rmSync(home, { recursive: true, force: true })
})

/** One command to its end: its exit code, and its output, as JSON when it is. */
function run(args: string[], stdin?: string, more: Record<string, string> = {}) {
  return new Promise<{ code: number; answer: Line; stdout: string; stderr: string }>(resolve => {
    const child = execFile(process.execPath, [CLI, ...args], { env: { ...env, ...more } }, (error, stdout, stderr) => {
      let answer: Line
      try {
        answer = JSON.parse(stdout)
      } catch {
        answer = {}
      }
      resolve({ code: error ? Number(error.code) : 0, answer, stdout, stderr })
    })
    child.stdin?.end(stdin)
  })
}

/** A command left running: `lines` holds each JSON line it prints, `next(isIt)` waits for one. */
function keep(args: string[]) {
  const child = spawn(process.execPath, [CLI, ...args], { env })
  started.push(child)
  const lines: Line[] = []
  let pending = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    const whole = (pending + chunk).split('\n')
    pending = String(whole.pop())
    lines.push(...whole.map(line => JSON.parse(line)))
  })
  const ended = new Promise(resolve => child.once('exit', resolve))
  const next = async (isIt: (line: Line) => boolean = () => true) => {
    for (const end = Date.now() + 5_000; Date.now() < end; await sleep(20)) {
      const found = lines.find(isIt)
      if (found) return found
    }
    assert.fail(`no llegó; llegó: ${JSON.stringify(lines)}`)
  }
  return { lines, next, ended, kill: (signal: NodeJS.Signals) => child.kill(signal) }
}

const freePort = () =>
  new Promise<number>(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })

test('arguments: help answers, and what is not a command or an option is a usage error', LIMIT, async () => {
  assert.equal((await run([])).code, 0)
  assert.match((await run(['say', '--help'])).stdout, /--claude/)
  for (const args of [['volar'], ['serve', '--port', 'abc'], ['say'], ['serve', '--clave', 'x']]) {
    assert.equal((await run(args)).code, 2, args.join(' '))
  }
  const junk = await run(['accept'], 'colab:basura')
  assert.equal(junk.code, 1)
  assert.match(junk.stderr, /La invitación no es válida/)
  const nobody = await run(['rooms', '--socket', join(home, 'nadie.sock')])
  assert.equal(nobody.code, 1)
  assert.match(nobody.stderr, /No hay ningún connect escuchando/)
  // Longer than any system takes, macOS's 253 bytes included: past a name's 255 only through a folder.
  const tooLong = await run(['rooms', '--socket', join(home, 'x'.repeat(200), `${'x'.repeat(120)}.sock`)])
  assert.equal(tooLong.code, 1)
  assert.match(tooLong.stderr, /^La ruta del socket es demasiado larga para este sistema: .*x\.sock\n$/)
})

test('it speaks English to a locale that is not Spanish, help and errors alike', LIMIT, async () => {
  const english = { LC_ALL: '', LC_MESSAGES: '', LANG: 'en_US.UTF-8' }
  assert.match((await run([], undefined, english)).stdout, /^claude-colab: connects the Claude Code sessions/)
  assert.match((await run(['say', '--help'], undefined, english)).stdout, /--claude +signed by your Claude/)
  assert.match((await run(['accept'], 'colab:basura', english)).stderr, /The invitation is not valid/)
})

test('one serve, two people: a room, its invitation, what they say, and the server closed', LIMIT, async () => {
  const port = await freePort()
  const address = `127.0.0.1:${port}`
  const serving = keep(serve('--host', '127.0.0.1', '--port', String(port)))
  const opened = await serving.next()
  assert.equal(opened.ok, true)
  assert.equal(opened.title, RUN)

  const status = await run(['status'])
  assert.equal(status.answer.running, true)
  assert.equal(status.answer.key, opened.key, 'the key is kept to connect from this machine')
  assert.match((await run(serve('--port', String(await freePort())))).stderr, /Ya hay un servidor/)

  const socket = (name: string) => join(home, `${name}.sock`)
  const ana = keep(['connect', address, '--name', 'Ana', '--socket', socket('ana')])
  const bob = keep(['connect', address, '--name', 'Bob', '--socket', socket('bob')])
  await ana.next(line => line.ev === 'connected')
  await bob.next(line => line.ev === 'connected')

  const outside = await run(['leave', '--socket', socket('ana')])
  assert.equal(outside.code, 1, 'an answer that is not ok exits with 1')
  assert.equal(outside.answer.ok, false)

  const made = (await run(['create', '--socket', socket('ana')])).answer
  assert.equal(made.ok, true)
  const invited = await run(['invite', '--socket', socket('ana')])
  // A machine with no network address has nothing to invite to.
  if (invited.code !== 0) {
    assert.match(invited.stderr + JSON.stringify(invited.answer), /ninguna dirección de red/)
    return
  }
  const invitation = String(invited.answer.invitation)
  const accepted = (await run(['accept'], invitation)).answer
  assert.deepEqual([accepted.room, accepted.code], [made.label, made.code])

  const joined = (await run(['join', '--socket', socket('bob')], invitation)).answer
  assert.deepEqual(joined.members, ['Ana', 'Bob'])
  assert.equal((await run(['say', 'hola', '--socket', socket('bob')])).code, 0)
  assert.equal((await run(['say', 'listo', '--claude', '--to', 'Bob', '--socket', socket('ana')])).code, 0)

  const hola = await ana.next(line => line.ev === 'message' && line.text === 'hola')
  assert.deepEqual([hola.from, hola.by, hola.own], ['Bob', 'person', false])
  assert.equal((await bob.next(line => line.ev === 'message' && line.text === 'hola')).own, true)
  const listo = await bob.next(line => line.ev === 'message' && line.text === 'listo')
  assert.deepEqual([listo.from, listo.by, listo.to], ['Ana', 'claude', 'Bob'])

  assert.equal((await run(['leave', '--socket', socket('bob')])).code, 0)
  await ana.next(line => line.ev === 'member' && line.name === 'Bob' && line.action === 'leave')
  // As its own process, which tests/link.test.mts stands in for: a signal ends it well, its socket gone with it.
  bob.kill('SIGTERM')
  assert.equal(await bob.ended, 0, 'connect asked to end ends well')
  assert.equal(existsSync(socket('bob')), false, 'and takes its socket with it')

  assert.equal((await run(['stop'])).code, 0)
  assert.equal(await serving.ended, 0)
  assert.equal(await ana.ended, 1, 'those linked to it are disconnected')
  assert.equal((await run(['status'])).answer.running, false)
})

test('serve in the background answers once it listens, and keeps its key unless told otherwise', LIMIT, async () => {
  const port = String(await freePort())
  const opens: [string[], Record<string, string>][] = [
    [[], {}],
    [[], {}],
    [['--new-key'], {}],
  ]
  const keys: unknown[] = []
  for (const [more, keyed] of opens) {
    const opened = await run(serve('--background', '--host', '127.0.0.1', '--port', port, ...more), undefined, keyed)
    assert.equal(opened.code, 0, opened.stderr)
    assert.equal(opened.answer.listening, `127.0.0.1:${port}`)
    assert.equal((await run(['status'])).answer.running, true)
    keys.push(opened.answer.key)
    assert.equal((await run(['stop'])).code, 0)
  }
  assert.equal(keys[1], keys[0], 'opened again, it keeps its key')
  assert.notEqual(keys[2], keys[1], '--new-key makes another')
})

test('serve says why it did not start: a port in use, a bad key, a bad name', LIMIT, async () => {
  const taken = net.createServer().listen(0, '127.0.0.1')
  taken.unref() // left open by a failure halfway, it keeps no run alive
  await new Promise(resolve => taken.once('listening', resolve))
  const port = String((taken.address() as AddressInfo).port)

  const inUse = await run(serve('--background', '--host', '127.0.0.1', '--port', port))
  assert.equal(inUse.code, 1)
  assert.equal(inUse.answer.error, `El puerto ${port} lo usa otro programa`)
  taken.close()

  const elsewhere = await run(serve('--background', '--host', '192.0.2.1', '--port', port))
  assert.equal(elsewhere.code, 1)
  assert.match(String(elsewhere.answer.error), /EADDRNOTAVAIL/, 'an address that is not this machine’s')

  // A key file left broken by hand: the key saved for this server is no key.
  mkdirSync(join(home, '.claude-colab', 'keys'), { recursive: true, mode: 0o700 })
  writeFileSync(join(home, '.claude-colab', 'keys', encodeURIComponent(`127.0.0.1:${port}`)), 'corta\n', {
    mode: 0o600,
  })
  const badKey = await run(serve('--background', '--port', port))
  assert.equal(badKey.code, 1)
  assert.match(badKey.stderr, new RegExp(`El servidor del puerto ${port} terminó sin escuchar`))

  assert.equal((await run(['serve', '--name', ''])).code, 2)
  assert.equal((await run(['status'])).answer.running, false)
})

test('stop says so when there is no server', LIMIT, async () => {
  assert.match((await run(['stop'])).stderr, /No hay ningún servidor abierto/)
})

test('a key is saved for the address it is given, and an invitation for each of its addresses', LIMIT, async () => {
  const key = newKey()
  for (const [address, saved] of [
    ['192.0.2.9', '192.0.2.9:4747'],
    ['192.0.2.9:5000', '192.0.2.9:5000'],
    ['2001:db8::9', '2001:db8::9:4747'],
    ['[2001:db8::9]:5000', '2001:db8::9:5000'],
  ] as const) {
    assert.equal((await run(['key', address], key)).answer.saved, saved)
  }
  const invited = invitation({
    addresses: ['192.0.2.9', '2001:db8::9'],
    port: 4747,
    key,
    room: '1',
    code: 'a'.repeat(24),
  })
  assert.deepEqual((await run(['accept'], invited)).answer.servers, ['192.0.2.9:4747', '[2001:db8::9]:4747'])

  const unknown = await run(['connect', '192.0.2.10'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /No hay clave para 192\.0\.2\.10:4747/)
})

test('a request to a local socket that is not a connect says why', LIMIT, async () => {
  const notSocket = join(home, 'fichero')
  writeFileSync(notSocket, '')
  assert.match((await run(['rooms', '--socket', notSocket])).stderr, /ENOTSOCK/)

  // A socket left behind by a process that died: nobody listens there.
  const left = join(home, 'dejado.sock')
  const holder = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${JSON.stringify(left)})`])
  started.push(holder)
  for (const end = Date.now() + 5_000; !existsSync(left) && Date.now() < end;) await sleep(20)
  holder.kill('SIGKILL')
  await new Promise(resolve => holder.once('exit', resolve))
  assert.match((await run(['rooms', '--socket', left])).stderr, /No hay ningún connect escuchando/)
})
