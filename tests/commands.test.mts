// Runs with Vitest: what each claude-colab command does, in a process of the test's own (tests/host.mts) and a home
// of its own. tests/cli.test.mts runs the real command, as people do.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net, { type AddressInfo, type Server } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll as after, test } from 'vitest'
import { NAME_LENGTH, type Value } from '../plugins/colab/cli/protocol.ts'
import { invitation, newKey } from '../plugins/colab/cli/wire.mts'
import { fakeProcess } from './host.mts'

const home = mkdtempSync(join(tmpdir(), 'colab-commands-'))
const servers: { close: () => unknown }[] = []
after(() => {
  for (const server of servers) server.close()
  rmSync(home, { recursive: true, force: true })
})
process.env.HOME = home
const { main } = await import('../plugins/colab/cli/commands.mts')
const { HOME, SERVER_LOG, savedKey, saveKey } = await import('../plugins/colab/cli/home.mts')
const { MAIN_HELP } = await import('../plugins/colab/cli/args.mts')
const SERVER = join(HOME, 'server.json')
// The name of the machine the commands run on, as the network knows it, and as they name it.
const HOSTNAME = 'portatil.casa.example'
const MACHINE = 'portatil'

/** A serve --background's process, as the test makes it: it says what the test has it say. */
type Started = { args: string[]; output: number; child: EventEmitter; unrefs: number }

/**
 * Runs the command `argv` in a process of the test's own, of `pid`, with `env` and `stdin`, on a machine of `hostname`.
 * `stdin` may be how reading it fails. `kill` is what it does to a process it signals, and `send`, if given, its
 * channel to a process that started it.
 */
function cli(
  argv: string[],
  {
    env = {},
    stdin = '',
    pid,
    hostname = HOSTNAME,
    kill = () => undefined,
    send,
  }: {
    env?: Record<string, string>
    stdin?: string | Error
    pid?: number
    hostname?: string
    kill?: (pid: number, signal: string) => void
    send?: (message: Value, done: () => void) => void
  } = {},
) {
  const fake = fakeProcess(env, pid)
  const stderr = new PassThrough()
  let complaint = ''
  stderr.setEncoding('utf8')
  stderr.on('data', chunk => {
    complaint += chunk
  })
  const started: Started[] = []
  const exitCodes: number[] = []
  const disconnects: number[] = []
  const left = main({
    ...fake.host,
    argv,
    stderr,
    stdin: () => {
      if (stdin instanceof Error) throw stdin
      return stdin
    },
    hostname: () => hostname,
    kill,
    setExitCode: code => exitCodes.push(code),
    ...(send ? { channel: { send, disconnect: () => disconnects.push(1) } } : {}),
    background: (args, output) => {
      const child = new EventEmitter()
      const one = { args, output, child, unrefs: 0 }
      started.push(one)
      return Object.assign(child, { unref: () => one.unrefs++ }) as never
    },
  })
  const out = () => fake.output()
  /** What it printed, as JSON. */
  const answer = () => JSON.parse(out()) as Record<string, unknown>
  /** Waits for it to print a line. */
  const said = async () => {
    for (const end = Date.now() + 5_000; Date.now() < end; await sleep(10)) if (out().includes('\n')) return answer()
    assert.fail(`no dijo nada; stderr: ${complaint}`)
  }
  return { left, fake, out, answer, said, err: () => complaint, started, exitCodes, disconnects, ended: fake.ended }
}

/** Runs `argv` to its end: its code (0 when it asked for none), what it printed and what it complained of. */
async function run(argv: string[], options?: Parameters<typeof cli>[1]) {
  const one = cli(argv, options)
  await one.left
  const code = one.fake.exits[0] ?? 0
  return { code, out: one.out(), err: one.err(), answer: () => one.answer() }
}

const freePort = () =>
  new Promise<number>(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })

/** A stand-in for connect on a local socket: it answers each request with `answer(op, body)`, and keeps them. */
async function standIn(answer: (op: string, body: Value) => Value = () => ({ ok: true })) {
  const socket = join(home, `connect-${servers.length}.sock`)
  const asked: { op: string; body: Value; type: string | undefined; method: string | undefined }[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      const op = String(req.url).slice(1)
      const parsed = JSON.parse(body) as Value
      asked.push({ op, body: parsed, type: req.headers['content-type'], method: req.method })
      res.end(JSON.stringify(answer(op, parsed)))
    })
  })
  await new Promise(resolve => server.listen(socket, () => resolve(undefined)))
  servers.push(server)
  return { socket, asked }
}

test('help answers on its own and for each command, with the defaults this machine and its environment give', async () => {
  const main = await run([])
  assert.deepEqual([main.code, main.out], [0, `${MAIN_HELP}\n`])
  assert.equal((await run(['--help'])).out, `${MAIN_HELP}\n`)
  const serve = await run(['serve', '--help'])
  assert.equal(serve.code, 0)
  assert.match(serve.out, new RegExp(`el de este equipo: ${MACHINE}\\)`))
  assert.ok(serve.out.includes(SERVER_LOG), 'where its output goes')
  const connect = await run(['connect', '--help'], { env: { CLAUDE_COLAB_SOCKET: '/otro/sitio.sock' } })
  assert.ok(connect.out.includes(`tu usuario: ${userInfo().username})`))
  assert.ok(connect.out.includes('CLAUDE_COLAB_SOCKET o /otro/sitio.sock)'), 'the socket the environment names')
  assert.ok((await run(['rooms', '--help'])).out.includes(`CLAUDE_COLAB_SOCKET o ${join(HOME, 'colab.sock')})`))
})

test('what is not a command, an option or the arguments a command takes is a usage error, which exits with 2', async () => {
  for (const argv of [
    ['volar'],
    ['serve', '--port', 'abc'],
    ['say'],
    ['serve', '--clave', 'x'],
    ['serve', '--name', ''],
  ]) {
    const wrong = await run(argv)
    assert.equal(wrong.code, 2, argv.join(' '))
    assert.notEqual(wrong.err, '', argv.join(' '))
    assert.equal(wrong.out, '')
  }
  assert.match((await run(['volar'])).err, /^Comando desconocido: volar\n\n/)
})

test('any other failure says why on stderr and exits with 1', async () => {
  const junk = await run(['accept'], { stdin: 'colab:basura' })
  assert.deepEqual([junk.code, junk.out], [1, ''])
  assert.match(junk.err, /^La invitación no es válida/)
  const unknown = await run(['connect', '192.0.2.10'])
  assert.equal(unknown.code, 1)
  assert.equal(unknown.err, 'No hay clave para 192.0.2.10:4747: guárdala con claude-colab key 192.0.2.10:4747\n')
  // A failure of the system, with its code, is not one of usage.
  const unread = await run(['key', '192.0.2.10'], {
    stdin: Object.assign(new Error('EAGAIN: resource temporarily unavailable, read'), { code: 'EAGAIN' }),
  })
  assert.deepEqual([unread.code, unread.err], [1, 'EAGAIN: resource temporarily unavailable, read\n'])
})

test('a machine’s name longer than a name may be is cut to fit', async () => {
  const long = 'x'.repeat(NAME_LENGTH + 3)
  const status = (await run(['status'], { hostname: `${long}.example` })).answer()
  assert.equal(status.machine, long.slice(0, NAME_LENGTH))
})

test('a key is saved for the address it is given, and an invitation for each of its addresses', async () => {
  const key = newKey()
  for (const [address, saved] of [
    ['192.0.2.9', '192.0.2.9:4747'],
    ['[2001:db8::9]:5000', '2001:db8::9:5000'],
  ] as const) {
    const told = await run(['key', address], { stdin: key })
    assert.deepEqual([told.code, told.answer()], [0, { ok: true, saved }])
  }
  assert.equal(savedKey('2001:db8::9', 5000), key)
  const invited = invitation({
    addresses: ['192.0.2.8', '2001:db8::8'],
    port: 4747,
    key,
    room: '1',
    code: 'a'.repeat(24),
  })
  const accepted = await run(['accept'], { stdin: invited })
  assert.deepEqual(
    [accepted.code, accepted.answer()],
    [0, { ok: true, servers: ['192.0.2.8:4747', '[2001:db8::8]:4747'], room: '1', code: 'a'.repeat(24) }],
  )
  assert.equal(savedKey('2001:db8::8', 4747), key)
})

test('each request goes to the local connect, by its socket or the default one, and its answer is printed', async () => {
  const connect = await standIn((op, body) => (op === 'leave' ? { ok: false, error: 'fuera' } : { ok: true, op, body }))
  const at = ['--socket', connect.socket]
  const code = 'b'.repeat(24)
  const requests: [string[], string, Value, string?][] = [
    [['rooms'], 'rooms', {}],
    [['create', '--name', 'Sala'], 'create', { name: 'Sala' }],
    [['create'], 'create', {}],
    [['invite'], 'invite', {}],
    [['join'], 'join', { code }, invitation({ addresses: ['192.0.2.8'], port: 4747, key: newKey(), room: '2', code })],
    [['say', 'hola'], 'say', { text: 'hola', by: 'person' }],
    [['say', 'listo', '--claude', '--to', 'Bob'], 'say', { text: 'listo', to: 'Bob', by: 'claude' }],
  ]
  for (const [argv, op, body, stdin] of requests) {
    const answered = await run([...argv, ...at], stdin === undefined ? {} : { stdin })
    assert.equal(answered.code, 0, argv.join(' '))
    assert.equal(answered.out, `${JSON.stringify({ ok: true, op, body }, null, 2)}\n`, argv.join(' '))
  }
  assert.deepEqual(
    connect.asked.map(({ op, body }) => [op, body]),
    requests.map(([, op, body]) => [op, body]),
  )
  assert.ok(connect.asked.every(({ type, method }) => type === 'application/json' && method === 'POST'))

  const refused = await run(['leave', ...at])
  assert.equal(refused.code, 1, 'an answer that is not ok exits with 1')
  assert.deepEqual(refused.answer(), { ok: false, error: 'fuera' })
  assert.equal((await run(['rooms'], { env: { CLAUDE_COLAB_SOCKET: connect.socket } })).code, 0)
  assert.equal(connect.asked.length, requests.length + 2, 'the default socket is the one the environment names')

  // Long enough to come in many pieces, with a character of two bytes split across some of them.
  const text = `a${'ñ'.repeat(200_000)}`
  const long = await standIn(() => ({ ok: true, text }))
  assert.deepEqual((await run(['rooms', '--socket', long.socket])).answer(), { ok: true, text })
})

test('a request that reaches no connect says why: none there, none listening, or another failure as it came', async () => {
  const nobody = join(home, 'nadie.sock')
  const none = await run(['rooms', '--socket', nobody])
  assert.deepEqual([none.code, none.err], [1, `No hay ningún connect escuchando en ${nobody}\n`])

  // A socket left behind by a process that died: nobody listens there.
  const left = join(home, 'dejado.sock')
  const holder = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${JSON.stringify(left)})`])
  for (const end = Date.now() + 5_000; !existsSync(left) && Date.now() < end;) await sleep(20)
  holder.kill('SIGKILL')
  await new Promise(resolve => holder.once('exit', resolve))
  assert.equal((await run(['rooms', '--socket', left])).err, `No hay ningún connect escuchando en ${left}\n`)

  const notSocket = join(home, 'fichero')
  writeFileSync(notSocket, '')
  const other = await run(['rooms', '--socket', notSocket])
  assert.equal(other.code, 1)
  assert.match(other.err, /ENOTSOCK/)
  // Longer than any system takes, macOS's 253 bytes included: past a name's 255 only through a folder.
  const tooLong = await run(['rooms', '--socket', join(home, 'x'.repeat(200), `${'x'.repeat(120)}.sock`)])
  assert.match(tooLong.err, /^La ruta del socket es demasiado larga para este sistema: .*x\.sock\n$/)
})

test('serve opens this machine’s server, which status shows, a second serve refuses and stop closes', async () => {
  const port = await freePort()
  const serving = cli(['serve', '--name', 'Prueba', '--host', '127.0.0.1', '--port', String(port)])
  const opened = await serving.said()
  const server = (await serving.left) as Server
  servers.push(server)
  assert.deepEqual(opened, { ok: true, listening: `127.0.0.1:${port}`, title: 'Prueba', key: opened.key })
  assert.equal(savedKey('127.0.0.1', port), opened.key, 'its key is kept to connect from this machine')

  const status = (await run(['status'])).answer()
  assert.equal(status.running, true)
  assert.deepEqual(
    [status.listening, status.title, status.pid, status.key, status.machine],
    [`127.0.0.1:${port}`, 'Prueba', serving.fake.host.pid, opened.key, MACHINE],
  )
  assert.ok(Array.isArray(status.addresses))
  for (const argv of [
    ['serve', '--port', String(await freePort())],
    ['serve', '--background'],
  ]) {
    const again = await run(argv)
    assert.deepEqual([again.code, again.err], [1, `Ya hay un servidor en este equipo: escucha en 127.0.0.1:${port}\n`])
  }

  const signalled: [number, string][] = []
  const stopped = await run(['stop'], {
    kill: (pid, signal) => {
      signalled.push([pid, signal])
      serving.fake.kill('SIGTERM')
    },
  })
  assert.deepEqual(signalled, [[serving.fake.host.pid, 'SIGTERM']])
  assert.deepEqual([stopped.code, stopped.answer()], [0, { ok: true, stopped: port }])
  assert.deepEqual(serving.fake.exits, [0], 'the server asked to end ends well')
  assert.deepEqual((await run(['status'])).answer(), { ok: true, running: false, machine: MACHINE })
})

test('serve opens with the key it saved for its port, unless told to make a new one', async () => {
  const port = await freePort()
  const open = async (...more: string[]) => {
    const serving = cli(['serve', '--host', '127.0.0.1', '--port', String(port), ...more])
    const { key } = await serving.said()
    const server = (await serving.left) as Server
    serving.fake.kill('SIGTERM')
    await new Promise(resolve => server.close(resolve))
    return key
  }
  const first = await open()
  assert.equal(await open(), first, 'the same key, which its guests hold')
  const changed = await open('--new-key')
  assert.notEqual(changed, first)
  assert.equal(savedKey('127.0.0.1', port), changed, 'the new one kept')
})

test('stop says so when there is no server', async () => {
  const stopped = await run(['stop'])
  assert.deepEqual([stopped.code, stopped.err], [1, 'No hay ningún servidor abierto en este equipo\n'])
})

test('serve says why it did not open: a port in use, or the system’s reason; and exits with 1 once it ends', async () => {
  const taken = net.createServer().listen(0, '127.0.0.1')
  servers.push(taken)
  await new Promise(resolve => taken.once('listening', resolve))
  const port = (taken.address() as AddressInfo).port
  const inUse = cli(['serve', '--host', '127.0.0.1', '--port', String(port)])
  assert.deepEqual(await inUse.said(), { ok: false, error: `El puerto ${port} lo usa otro programa` })
  assert.deepEqual([inUse.exitCodes, inUse.fake.exits], [[1], []])

  const elsewhere = cli(['serve', '--host', '192.0.2.1', '--port', String(port)])
  assert.match(String((await elsewhere.said()).error), /EADDRNOTAVAIL/, 'an address that is not this machine’s')
  assert.deepEqual(elsewhere.exitCodes, [1])
  rmSync(SERVER, { force: true })
})

test('serve started by another process answers it on their channel, then lets it go', async () => {
  const sent: Value[] = []
  const serving = cli(['serve', '--host', '127.0.0.1', '--port', String(await freePort())], {
    send: (message, done) => {
      sent.push(message)
      done()
    },
  })
  servers.push((await serving.left) as Server)
  for (const end = Date.now() + 5_000; sent.length === 0 && Date.now() < end;) await sleep(10)
  assert.equal(sent[0]?.ok, true)
  assert.equal(sent[0]?.title, MACHINE, 'named after this machine unless told otherwise')
  assert.deepEqual([serving.disconnects, serving.out()], [[1], ''])
  serving.fake.kill('SIGTERM')
})

test('serve in the background starts itself apart and answers with what it says once it listens', async () => {
  const opening = cli(['serve', '--background', '--port', '4800', '--name', 'Lejos'])
  await opening.left
  const [started] = opening.started
  assert.ok(started)
  assert.deepEqual(
    started.args,
    ['serve', '--port', '4800', '--name', 'Lejos'],
    'the same serve, but in the foreground',
  )
  assert.equal(typeof started.output, 'number')
  assert.equal(existsSync(SERVER_LOG), true, 'its output goes to the server’s log')
  started.child.emit('message', { ok: true, listening: '0.0.0.0:4800' })
  assert.deepEqual(
    [await opening.ended, opening.answer(), started.unrefs],
    [0, { ok: true, listening: '0.0.0.0:4800' }, 1],
  )

  const refused = cli(['serve', '--background'])
  await refused.left
  refused.started[0]?.child.emit('message', { ok: false, error: 'no' })
  assert.deepEqual([await refused.ended, refused.answer()], [1, { ok: false, error: 'no' }])

  const died = cli(['serve', '--background', '--port', '4801'])
  await died.left
  died.started[0]?.child.emit('exit', 3)
  assert.equal(await died.ended, 1)
  assert.equal(died.err(), `El servidor del puerto 4801 terminó sin escuchar (3): mira ${SERVER_LOG}\n`)
})

test('connect links to the server at the address it is given, with the key saved for it, under its name', async () => {
  const port = await freePort()
  const serving = cli(['serve', '--host', '127.0.0.1', '--port', String(port)])
  await serving.said()
  servers.push((await serving.left) as Server)
  mkdirSync(join(home, 'socks'), { recursive: true, mode: 0o700 })
  const socket = join(home, 'socks', 'ana.sock')
  const ana = cli(['connect', `127.0.0.1:${port}`, '--name', 'Ana', '--socket', socket])
  const connected = await ana.said()
  assert.deepEqual(
    [connected.ev, connected.name, connected.server, connected.socket],
    ['connected', 'Ana', `127.0.0.1:${port}`, socket],
  )
  ana.fake.kill('SIGTERM')
  assert.equal(await ana.ended, 0)

  saveKey('127.0.0.1', port, newKey())
  const wrongKey = cli(['connect', `127.0.0.1:${port}`, '--socket', join(home, 'socks', 'otro.sock')])
  assert.equal(await wrongKey.ended, 1, 'a key that is not the server’s links to nothing')
  serving.fake.kill('SIGTERM')
})
