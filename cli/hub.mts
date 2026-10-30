// serve: the room server. A connection first says hello with its name, unique on the server; then it creates, joins
// and leaves rooms and says things in the one it is in: one room at a time.
// A room is its code, random and secret: joining takes it, so the server's key gets one to the server, not into its
// rooms, and a connection sees only the room it is in. The room's `label`, a number, is only for people to read.
// A room lives as long as the server, empty too, so that those with its code can come back to it; past MAX_ROOMS, the
// oldest empty one makes way for a new one.
// Every request carries a `ref` and gets one `reply` with it; changes are pushed to everyone as events.
// Each connection gets a `color`, the lowest number no one connected has, so that clients can tell people apart.
// A refusal is a `reason` with the fields it needs, never text: each client words it in its own person's language.
import type { AddressInfo } from 'node:net'
import tls from 'node:tls'
import { DEAD_AFTER, isCode, isName, MAX_TEXT, PING_EVERY, PROTOCOL, type Refusal } from './protocol.mts'
import { newCode, readLines, serverOptions, type Value, writeLine } from './wire.mts'

// Without the key no one gets past the handshake; these keep anyone from holding connections open on the way to it.
const HANDSHAKE_TIMEOUT = 5_000
const HELLO_TIMEOUT = 10_000
const MAX_CLIENTS = 64
// What may wait unread for one connection; one that does not read is dropped before it fills the server's memory.
const MAX_BACKLOG = 1024 * 1024
// Rooms are not closed when they empty: this bounds the memory anyone with the key could fill by making them.
export const MAX_ROOMS = 256
// Clients show what someone's Claude writes as «Claude de <name>»: no person may take a name that reads like that.
const CLAUDES_NAME = /(^|\s)claude\s+de(\s|$)/iu

type Room = { code: string; label: string; members: Set<Client> }
// `heard`: when it last sent anything. `busy`: whether its Claude is at work.
type Client = { name: string; color: number; socket: tls.TLSSocket; room: Room | null; heard: number; busy: boolean }
// A request past hello, its text fields checked as text.
type Request = Value & { op: string; name?: string; to?: string; code?: string }
type Result = Record<string, unknown> & { reason?: Refusal }

export type Serving = {
  key: Buffer
  host: string
  port: number
  // Names the server, for those who connect to tell it from others.
  title: string
  // How often connect pings.
  pingEvery?: number
  // How long a connection may take to finish the handshake, and then to say hello.
  handshakeWait?: number
  helloWait?: number
  maxRooms?: number
}

export function serve(
  {
    key,
    host,
    port,
    title,
    pingEvery = PING_EVERY,
    handshakeWait = HANDSHAKE_TIMEOUT,
    helloWait = HELLO_TIMEOUT,
    maxRooms = MAX_ROOMS,
  }: Serving,
  onListening: (at: AddressInfo) => void,
) {
  const clients = new Map<string, Client>()
  const rooms = new Map<string, Room>() // by code, oldest first
  let lastId = 0
  let lastNumber = 0

  const send = (socket: tls.TLSSocket, event: Value) =>
    // Stryker disable next-line EqualityOperator: one byte either way of the cap tells nothing apart
    socket.writableLength > MAX_BACKLOG ? socket.destroy() : writeLine(socket, event)
  const shown = (room: Room) => ({ code: room.code, label: room.label })
  const roomList = (me: Client) => {
    if (me.room === null) return []
    const members = [...me.room.members]
    return [
      {
        ...shown(me.room),
        members: members.map(one => one.name),
        busy: members.filter(one => one.busy).map(one => one.name),
      },
    ]
  }
  const pushRooms = () => {
    for (const client of clients.values()) send(client.socket, { ev: 'rooms', rooms: roomList(client) })
  }
  const toRoom = (room: Room, event: Value) => {
    for (const member of room.members) send(member.socket, event)
  }
  // A connection is in one room at a time: it leaves the one it is in before going into another.
  const elsewhere = (me: Client, code: string | undefined) =>
    me.room !== null && me.room.code !== code ? { reason: 'elsewhere' as const, label: me.room.label } : null
  // Room for one more: the oldest empty room goes when the server holds MAX_ROOMS.
  const makeRoom = () => {
    if (rooms.size < maxRooms) return true
    const empty = [...rooms.values()].find(room => room.members.size === 0)
    if (empty) rooms.delete(empty.code)
    return empty !== undefined
  }

  const OPS: Record<string, (me: Client, request: Request) => Result> = {
    ping: () => ({}),
    rooms: me => ({ rooms: roomList(me) }),
    // Labelled with the next number, or `name`. With a code, one that knew the room makes it again after the server
    // started over, under the code its invitations carry; one that someone made again first is joined.
    create(me, { name, code }) {
      if (name !== undefined && !isName(name)) return { reason: 'bad-room-name' }
      if (code !== undefined && !isCode(code)) return { reason: 'bad-code' }
      // Stryker disable next-line ConditionalExpression: for the type checker; no room has an undefined code
      if (code !== undefined && rooms.has(code)) return join(me, code)
      const refused = elsewhere(me, code)
      if (refused) return refused
      if (!makeRoom()) return { reason: 'rooms-full', max: maxRooms }
      const made = code ?? newCode()
      rooms.set(made, { code: made, label: name ?? String(++lastNumber), members: new Set() })
      return join(me, made)
    },
    join: (me, { code }) => join(me, code),
    leave(me) {
      if (me.room === null) return { reason: 'not-in-room' }
      return leave(me, me.room)
    },
    // Whether this connection's Claude is at work, for the room to see: told with its list of members.
    busy(me, { busy }) {
      if (me.room === null) return { reason: 'not-in-room' }
      me.busy = busy === true
      return {}
    },
    // Said in the room the connection is in. `by` says who wrote it at that connection: the person, or their Claude.
    say(me, { text, to, by }) {
      if (me.room === null) return { reason: 'not-in-room' }
      if (typeof text !== 'string' || !text.trim()) return { reason: 'no-text' }
      if (text.length > MAX_TEXT) return { reason: 'text-too-long', max: MAX_TEXT }
      if (to !== undefined && ![...me.room.members].some(member => member.name === to)) {
        return { reason: 'not-member', to, label: me.room.label }
      }
      const message = {
        ev: 'message',
        ...shown(me.room),
        id: ++lastId,
        from: me.name,
        by: by === 'claude' ? 'claude' : 'person',
        color: me.color,
        to, // left out of the line when undefined
        text,
        at: new Date().toISOString(),
      }
      toRoom(me.room, message)
      return { id: message.id }
    },
  }
  const CHANGES_ROOMS = new Set(['create', 'join', 'leave', 'busy'])

  function join(me: Client, code: string | undefined): Result {
    const found = isCode(code) ? rooms.get(code) : undefined
    if (!found) return { reason: 'room-gone' }
    const refused = elsewhere(me, code)
    if (refused) return refused
    if (!found.members.has(me)) {
      found.members.add(me)
      me.room = found
      toRoom(found, { ev: 'member', ...shown(found), name: me.name, action: 'join' })
    }
    return { ...shown(found), members: [...found.members].map(member => member.name) }
  }

  function leave(me: Client, room: Room): Result {
    room.members.delete(me)
    me.room = null
    me.busy = false
    toRoom(room, { ev: 'member', ...shown(room), name: me.name, action: 'leave' })
    return shown(room)
  }

  const server = tls.createServer({ ...serverOptions(key), handshakeTimeout: handshakeWait }, socket => {
    let me: Client | undefined
    const helloTimer = setTimeout(() => socket.destroy(), helloWait)
    const reply = (ref: unknown, result: Result) => send(socket, { ev: 'reply', ref, ok: !result.reason, ...result })

    readLines(socket, request => {
      const { op, ref } = request
      if (me === undefined) {
        if (op !== 'hello') return socket.destroy()
        clearTimeout(helloTimer)
        const refuse = (result: Result) => {
          reply(ref, result)
          socket.end()
        }
        const { name } = request
        if (!isName(name)) return refuse({ reason: 'bad-name' })
        if (CLAUDES_NAME.test(name)) return refuse({ reason: 'claude-name' })
        // A taken name is told apart: one that dropped unseen holds it until the server notices, then frees it.
        if (clients.has(name)) return refuse({ reason: 'name-taken', name })
        const taken = new Set([...clients.values()].map(client => client.color))
        let color = 0
        while (taken.has(color)) color++
        const client: Client = { name, color, socket, room: null, heard: Date.now(), busy: false }
        me = client
        clients.set(name, client)
        return reply(ref, { name, color, title, version: PROTOCOL, rooms: roomList(client) })
      }
      me.heard = Date.now()
      // Fields an operation reads as text are text, or absent: anything else would throw when put in an error.
      const { name, to, code } = request
      if (typeof op !== 'string' || [name, to, code].some(value => value !== undefined && typeof value !== 'string'))
        return reply(ref, { reason: 'malformed' })
      const run = Object.hasOwn(OPS, op) ? OPS[op] : undefined
      const result: Result = run ? run(me, request as Request) : { reason: 'unknown-op', op }
      reply(ref, result)
      if (!result.reason && CHANGES_ROOMS.has(op)) pushRooms()
    })

    socket.on('close', () => {
      // Stryker disable next-line CallExpression: frees the timer early; once it fires, it ends a socket already gone
      clearTimeout(helloTimer)
      if (me === undefined) return
      if (me.room !== null) leave(me, me.room)
      clients.delete(me.name)
      pushRooms()
    })
    // A dropped connection is handled on close, which follows. Without a listener, an error would end the server;
    // Node rarely raises one on a TLS socket the server holds, and no test makes it.
    // Stryker disable next-line all
    // biome-ignore lint/suspicious/noEmptyBlockStatements: handled on close
    socket.on('error', () => {})
  })
  // A failed handshake (wrong key, junk, timeout) reaches no room, and Node leaves its socket open: it is closed here.
  server.on('tlsClientError', (_err, socket) => socket.destroy())
  server.maxConnections = MAX_CLIENTS // counts connections still in the handshake too
  // One silent past its pings is gone, though TCP never said: it leaves its room, and its name is free again.
  const sweep = setInterval(() => {
    for (const client of clients.values()) {
      // Stryker disable next-line EqualityOperator: a millisecond either way of the limit tells nothing apart
      if (Date.now() - client.heard > DEAD_AFTER * pingEvery) client.socket.destroy()
    }
  }, pingEvery).unref()
  // Stryker disable next-line all: frees the sweep of a closed server, which, unref'd, holds nothing open anyway
  server.on('close', () => clearInterval(sweep))
  server.listen(port, host, () => onListening(server.address() as AddressInfo))
  return server
}
