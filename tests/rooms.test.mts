// Runs with `node --test tests/`: the rules of a room server, with no sockets. Each link is a name, and what the rules
// deliver is kept per link; codes and the time are the test's own. `hub.test.mts` tests them through the real server.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Value } from '../plugins/colab/cli/protocol.mts'
import { type Client, type Result, roomsOf } from '../plugins/colab/cli/rooms.mts'

const AT = new Date('2026-11-20T10:00:00Z')

/** A server's rules, with `hello(name)` for a client and `ask(client, op, args)` for the reply to a request. */
function server(maxRooms?: number) {
  const delivered = new Map<string, Value[]>()
  let codes = 0
  const rules = roomsOf<string>({
    title: 'Prueba',
    maxRooms,
    deliver: (link, event) => delivered.set(link, [...(delivered.get(link) ?? []), event]),
    newCode: () => `code-${String(++codes).padStart(19, '0')}`,
    now: () => AT,
  })
  const hello = (name: string) => {
    const said = rules.hello(name, name)
    assert.ok('client' in said, `${name} is turned down`)
    return said.client
  }
  const ask = (me: Client<string>, op: unknown, args: Value = {}) => {
    let reply: Result | undefined
    rules.request(me, { ...args, op }, result => {
      reply = result
    })
    return reply as Result
  }
  /** What `link` was delivered since it was last read, and of which kind. */
  const take = (link: string, ev?: string) => {
    const events = delivered.get(link) ?? []
    delivered.delete(link)
    return ev === undefined ? events : events.filter(event => event.ev === ev)
  }
  return { rules, hello, ask, take }
}

test('a hello takes a name no one connected reads the same as, nor like someone’s Claude', () => {
  const { rules, hello } = server()
  const ana = hello('Ana')
  assert.deepEqual(rules.hello('Ana', 'x'), { refused: { reason: 'name-taken', name: 'Ana' } })
  assert.deepEqual(rules.hello('ＡＮＡ', 'x'), { refused: { reason: 'name-taken', name: 'ＡＮＡ' } })
  assert.deepEqual(rules.hello('Claude de Ana', 'x'), { refused: { reason: 'claude-name' } })
  for (const name of ['', ' Ana', 'Аna', 7])
    assert.deepEqual(rules.hello(name, 'x'), { refused: { reason: 'bad-name' } })
  assert.equal(hello('Claudette').name, 'Claudette', 'a name that only starts like Claude')
  rules.drop(ana)
  assert.equal(hello('ana').name, 'ana', 'a name is free once its connection is gone')
})

test('each hello says the server, its version and the lowest color no one connected has', () => {
  const { rules, hello } = server()
  const said = rules.hello('Ana', 'Ana')
  assert.ok('client' in said)
  assert.deepEqual(said.result, { name: 'Ana', color: 0, title: 'Prueba', version: 5, rooms: [] })
  const eva = hello('Eva')
  assert.equal(hello('Leo').color, 2)
  rules.drop(eva)
  assert.equal(hello('Mar').color, 1)
})

test('a room is made with the next number or a name, and its maker is in it; its list goes to everyone', () => {
  const { hello, ask, take } = server()
  const ana = hello('Ana')
  const eva = hello('Eva')
  const made = ask(ana, 'create')
  assert.deepEqual(made, { code: 'code-0000000000000000001', label: '1', members: ['Ana'] })
  assert.deepEqual(take('Ana'), [
    { ev: 'member', code: made.code, label: '1', name: 'Ana', action: 'join' },
    { ev: 'rooms', rooms: [{ ...made, busy: [] }] },
  ])
  assert.deepEqual(take('Eva'), [{ ev: 'rooms', rooms: [] }], 'one in no room sees none')
  ask(ana, 'leave')
  assert.equal(ask(eva, 'create', { name: 'Diseño' }).label, 'Diseño')
  assert.equal(ask(ana, 'create').label, '2', 'a named room takes no number')
})

test('a room is joined by its code alone, and its members are told', () => {
  const { hello, ask, take } = server()
  const ana = hello('Ana')
  const eva = hello('Eva')
  const { code } = ask(ana, 'create')
  take('Ana')
  assert.deepEqual(ask(eva, 'join', { code }), { code, label: '1', members: ['Ana', 'Eva'] })
  assert.deepEqual(take('Ana', 'member'), [{ ev: 'member', code, label: '1', name: 'Eva', action: 'join' }])
  assert.deepEqual(ask(eva, 'join', { code: 'code-0000000000000000009' }), { reason: 'room-gone' })
  assert.deepEqual(ask(eva, 'join', { code: 'short' }), { reason: 'room-gone' })
  assert.deepEqual(ask(eva, 'join'), { reason: 'room-gone' })
})

test('a connection is in one room at a time, and going into its own changes nothing', () => {
  const { hello, ask, take } = server()
  const ana = hello('Ana')
  const eva = hello('Eva')
  const first = ask(ana, 'create')
  const other = ask(eva, 'create')
  assert.deepEqual(ask(ana, 'join', { code: other.code }), { reason: 'elsewhere', label: '1' })
  assert.deepEqual(ask(ana, 'create'), { reason: 'elsewhere', label: '1' })
  take('Ana')
  assert.deepEqual(ask(ana, 'join', { code: first.code }), { ...first })
  assert.deepEqual(take('Ana', 'member'), [], 'no one is told again')
})

test('a room made again by its code keeps it; one made again first is joined', () => {
  const { hello, ask } = server()
  const ana = hello('Ana')
  const eva = hello('Eva')
  const code = 'remade-00000000000000000'
  assert.deepEqual(ask(ana, 'create', { code }), { code, label: '1', members: ['Ana'] })
  assert.deepEqual(ask(eva, 'create', { code }), { code, label: '1', members: ['Ana', 'Eva'] })
  assert.deepEqual(ask(eva, 'create', { code: 'short' }), { reason: 'bad-code' })
  assert.deepEqual(ask(eva, 'create', { name: ' x' }), { reason: 'bad-room-name' })
})

test('past its rooms, the oldest empty one makes way; with none empty, a new one is refused', () => {
  const { hello, ask } = server(2)
  const ana = hello('Ana')
  const eva = hello('Eva')
  const first = ask(ana, 'create')
  ask(ana, 'leave')
  const second = ask(eva, 'create')
  assert.equal(ask(ana, 'create').label, '3', 'the first, empty, made way')
  assert.deepEqual(ask(eva, 'join', { code: first.code }), { reason: 'room-gone' })
  assert.equal(ask(eva, 'join', { code: second.code }).label, '2', 'one with someone in stays')
  assert.deepEqual(ask(hello('Leo'), 'create'), { reason: 'rooms-full', max: 2 })
})

test('leaving tells the room, ends its busy, and is refused to one in no room', () => {
  const { hello, ask, take } = server()
  const ana = hello('Ana')
  const eva = hello('Eva')
  const { code } = ask(ana, 'create')
  ask(eva, 'join', { code })
  ask(eva, 'busy', { busy: true })
  assert.deepEqual(take('Ana', 'rooms').at(-1), {
    ev: 'rooms',
    rooms: [{ code, label: '1', members: ['Ana', 'Eva'], busy: ['Eva'] }],
  })
  assert.deepEqual(ask(eva, 'leave'), { code, label: '1' })
  assert.deepEqual(take('Ana', 'member'), [{ ev: 'member', code, label: '1', name: 'Eva', action: 'leave' }])
  assert.equal(eva.busy, false)
  for (const op of ['leave', 'busy', 'say']) assert.deepEqual(ask(eva, op, { text: 'x' }), { reason: 'not-in-room' })
})

test('what is said reaches its room alone, signed and stamped, to a member if told', () => {
  const { hello, ask, take } = server()
  const ana = hello('Ana')
  const eva = hello('Eva')
  const leo = hello('Leo')
  const { code } = ask(ana, 'create')
  ask(eva, 'join', { code })
  ask(leo, 'create')
  for (const link of ['Ana', 'Eva', 'Leo']) take(link)
  assert.deepEqual(ask(ana, 'say', { text: 'hola', to: 'Eva', by: 'claude' }), { id: 1 })
  const said = { ev: 'message', code, label: '1', id: 1, from: 'Ana', by: 'claude', color: 0, to: 'Eva' }
  for (const link of ['Ana', 'Eva']) {
    assert.deepEqual(take(link), [{ ...said, text: 'hola', at: AT.toISOString() }], link)
  }
  assert.deepEqual(take('Leo'), [], 'nor any other room')
  assert.equal(take('Eva', 'message').length, 0)
  ask(eva, 'say', { text: 'y tú', by: 'anyone' })
  assert.equal(take('Ana', 'message')[0]?.by, 'person', 'one not by a Claude is by the person')
})

test('what is said is text, not blank, not too long, and to a member of the room', () => {
  const { hello, ask } = server()
  const ana = hello('Ana')
  ask(ana, 'create')
  for (const text of [undefined, 7, ' \n']) assert.deepEqual(ask(ana, 'say', { text }), { reason: 'no-text' })
  assert.deepEqual(ask(ana, 'say', { text: 'x'.repeat(16 * 1024 + 1) }), { reason: 'text-too-long', max: 16 * 1024 })
  assert.deepEqual(ask(ana, 'say', { text: 'x'.repeat(16 * 1024) }), { id: 1 })
  assert.deepEqual(ask(ana, 'say', { text: 'x', to: 'Eva' }), { reason: 'not-member', to: 'Eva', label: '1' })
})

test('a request is answered before anyone hears of the rooms it changed, and only a change is pushed', () => {
  const { rules, hello, ask, take } = server()
  const ana = hello('Ana')
  const order: string[] = []
  const tracked = roomsOf<string>({
    title: 'Orden',
    deliver: (_, event) => order.push(String(event.ev)),
    newCode: () => 'ordered-0000000000000000',
    now: () => AT,
  })
  const said = tracked.hello('Ana', 'Ana')
  assert.ok('client' in said)
  tracked.request(said.client, { op: 'create' }, () => order.push('reply'))
  assert.deepEqual(order, ['member', 'reply', 'rooms'])

  for (const op of ['ping', 'rooms', 'say']) {
    take('Ana')
    ask(ana, op)
    assert.deepEqual(take('Ana', 'rooms'), [], op)
  }
  assert.deepEqual(ask(ana, 'rooms'), { rooms: [] })
  assert.deepEqual(ask(ana, 'create', { name: 7 }), { reason: 'malformed' })
  assert.deepEqual(ask(ana, 7), { reason: 'malformed' })
  for (const op of ['fly', 'constructor', 'hasOwnProperty'])
    assert.deepEqual(ask(ana, op), { reason: 'unknown-op', op })
  assert.deepEqual(
    [...rules.clients()].map(client => client.name),
    ['Ana'],
  )
})

test('a connection gone leaves its room, frees its name, and everyone hears of it', () => {
  const { rules, hello, ask, take } = server()
  const ana = hello('Ana')
  const eva = hello('Eva')
  const { code } = ask(ana, 'create')
  ask(eva, 'join', { code })
  take('Ana')
  rules.drop(eva)
  assert.deepEqual(
    take('Ana').map(event => event.ev),
    ['member', 'rooms'],
  )
  assert.deepEqual(
    [...rules.clients()].map(client => client.name),
    ['Ana'],
  )
  rules.drop(hello('Leo'))
  assert.deepEqual(take('Ana', 'rooms').length, 1, 'one in no room going is pushed too')
})
