// Runs with `node --test tests/`: connect, as its own process, against a stand-in server that does as each test says.
import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import net, { type AddressInfo } from 'node:net'
import os, { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import tls from 'node:tls'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { networkAddresses, reachableAt } from '../cli/link.mts'
import { DEAD_AFTER, MAX_LINE, NAME_RULE, PROTOCOL } from '../cli/protocol.mts'
import { newKey, parseInvitation, parseKey, readLines, serverOptions, type Value, writeLine } from '../cli/wire.mts'

// What connect prints and answers, as these tests read it.
type Event = { ev: string; error: string; own: boolean; socket: string; from?: string }
type Answer = { ok: boolean; error: string; invitation: string }

const LINK = fileURLToPath(new URL('../cli/link.mts', import.meta.url))
const KEY = newKey()
// Short pings and waits, for the tests of a server or an inbox gone silent to take little.
const PING = 100
const WAIT = 300
// The network interfaces connect sees: a loopback, and one network with an address of each family.
const INTERFACES = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  en0: [
    { address: '192.0.2.5', family: 'IPv4', internal: false },
    { address: '2001:db8::5', family: 'IPv6', internal: false },
  ],
}
// The session these tests run in may have an inbox: connect gets the one each test gives it, or none.
const { CLAUDE_CODE_MESSAGING_SOCKET, CLAUDE_CODE_MESSAGING_TOKEN, ...withoutInbox } = process.env
const folder = mkdtempSync(join(tmpdir(), 'colab-'))
// What the tests started, ended here even when one fails halfway: a connect left running would keep the run open.
const children: ChildProcess[] = []
const servers: tls.Server[] = []
after(() => {
  for (const child of children) child.kill()
  for (const server of servers) server.close()
  rmSync(folder, { recursive: true, force: true })
})
let sockets = 0

/**
 * A server with the key that greets as one of this version, unless `hello` says otherwise, and answers each request
 * with what `answer(request, socket)` returns: nothing leaves it unanswered. `requests` holds what it was asked.
 */
async function standIn({
  hello = {},
  answer = () => ({}),
}: { hello?: Value; answer?: (request: Value, socket: tls.TLSSocket) => Value | undefined } = {}) {
  const requests: Value[] = []
  const server = tls.createServer(serverOptions(parseKey(KEY)), socket => {
    socket.unref() // an open link keeps no run alive
    readLines(socket, request => {
      requests.push(request)
      const reply =
        request.op === 'hello'
          ? { name: request.name, color: 2, title: 'Falso', version: PROTOCOL, rooms: [], ...hello }
          : answer(request, socket)
      if (reply !== undefined) writeLine(socket, { ev: 'reply', ref: request.ref, ok: true, ...reply })
    })
    socket.on('error', () => undefined)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  servers.push(server)
  return { requests, port: (server.address() as AddressInfo).port, close: () => server.close() }
}

/** connect as its own process, to `port` as `name`: `events` holds what it prints, `ended` resolves to its exit code. */
function connectTo(
  port: number,
  {
    name = 'Ana',
    socketPath = join(folder, `s${++sockets}.sock`),
    inbox = {} as Record<string, string>,
    interfaces = INTERFACES as object,
  } = {},
) {
  const options = JSON.stringify({
    host: '127.0.0.1',
    port,
    name,
    socketPath,
    pingEvery: PING,
    replyWait: WAIT,
    inboxWait: WAIT,
  })
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { connect } from ${JSON.stringify(LINK)}
os.networkInterfaces = () => (${JSON.stringify(interfaces)})
syncBuiltinESMExports()
connect({ ...${options}, key: Buffer.from(process.env.KEY, 'base64url') })`,
    ],
    { env: { ...withoutInbox, ...inbox, KEY } },
  )
  const events: Event[] = []
  let pending = ''
  let complaint = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    complaint += chunk
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    const whole = (pending + chunk).split('\n')
    pending = String(whole.pop())
    events.push(...whole.map(line => JSON.parse(line)))
  })
  const ended = new Promise(resolve => child.once('exit', resolve))
  const until = async (isIt: (event: Event) => boolean, ms = 5_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) {
      const found = events.find(isIt)
      if (found) return found
    }
    assert.fail(`no llegó el evento esperado; llegaron: ${JSON.stringify(events)}`)
  }
  children.push(child)
  return { child, events, ended, socketPath, until, stop: () => child.kill(), complaint: () => complaint }
}

/** One request to connect's local socket: its status and its JSON answer. */
function ask(socketPath: string, path: string, body: Value | string | undefined, method = 'POST') {
  return new Promise<{ status: number | undefined; type: string | undefined; answer: Answer }>((resolve, reject) => {
    const req = http.request({ socketPath, path, method }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        text += chunk
      })
      res.on('end', () =>
        resolve({ status: res.statusCode, type: res.headers['content-type'], answer: JSON.parse(text) }),
      )
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))
  })
}

test('only rooms, member and message come from the server: connected and the rest are connect’s own', async () => {
  const server = await standIn({
    answer: (request, socket) => {
      if (request.op !== 'rooms') return {}
      for (const ev of ['connected', 'disconnected', 'error', 'otro']) {
        writeLine(socket, { ev, name: 'Mallory', socket: '/tmp/evil.sock', error: 'falso' })
      }
      writeLine(socket, { ev: 'rooms', rooms: [] })
      writeLine(socket, { ev: 'member', name: 'Eva', action: 'join' })
      writeLine(socket, { ev: 'message', from: 'Ana', text: 'mío', own: false })
      writeLine(socket, { ev: 'message', from: 'Eva', text: 'suyo', own: true })
      writeLine(socket, { ev: 'reply', ref: 999, ok: true }) // to no request of its own
      return { rooms: [] }
    },
  })
  const ana = connectTo(server.port)
  await ana.until(event => event.ev === 'connected')

  assert.equal((await ask(ana.socketPath, '/rooms', {})).status, 200)
  await ana.until(event => event.ev === 'message' && event.from === 'Eva')
  const connected = {
    ev: 'connected',
    name: 'Ana',
    color: 2,
    server: `127.0.0.1:${server.port}`,
    title: 'Falso',
    socket: ana.socketPath,
    rooms: [],
  }
  assert.deepEqual(
    ana.events,
    [
      connected,
      { ev: 'rooms', rooms: [] },
      { ev: 'member', name: 'Eva', action: 'join' },
      { ev: 'message', from: 'Ana', text: 'mío', own: true },
      { ev: 'message', from: 'Eva', text: 'suyo', own: false },
    ],
    'own, by who sent it, whatever the server says; nothing forged got through',
  )
  assert.equal((await ask(ana.socketPath, '/rooms', {})).status, 200, 'a reply to nothing changes nothing')
  ana.stop()
  server.close()
})

test('the local socket takes the known requests alone, and passes on only their fields', async () => {
  const server = await standIn()
  const ana = connectTo(server.port)
  await ana.until(event => event.ev === 'connected')

  for (const [method, path] of [
    ['POST', '/hello'],
    ['POST', '/__proto__'],
    ['GET', '/rooms'],
  ] as const) {
    assert.deepEqual(await ask(ana.socketPath, path, undefined, method), {
      status: 404,
      type: 'application/json',
      answer: { ok: false, error: `Petición desconocida: ${method} ${path}` },
    })
  }
  for (const [body, error] of [
    ['{roto', 'El cuerpo no es JSON'],
    ...['null', '5', '[]', '"texto"'].map(body => [body, 'El cuerpo no es un objeto JSON']),
  ]) {
    assert.deepEqual(await ask(ana.socketPath, '/say', body), {
      status: 400,
      type: 'application/json',
      answer: { ok: false, error },
    })
  }

  // Each request passes on its own fields, and no other: neither what the server sets nor what the next one takes.
  // connect's pings go on meanwhile, at any moment: what the server was asked leaves them out.
  const asked = () => server.requests.filter(request => request.op !== 'ping')
  const extra = { from: 'Eva', color: 7, op: 'join', ref: 99, room: 'otra' }
  const every = { name: 'Sala', code: 'c'.repeat(24), text: 'hola', to: 'Eva', by: 'claude', busy: true, ...extra }
  for (const [op, passed] of [
    ['rooms', {}],
    ['create', { name: 'Sala', code: 'c'.repeat(24) }],
    ['join', { code: 'c'.repeat(24) }],
    ['leave', {}],
    ['say', { text: 'hola', to: 'Eva', by: 'claude' }],
    ['busy', { busy: true }],
  ] as const) {
    server.requests.length = 0
    assert.equal((await ask(ana.socketPath, `/${op}`, every)).status, 200, op)
    assert.equal(asked().length, 1, op)
    const { ref, ...fields } = asked()[0] ?? {}
    assert.deepEqual(fields, { ...passed, op }, op)
    assert.notEqual(ref, 99)
  }
  server.requests.length = 0
  const wide = '€😀'.repeat(10_000) // long enough to come in several chunks, which may split a character
  await ask(ana.socketPath, '/say', { text: wide })
  assert.equal(asked()[0]?.text, wide)
  assert.equal(ana.child.exitCode, null, 'and connect lives on')
  ana.stop()
  server.close()
})

test('the invitation holds the room connect is in, by the code the server gave', async () => {
  const code = 'k'.repeat(24)
  const made = 'm'.repeat(24)
  const server = await standIn({
    answer: request =>
      request.op === 'join'
        ? { code, label: '3', members: [] }
        : request.op === 'create'
          ? request.name === 'Llena'
            ? { ok: false, reason: 'rooms-full', max: 4 }
            : { code: made, label: '4', members: [] }
          : {},
  })
  const ana = connectTo(server.port)
  await ana.until(event => event.ev === 'connected')
  const invited = async () => (await ask(ana.socketPath, '/invite', {})).answer
  const nowhere = { ok: false, error: 'No estás en ninguna sala' }

  assert.deepEqual(await invited(), nowhere)
  await ask(ana.socketPath, '/join', { code })
  const given = await invited()
  assert.equal(given.ok, true)
  assert.deepEqual(parseInvitation(given.invitation), {
    addresses: ['192.0.2.5'],
    port: server.port,
    key: KEY,
    room: '3',
    code,
  })
  await ask(ana.socketPath, '/say', { text: 'hola' })
  await ask(ana.socketPath, '/rooms', {})
  assert.equal(parseInvitation((await invited()).invitation).code, code, 'what is said or asked leaves it where it was')

  await ask(ana.socketPath, '/create', { name: 'Llena' })
  assert.equal(parseInvitation((await invited()).invitation).code, code, 'a room refused leaves it where it was')
  await ask(ana.socketPath, '/leave', {})
  assert.deepEqual(await invited(), nowhere)
  await ask(ana.socketPath, '/create', {})
  assert.deepEqual(parseInvitation((await invited()).invitation).code, made)
  ana.stop()

  // A machine with no network address has nothing to invite to: it says so.
  const alone = connectTo(server.port, { interfaces: { lo0: INTERFACES.lo0 } })
  await alone.until(event => event.ev === 'connected')
  await ask(alone.socketPath, '/join', { code })
  assert.deepEqual((await ask(alone.socketPath, '/invite', {})).answer, {
    ok: false,
    error: 'Este equipo no tiene ninguna dirección de red',
  })
  alone.stop()
  server.close()
})

test('a server of another version is turned down', async () => {
  const server = await standIn({ hello: { version: PROTOCOL - 1 } })
  const ana = connectTo(server.port)

  assert.equal(
    (await ana.until(event => event.ev === 'error')).error,
    `127.0.0.1:${server.port} es un servidor de otra versión de claude-colab: ciérralo y ábrelo`,
  )
  assert.equal(await ana.ended, 1)
  assert.equal(
    ana.events.some(event => event.ev === 'connected'),
    false,
  )
  server.close()
})

test('a second connect on a socket in use is turned down, and the first keeps it', async () => {
  const server = await standIn()
  const first = connectTo(server.port, { name: 'Ana' })
  await first.until(event => event.ev === 'connected')
  const second = connectTo(server.port, { name: 'Eva', socketPath: first.socketPath })

  assert.match((await second.until(event => event.ev === 'error')).error, /Ya hay un connect escuchando/)
  assert.equal(await second.ended, 1)
  assert.equal((await ask(first.socketPath, '/rooms', {})).status, 200, 'the first still answers there')
  first.stop()
  assert.notEqual(await first.ended, undefined)

  const third = connectTo(server.port, { socketPath: first.socketPath })
  await third.until(event => event.ev === 'connected')
  third.stop()
  server.close()
})

test('a server gone silent ends the link, so that whoever started connect links again', async () => {
  const server = await standIn({ answer: request => (request.op === 'ping' ? undefined : {}) })
  const ana = connectTo(server.port)
  await ana.until(event => event.ev === 'connected')

  const gone = await ana.until(event => event.ev === 'disconnected', (DEAD_AFTER + 3) * PING + 2_000)
  assert.match(gone.error, /dejado de responder/)
  assert.equal(await ana.ended, 1)
  server.close()
})

test('a request the server leaves unanswered is answered as such, and the link lives on', async () => {
  const server = await standIn({ answer: request => (request.op === 'rooms' ? undefined : {}) })
  const ana = connectTo(server.port)
  await ana.until(event => event.ev === 'connected')

  assert.deepEqual((await ask(ana.socketPath, '/rooms', undefined)).answer, {
    ok: false,
    error: 'El servidor no ha respondido',
  })
  assert.equal((await ask(ana.socketPath, '/leave', undefined)).answer.ok, true, 'a body may be left out')
  ana.stop()
  server.close()
})

test('a request longer than a line is cut', async () => {
  const server = await standIn()
  const ana = connectTo(server.port)
  await ana.until(event => event.ev === 'connected')

  const longest = { text: 'x'.repeat(MAX_LINE - JSON.stringify({ text: '' }).length) }
  assert.equal(JSON.stringify(longest).length, MAX_LINE)
  assert.equal((await ask(ana.socketPath, '/say', longest)).status, 200, 'as long as a line may be')
  await assert.rejects(ask(ana.socketPath, '/say', { text: 'x'.repeat(MAX_LINE) }), /socket hang up|ECONNRESET|EPIPE/)
  assert.equal((await ask(ana.socketPath, '/rooms', {})).status, 200, 'and connect lives on')
  ana.stop()
  server.close()
})

test('a name the server refuses ends the link, put in words, telling a taken name apart', async () => {
  for (const [hello, error] of [
    [{ ok: false, reason: 'name-taken', name: 'Ana' }, 'Ya hay alguien conectado como Ana'],
    [{ ok: false, reason: 'bad-name' }, `Nombre no válido: ${NAME_RULE.es}`],
    // One this version has no words for, as from a later server, shows as it came.
    [{ ok: false, reason: 'name-sideways' }, 'name-sideways'],
  ] as const) {
    const server = await standIn({ hello })
    const ana = connectTo(server.port)

    const refused = await ana.until(event => event.ev === 'error')
    assert.deepEqual(refused, { ev: 'error', error, reason: hello.reason })
    ana.stop()
    server.close()
  }
})

test('a server that is not there ends the link with why', async () => {
  const free = await new Promise<number>(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
  const ana = connectTo(free)

  assert.deepEqual(await ana.until(event => event.ev === 'disconnected'), { ev: 'disconnected', error: 'ECONNREFUSED' })
  assert.equal(await ana.ended, 1)
})

test('a socket left by a connect that crashed is taken over', async () => {
  const server = await standIn()
  const crashed = connectTo(server.port)
  await crashed.until(event => event.ev === 'connected')
  crashed.child.kill('SIGKILL') // it has no time to remove its socket

  await crashed.ended
  const next = connectTo(server.port, { socketPath: crashed.socketPath })
  await next.until(event => event.ev === 'connected')
  next.stop()
  server.close()
})

test('others reach this machine’s own server at its network addresses, and any other at the one it was reached at', t => {
  const real = os.networkInterfaces
  os.networkInterfaces = () => INTERFACES as unknown as ReturnType<typeof real> // what networkAddresses reads
  syncBuiltinESMExports()
  t.after(() => {
    os.networkInterfaces = real
    syncBuiltinESMExports()
  })

  assert.deepEqual(networkAddresses(), ['192.0.2.5'], 'its IPv4 addresses on a network, not the loopback')
  for (const local of ['127.0.0.1', '127.0.1.1', 'localhost', '::1']) {
    assert.deepEqual(reachableAt(local), ['192.0.2.5'], local)
  }
  for (const other of ['192.0.2.9', 'equipo127.lan', 'localhost.lan', '::10']) {
    assert.deepEqual(reachableAt(other), [other], other)
  }
})

/** An inbox like a session's: `lines` holds each line posted to it; one that is `isMute` takes them and never ends. */
async function inboxAt(path: string, { isMute = false } = {}) {
  const lines: Value[] = []
  const inbox = net.createServer({ allowHalfOpen: true }, socket => {
    let pending = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      const whole = (pending + chunk).split('\n')
      pending = String(whole.pop())
      lines.push(...whole.map(line => JSON.parse(line)))
    })
    if (!isMute) socket.on('end', () => socket.end('{"ok":true}\n')) // what it answers is not read
  })
  await new Promise(resolve => inbox.listen(path, () => resolve(undefined)))
  inbox.unref()
  return { lines, close: () => inbox.close() }
}

test('a message for this session goes into its inbox, after the session’s token', async () => {
  const server = await standIn()
  const path = join(folder, 'buzon.sock')
  const inbox = await inboxAt(path)
  const message = { type: 'user', message: { role: 'user', content: 'hola' } }

  const ana = connectTo(server.port, {
    inbox: { CLAUDE_CODE_MESSAGING_SOCKET: path, CLAUDE_CODE_MESSAGING_TOKEN: 'secreto' },
  })
  await ana.until(event => event.ev === 'connected')
  assert.deepEqual((await ask(ana.socketPath, '/inbox', { text: 'hola' })).answer, { ok: true })
  assert.deepEqual(inbox.lines, [{ type: 'auth', token: 'secreto' }, message])
  assert.match((await ask(ana.socketPath, '/inbox', { text: '  ' })).answer.error, /Falta el texto/)
  ana.stop()

  inbox.lines.length = 0
  const bob = connectTo(server.port, { inbox: { CLAUDE_CODE_MESSAGING_SOCKET: path } })
  await bob.until(event => event.ev === 'connected')
  assert.deepEqual((await ask(bob.socketPath, '/inbox', { text: 'hola' })).answer, { ok: true })
  assert.deepEqual(inbox.lines, [message], 'with no token, the message alone')
  bob.stop()
  inbox.close()
  server.close()
})

test('a message for a session with no inbox, or one that does not take it, is not posted, and says why', async () => {
  const server = await standIn()
  const mutePath = join(folder, 'mudo.sock')
  const mute = await inboxAt(mutePath, { isMute: true })

  for (const [inbox, error] of [
    [{}, /no tiene buzón/],
    [{ CLAUDE_CODE_MESSAGING_SOCKET: join(folder, 'ninguno.sock') }, /ENOENT/],
    [{ CLAUDE_CODE_MESSAGING_SOCKET: mutePath }, /El buzón no ha respondido/],
  ] as const) {
    const ana = connectTo(server.port, { inbox })
    await ana.until(event => event.ev === 'connected')
    const { answer } = await ask(ana.socketPath, '/inbox', { text: 'hola' })
    assert.equal(answer.ok, false)
    assert.match(answer.error, error)
    ana.stop()
  }
  const ana = connectTo(server.port, { inbox: { CLAUDE_CODE_MESSAGING_SOCKET: mutePath } })
  await ana.until(event => event.ev === 'connected')
  for (const text of ['  ', 5, undefined]) {
    assert.deepEqual((await ask(ana.socketPath, '/inbox', { text })).answer, { ok: false, error: 'Falta el texto' })
  }
  ana.stop()
  mute.close()
  server.close()
})

test('asked to end, connect ends well and takes its socket with it, but not one that is no longer its own', async () => {
  const server = await standIn()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const ana = connectTo(server.port)
    await ana.until(event => event.ev === 'connected')
    ana.child.kill(signal)
    assert.equal(await ana.ended, 0, signal)
    assert.equal(existsSync(ana.socketPath), false, `${signal}: its socket goes`)
  }

  const ana = connectTo(server.port)
  await ana.until(event => event.ev === 'connected')
  rmSync(ana.socketPath)
  writeFileSync(ana.socketPath, 'de otro')
  ana.stop()
  assert.equal(await ana.ended, 0)
  assert.equal(readFileSync(ana.socketPath, 'utf8'), 'de otro', 'what took its place stays')

  const bob = connectTo(server.port)
  await bob.until(event => event.ev === 'connected')
  rmSync(bob.socketPath)
  bob.stop()
  assert.deepEqual([await bob.ended, bob.complaint()], [0, ''], 'or nothing took it: it ends as it would')
  server.close()
})

test('connect says why it cannot listen on its local socket', async () => {
  const server = await standIn()
  const open = join(folder, 'abierta')
  mkdirSync(open, { mode: 0o755 })
  chmodSync(open, 0o755)
  const tooLong = join(folder, `${'x'.repeat(120)}.sock`)

  // A socket held by a process that does not let this one in is someone else's: it is left alone.
  const held = join(folder, 'ajeno.sock')
  const holder = net.createServer().listen(held)
  holder.unref() // left open by a failure halfway, it keeps no run alive
  await new Promise(resolve => holder.once('listening', resolve))
  chmodSync(held, 0o000)

  for (const [socketPath, error] of [
    [join(open, 'colab.sock'), /tiene que ser solo tuyo/],
    [tooLong, /^La ruta del socket es demasiado larga para este sistema: .*x\.sock$/],
    [held, /Ya hay un connect escuchando/],
  ] as const) {
    const ana = connectTo(server.port, { socketPath })
    assert.match((await ana.until(event => event.ev === 'error')).error, error)
    assert.equal(await ana.ended, 1)
    assert.equal(ana.complaint(), '', 'and says it once, as an event')
  }
  holder.close()
  server.close()
})
