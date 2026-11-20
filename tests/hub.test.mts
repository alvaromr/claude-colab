// Runs with `node --test tests/`: the room server, over a real TLS link on a free port of this machine.
import assert from 'node:assert/strict'
import net, { type AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import tls from 'node:tls'
import { setTimeout as sleep } from 'node:timers/promises'
import { serve } from '../cli/hub.mts'
import { DEAD_AFTER, MAX_LINE, MAX_TEXT, PROTOCOL, type Value } from '../cli/protocol.mts'
import { clientOptions, newKey, parseKey, readLines, writeLine } from '../cli/wire.mts'

// What the server answers and pushes, as these tests read it.
type Shown = { code: string; label: string; members: string[]; busy: string[] }
// A refusal is its `reason`, with the fields its words need (`name`, `max`, `to`, `op`, and the room's `label`).
type Reply = Shown & {
  ok: boolean
  reason?: string
  name: string
  max: number
  to: string
  op: string
  rooms: Shown[]
  version: number
  color: number
  id: number
}
type Event = Shown & {
  ev: string
  name: string
  action: string
  from: string
  by: string
  color: number
  to?: string
  text: string
  rooms: Shown[]
}

const key = parseKey(newKey())
// How often connect would ping this test's server, how long it waits for a hello and how many rooms it holds: few and
// short, for the tests of their limits to take little.
const PING = 200
const HANDSHAKE_WAIT = 500
const HELLO_WAIT = 500
const ROOMS = 4
let server: tls.Server
let port: number

before(async () => {
  server = await new Promise(resolve => {
    const started = serve(
      {
        key,
        host: '127.0.0.1',
        port: 0,
        title: 'Prueba',
        pingEvery: PING,
        handshakeWait: HANDSHAKE_WAIT,
        helloWait: HELLO_WAIT,
        maxRooms: ROOMS,
        // Every link of these tests comes from loopback and stays until the end: the cap per address has its own test.
        maxPerAddress: 1_000,
      },
      () => resolve(started),
    )
  })
  port = (server.address() as AddressInfo).port
})
// Every link the tests open, ended here even when one fails halfway: the server closes only once they are.
const links: tls.TLSSocket[] = []
after(() => {
  for (const socket of links) socket.destroy()
  server.close()
})

/** A TLS link to the test's server with `withKey`, not yet greeted. */
function linked(withKey = key, at = port) {
  const socket = tls.connect({ ...clientOptions(withKey), host: '127.0.0.1', port: at })
  links.push(socket)
  return new Promise<tls.TLSSocket>((resolve, reject) =>
    socket.once('secureConnect', () => resolve(socket)).once('error', reject),
  )
}

/** Resolves once `socket` closes, with whether it did within `ms`. */
const closesWithin = (socket: net.Socket, ms: number) =>
  new Promise<boolean>(resolve => {
    if (socket.destroyed) return resolve(true)
    const timer = setTimeout(() => resolve(false), ms)
    socket.once('close', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })

/**
 * A connection that greets the server as `name`; `ask(op, args)` resolves to the server's reply, `events` holds what
 * it pushed. With `isGreeted` false the hello is left to the test, as `ask('hello', …)`; `at`, the port of a server
 * of the test's own.
 */
async function client(name: string, { isGreeted = true, at = port } = {}) {
  const socket = await linked(key, at)
  const pending = new Map<unknown, (reply: Reply) => void>()
  const events: Event[] = []
  let lastRef = 0
  readLines(socket, event => {
    if (event.ev === 'reply') pending.get(event.ref)?.(event as Reply)
    else events.push(event as Event)
  })
  const ask = (op: unknown, args: Value = {}) =>
    new Promise<Reply>(resolve => {
      const ref = ++lastRef
      pending.set(ref, resolve)
      writeLine(socket, { ...args, op, ref })
    })
  const hello = isGreeted ? await ask('hello', { name }) : undefined
  if (isGreeted) assert.equal(hello?.ok, true, String(hello?.reason))
  return { ask, hello, events, socket, close: () => socket.destroy() }
}

/** Who is in the room a client was last told of. */
const membersOf = (who: { events: Event[] }) =>
  who.events.findLast(event => event.ev === 'rooms')?.rooms?.[0]?.members ?? []
/** Waits until `isMet`, a turn of the event loop at a time: what a test waits on comes, and TURN bounds the wait. */
async function until(isMet: () => boolean) {
  while (!isMet()) await new Promise(resolve => setImmediate(resolve))
}
// For a test that waits with until: past it, what it waits on never came.
const TURN = { timeout: 5_000 }
/** Once each client's ping is answered, all the server pushed it before is in: it writes to each in order. */
const settled = (...whom: { ask: (op: unknown) => Promise<unknown> }[]) => Promise.all(whom.map(one => one.ask('ping')))

test('without the key no one gets past the handshake', async () => {
  await assert.rejects(linked(parseKey(newKey())), /DECRYPT_ERROR|BINDER|alert/i)
})

test('what is not TLS is cut at once', async () => {
  const raw = net.connect(port, '127.0.0.1')
  await new Promise(resolve => raw.once('connect', resolve))
  raw.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
  assert.equal(await closesWithin(raw, 2_000), true)
})

test('past the connections one address may hold at once, the next is cut before its handshake; one ended frees its place', async t => {
  const capped = await new Promise<tls.Server>(resolve => {
    const started = serve({ key, host: '127.0.0.1', port: 0, title: 'Tope', maxPerAddress: 2 }, () => resolve(started))
  })
  const opened: net.Socket[] = []
  // Ended even when the test fails halfway: the server closes only once they are.
  t.after(() => {
    for (const socket of opened) socket.destroy()
    capped.close()
  })
  const at = (capped.address() as AddressInfo).port
  const open = () => {
    const raw = net.connect(at, '127.0.0.1')
    opened.push(raw)
    return new Promise<net.Socket>(resolve => raw.once('connect', () => resolve(raw)))
  }
  const [first, second] = [await open(), await open()]
  const third = await open()
  assert.equal(await closesWithin(third, 2_000), true, 'the third is cut')
  assert.equal(await closesWithin(second, 300), false, 'the two before it stay')
  first.destroy()
  await closesWithin(first, 2_000)
  // Closed here before the server hears of it: under load, its place is freed a moment later.
  const held = () => new Promise<number>(resolve => capped.getConnections((_, count) => resolve(count)))
  while ((await held()) > 1) await new Promise(resolve => setImmediate(resolve))
  const again = await open()
  assert.equal(await closesWithin(again, 300), false, 'the place the first left is taken')
  assert.equal(await closesWithin(await open(), 2_000), true, 'and the one after it is cut again')
})

test('a connection must say hello first, and soon: anything else first, or nothing, cuts it', async t => {
  const early = await linked()
  writeLine(early, { op: 'rooms', ref: 1 })
  assert.equal(await closesWithin(early, 2_000), true, 'a request before hello')

  const mute = await linked()
  assert.equal(await closesWithin(mute, HELLO_WAIT / 2), false, 'it has its time to say it')
  assert.equal(await closesWithin(mute, HELLO_WAIT * 2), true, 'and not more')

  const greeted = await client('Saludado')
  const pings = setInterval(() => void greeted.ask('ping'), PING / 2)
  t.after(() => clearInterval(pings))
  assert.equal(await closesWithin(greeted.socket, HELLO_WAIT * 2), false, 'one that said it stays')
  greeted.close()
})

test('a connection that resets while the server writes to it is let go, and the server goes on', TURN, async () => {
  const ana = await client('AnaR')
  const made = await ana.ask('create')
  // A TLS socket cannot reset; the TCP one beneath it can.
  const raw = net.connect(port, '127.0.0.1')
  const gone = tls.connect({ ...clientOptions(key), socket: raw })
  links.push(gone)
  await new Promise(resolve => gone.once('secureConnect', resolve))
  writeLine(gone, { op: 'hello', name: 'Reseteo', ref: 1 })
  writeLine(gone, { op: 'join', code: made.code, ref: 2 })
  await until(() => membersOf(ana).includes('Reseteo'))
  raw.resetAndDestroy()
  for (let n = 0; n < 20; n++) await ana.ask('say', { text: 'x'.repeat(MAX_TEXT) })
  await until(() => !membersOf(ana).includes('Reseteo'))

  const again = await client('Reseteo')
  assert.equal(again.hello?.ok, true, 'its name is free again')
  assert.deepEqual((await ana.ask('rooms')).rooms[0]?.members, ['AnaR'])
  for (const one of [ana, again]) one.close()
})

test('a connection that never finishes the handshake is cut', async () => {
  const raw = net.connect(port, '127.0.0.1')
  await new Promise(resolve => raw.once('connect', resolve))
  assert.equal(await closesWithin(raw, HANDSHAKE_WAIT / 2), false, 'it has its time')
  assert.equal(await closesWithin(raw, HANDSHAKE_WAIT * 2), true, 'and not more')
})

test('each connection takes the lowest color no one connected has', async () => {
  const first = await client('Color1')
  const second = await client('Color2')
  const taken = [first.hello?.color, second.hello?.color]
  assert.notEqual(taken[0], taken[1])
  const freed = Math.min(Number(taken[0]), Number(taken[1]))
  ;(taken[0] === freed ? first : second).close()
  await sleep(100)

  const third = await client('Color3')
  assert.equal(third.hello?.color, freed)
  assert.equal(freed >= 0, true, 'colors count from 0')
  for (const one of [first, second, third]) one.close()
})

test('the members of a room are told its list as it changes, and only then', TURN, async () => {
  const ana = await client('AnaT')
  const eva = await client('EvaT')
  const listed = (who: { events: Event[] }) =>
    who.events.filter(event => event.ev === 'rooms').map(event => event.rooms)
  // The server answers Ana's ping after what it pushed her before: once answered, every list an act made is in.
  const after = async (act: Promise<unknown>) => {
    await act
    await ana.ask('ping')
  }

  const made = await ana.ask('create')
  await ana.ask('ping')
  assert.deepEqual(listed(ana).at(-1), [{ code: made.code, label: made.label, members: ['AnaT'], busy: [] }])
  await after(eva.ask('join', { code: made.code }))
  assert.deepEqual(listed(ana).at(-1)?.[0]?.members, ['AnaT', 'EvaT'])
  const told = listed(ana).length
  await after(eva.ask('say', { text: 'hola' }))
  await after(eva.ask('rooms'))
  await after(eva.ask('ping'))
  await after(eva.ask('join', { code: 'x'.repeat(24) }))
  assert.equal(listed(ana).length, told, 'saying, asking or a refused request change nothing')
  await after(eva.ask('leave'))
  assert.deepEqual(listed(ana).at(-1)?.[0]?.members, ['AnaT'])
  await after(eva.ask('join', { code: made.code }))
  eva.close()
  await until(() => listed(ana).at(-1)?.[0]?.members.length === 1) // once the server hears the close
  assert.deepEqual(listed(ana).at(-1)?.[0]?.members, ['AnaT'], 'one that drops is gone from the list')
  ana.close()
})

test('going into the room one is in changes nothing, and tells no one again', async () => {
  const ana = await client('AnaJ')
  const made = await ana.ask('create')
  const again = await ana.ask('join', { code: made.code })
  assert.deepEqual([again.ok, again.members], [true, ['AnaJ']])
  const remade = await ana.ask('create', { code: made.code })
  assert.deepEqual([remade.ok, remade.members], [true, ['AnaJ']])
  await settled(ana)
  assert.equal(ana.events.filter(event => event.ev === 'member').length, 1, 'one join, told once')
  ana.close()
})

test('a room refused is not made: the next one made takes the next number', async () => {
  const ana = await client('AnaN')
  const first = await ana.ask('create')
  assert.equal((await ana.ask('create')).ok, false)
  await ana.ask('leave')
  const next = await ana.ask('create')
  assert.equal(Number(next.label), Number(first.label) + 1)
  ana.close()
})

test('what is said gets its own number, one more each time, and text alone is said', async () => {
  const ana = await client('AnaI')
  await ana.ask('create')
  const [first, second] = [(await ana.ask('say', { text: 'uno' })).id, (await ana.ask('say', { text: 'dos' })).id]
  assert.equal(first > 0, true)
  assert.equal(second, first + 1)
  for (const text of [5, null, { a: 1 }]) {
    const { ok, reason } = await ana.ask('say', { text })
    assert.deepEqual({ ok, reason }, { ok: false, reason: 'no-text' })
  }
  assert.equal((await ana.ask('say', { text: 'sigo' })).ok, true, 'still serving')
  ana.close()
})

test('a line that is not a JSON object, or is longer than a line may be, cuts the connection', async () => {
  for (const line of ['no es json\n', '[1,2]\n', `{"op":"${'x'.repeat(MAX_LINE + 1)}`]) {
    const socket = await linked()
    socket.write(line)
    assert.equal(await closesWithin(socket, 2_000), true, line.slice(0, 20))
  }
})

test('a name is refused when it is not one, reads like someone’s Claude, or is taken', async () => {
  const eva = await client('EvaN')

  for (const [name, reason] of [
    ['', 'bad-name'],
    [{ toString: 1 }, 'bad-name'],
    ['a'.repeat(41), 'bad-name'],
    ['Claude de Bob', 'claude-name'],
    ['el claude  DE bob', 'claude-name'],
    ['Bob claude de', 'claude-name'],
    ['EvaN', 'name-taken'],
    // Taken too: one that reads the same but for its case, or its letters' width.
    ['evan', 'name-taken'],
    ['ＥｖａＮ', 'name-taken'],
    ['Bοb', 'bad-name'],
  ] as const) {
    const other = await client('', { isGreeted: false })
    const hello = await other.ask('hello', { name })
    assert.equal(hello.ok, false, JSON.stringify(name))
    assert.equal(hello.reason, reason, JSON.stringify(name))
    assert.equal(hello.name, reason === 'name-taken' ? name : undefined, 'a taken name is told')
    assert.equal(await closesWithin(other.socket, 2_000), true, 'and the connection ends')
  }
  // Lower-cased, not upper-cased: ß reads apart from ss.
  const strauss = await client('Strauss')
  for (const name of ['Claude', 'Claude del Mar', 'Ñandú 2', 'Strauß']) {
    const fine = await client(name)
    fine.close()
  }
  strauss.close()
  eva.close()
})

test('a request with fields of the wrong kind is refused, and the server goes on', async () => {
  const ana = await client('AnaM')

  for (const request of [
    ['join', { code: { toString: 1 } }],
    ['create', { name: { toString: 1 } }],
    ['say', { text: 'hola', to: { toString: 1 } }],
    [{ toString: 1 }, {}],
    [['say'], {}],
  ] as [unknown, Value][]) {
    const refused = await ana.ask(...request)
    assert.equal(refused.ok, false)
    assert.equal(refused.reason, 'malformed')
  }
  for (const op of ['__proto__', 'constructor', 'hello']) {
    const { ok, reason, op: told } = await ana.ask(op)
    assert.deepEqual({ ok, reason, op: told }, { ok: false, reason: 'unknown-op', op })
  }
  assert.equal((await ana.ask('create')).ok, true, 'still serving')
  ana.close()
})

test('what is said reaches its room alone, signed by the server as who said it', async () => {
  const ana = await client('AnaS')
  const eva = await client('EvaS')
  const outsider = await client('OtroS')
  const made = await ana.ask('create')
  await eva.ask('join', { code: made.code })
  await outsider.ask('create')

  const said = await eva.ask('say', { text: 'hola', by: { evil: 1 }, from: 'AnaS', color: 9 })
  assert.equal(said.ok, true)
  assert.equal((await eva.ask('say', { text: 'listo', by: 'claude', to: 'AnaS' })).ok, true)
  await settled(ana, eva, outsider)

  const heard = ana.events.filter(event => event.ev === 'message')
  const room = { code: made.code, label: made.label, from: 'EvaS', color: eva.hello?.color }
  assert.deepEqual(
    heard.map(({ from, by, color, to, text, code, label }) => ({ from, by, color, to, text, code, label })),
    [
      { ...room, by: 'person', to: undefined, text: 'hola' },
      { ...room, by: 'claude', to: 'AnaS', text: 'listo' },
    ],
  )
  assert.equal(
    outsider.events.some(event => event.code === made.code || JSON.stringify(event).includes(made.code)),
    false,
    'another room hears nothing of it, nor sees its code',
  )
  assert.deepEqual(
    ana.events.filter(event => event.ev === 'member').map(({ name, action }) => [name, action]),
    [
      ['AnaS', 'join'],
      ['EvaS', 'join'],
    ],
  )

  for (const [args, refusal] of [
    [{ text: '  ' }, { reason: 'no-text' }],
    [{ text: 'x'.repeat(MAX_TEXT + 1) }, { reason: 'text-too-long', max: MAX_TEXT }],
    [
      { text: 'hola', to: 'OtroS' },
      { reason: 'not-member', to: 'OtroS', label: made.label },
    ],
  ] as const) {
    const { ev, ref, ...refused } = (await eva.ask('say', args)) as Reply & Value
    assert.deepEqual(refused, { ok: false, ...refusal })
  }
  for (const client of [ana, eva, outsider]) client.close()
})

test('one that leaves, or drops, is gone from its room, and the others are told', TURN, async () => {
  const ana = await client('AnaL')
  const eva = await client('EvaL')
  const made = await ana.ask('create')
  await eva.ask('join', { code: made.code })

  eva.close()
  await until(() => ana.events.some(event => event.ev === 'member' && event.action === 'leave'))
  assert.deepEqual(
    ana.events.filter(event => event.ev === 'member').map(({ name, action }) => [name, action]),
    [
      ['AnaL', 'join'],
      ['EvaL', 'join'],
      ['EvaL', 'leave'],
    ],
  )
  assert.deepEqual((await ana.ask('rooms')).rooms[0]?.members, ['AnaL'])
  assert.match((await ana.ask('leave')).label, /^\d+$/)
  assert.equal((await ana.ask('leave')).reason, 'not-in-room')
  assert.equal((await ana.ask('say', { text: 'hola' })).reason, 'not-in-room')
  ana.close()
})

test('a connection that does not read what it is sent is dropped before it fills the server', TURN, async t => {
  // A server of its own, with the pings of any server: the one of the other tests would cut the silent one for its
  // pings, while the room's messages are still on their way, and hide whether the backlog cuts it.
  const patient = await new Promise<tls.Server>(resolve => {
    const started = serve({ key, host: '127.0.0.1', port: 0, title: 'Atasco' }, () => resolve(started))
  })
  const at = (patient.address() as AddressInfo).port
  const ana = await client('AnaB', { at })
  const mute = await client('MudoB', { at })
  t.after(() => {
    for (const one of [ana, mute]) one.close()
    patient.close()
  })
  const made = await ana.ask('create')
  await mute.ask('join', { code: made.code })
  mute.socket.pause()

  const text = 'x'.repeat(MAX_TEXT)
  for (let sent = 0; sent < 400; sent++) assert.equal((await ana.ask('say', { text })).ok, true)
  await until(() => membersOf(ana).length === 1)
  assert.deepEqual((await ana.ask('rooms')).rooms[0]?.members, ['AnaB'], 'the one that did not read is out')
})

test('a connection silent past its pings is dropped, and its name is free again', async t => {
  const silent = await client('Callado')
  const pinging = await client('Activo')
  const pings = setInterval(() => void pinging.ask('ping'), PING / 2)
  t.after(() => clearInterval(pings))

  assert.equal(await closesWithin(silent.socket, (DEAD_AFTER + 2) * PING), true, 'the silent one is cut')
  assert.equal(pinging.socket.destroyed, false, 'the one that pings stays')
  const again = await client('Callado')
  again.close()
  pinging.close()
})

test('the server says its version, for connect to turn down one of another', async () => {
  const ana = await client('Ana0')

  assert.equal(ana.hello?.version, PROTOCOL)
  ana.close()
})

test('a room is its code: only the code lets anyone in, and its number is only a label', async () => {
  const ana = await client('Ana')
  const eva = await client('Eva')

  const made = await ana.ask('create')
  assert.equal(made.ok, true)
  assert.match(made.label, /^\d+$/)

  for (const code of [undefined, 'x'.repeat(24), made.label]) {
    const refused = await eva.ask('join', { code })
    assert.equal(refused.ok, false)
    assert.equal(refused.reason, 'room-gone')
  }
  assert.deepEqual((await eva.ask('rooms')).rooms, [], 'the rooms one is not in are not seen')

  const joined = await eva.ask('join', { code: made.code })
  assert.equal(joined.ok, true)
  assert.deepEqual(joined.members, ['Ana', 'Eva'])
  assert.equal((await eva.ask('say', { text: 'hola' })).ok, true, 'said in the room one is in')

  ana.close()
  eva.close()
})

test('a connection is in one room at a time: joining or creating another is refused until it leaves', async () => {
  const ana = await client('Ana2')
  const eva = await client('Eva2')

  const other = await eva.ask('create')
  const mine = await ana.ask('create')

  const created = await ana.ask('create')
  assert.equal(created.ok, false)
  assert.deepEqual([created.reason, created.label], ['elsewhere', mine.label])

  const joined = await ana.ask('join', { code: other.code })
  assert.equal(joined.ok, false)
  assert.deepEqual([joined.reason, joined.label], ['elsewhere', mine.label])

  assert.equal((await ana.ask('leave')).ok, true)
  assert.equal((await ana.ask('join', { code: other.code })).ok, true)

  ana.close()
  eva.close()
})

test('a room made again under its code is that room: joined if someone made it first', async () => {
  const ana = await client('Ana3')
  const eva = await client('Eva3')
  const code = 'c'.repeat(24)

  assert.equal((await ana.ask('create', { code })).code, code)
  const again = await eva.ask('create', { code })
  assert.equal(again.ok, true)
  assert.deepEqual(again.members, ['Ana3', 'Eva3'])

  ana.close()
  eva.close()
})

test('a room left empty lives on: its code takes one back in, and the next room made takes another label', async () => {
  const ana = await client('Ana4')

  const first = await ana.ask('create')
  assert.equal((await ana.ask('leave')).ok, true) // the last one out
  const next = await ana.ask('create')
  assert.notEqual(next.label, first.label)
  assert.equal((await ana.ask('leave')).ok, true)

  const back = await ana.ask('join', { code: first.code })
  assert.equal(back.ok, true)
  assert.deepEqual(back.members, ['Ana4'])

  ana.close()
})

test('past the most rooms a server holds, the oldest empty one makes way', async () => {
  const ana = await client('Ana5')

  const oldest = await ana.ask('create')
  await ana.ask('leave')
  for (let made = 0; made < ROOMS; made++) {
    assert.equal((await ana.ask('create')).ok, true)
    await ana.ask('leave')
  }
  assert.equal((await ana.ask('join', { code: oldest.code })).ok, false, 'the oldest empty room went')

  ana.close()
})

test('when every room a server holds has someone in it, no other is made', async () => {
  const inside = await Promise.all(Array.from({ length: ROOMS }, (_, n) => client(`Lleno${n}`)))
  for (const one of inside) assert.equal((await one.ask('create')).ok, true)

  const late = await client('Tarde')
  const refused = await late.ask('create')
  assert.deepEqual([refused.reason, refused.max], ['rooms-full', ROOMS])
  for (const one of [...inside, late]) one.close()
})

test('a room is made with a name and a code of its kind only', async () => {
  const ana = await client('Ana6')

  assert.equal((await ana.ask('create', { name: 'x'.repeat(41) })).reason, 'bad-room-name')
  assert.equal((await ana.ask('create', { code: 'corto' })).reason, 'bad-code')
  assert.equal((await ana.ask('create', { name: 'Diseño' })).label, 'Diseño')
  ana.close()
})

test('whose Claude is at work goes with the room’s members, to them alone, until it ends or leaves', async () => {
  const ana = await client('AnaW')
  const eva = await client('EvaW')
  const outsider = await client('OtroW')
  const made = await ana.ask('create')
  await eva.ask('join', { code: made.code })

  assert.equal((await outsider.ask('busy', { busy: true })).reason, 'not-in-room')
  assert.equal((await eva.ask('busy', { busy: true })).ok, true)
  await settled(ana, eva, outsider)
  const lastRooms = (who: { events: Event[] }) => who.events.filter(event => event.ev === 'rooms').at(-1)?.rooms
  assert.deepEqual(lastRooms(ana)?.[0]?.busy, ['EvaW'])
  assert.deepEqual(lastRooms(outsider), [], 'another room sees nothing')

  await eva.ask('busy', { busy: 'sí' }) // anything but true is not at work
  assert.deepEqual((await ana.ask('rooms')).rooms[0]?.busy, [])
  await eva.ask('busy', { busy: true })
  await eva.ask('leave')
  await eva.ask('join', { code: made.code })
  assert.deepEqual((await ana.ask('rooms')).rooms[0]?.busy, [], 'leaving ends it')
  for (const one of [ana, eva, outsider]) one.close()
})
