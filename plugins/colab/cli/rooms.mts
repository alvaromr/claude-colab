// The rules of a room server, apart from its sockets: who is connected, the rooms, and what each request does. A
// connection first says hello with its name, unique on the server; then it creates, joins and leaves rooms and says
// things in the one it is in: one room at a time.
// A room is its code, random and secret: joining takes it, so the server's key gets one to the server, not into its
// rooms, and a connection sees only the room it is in. The room's `label`, a number, is only for people to read.
// A room lives as long as the server, empty too, so that those with its code can come back to it; past `maxRooms`, the
// oldest empty one makes way for a new one.
// Each connection gets a `color`, the lowest number no one connected has, so that clients can tell people apart.
// A refusal is a `reason` with the fields it needs, never text: each client words it in its own person's language.
// Pure: what it sends goes out through `deliver`, and new codes and the time come from whoever runs it.
import { isCode, isName, MAX_TEXT, PROTOCOL, type Refusal, type Value } from './protocol.ts'
// Rooms are not closed when they empty: this bounds the memory anyone with the key could fill by making them.
const MAX_ROOMS = 256
// Clients show what someone's Claude writes as «Claude de <name>»: no person may take a name that reads like that.
const CLAUDES_NAME = /(^|\s)claude\s+de(\s|$)/iu
/** A name as people read it, whatever its case or its letters' width. */
const readsAs = (name: string) => name.normalize('NFKC').toLowerCase()

type Room<L> = { code: string; label: string; members: Set<Client<L>> }
// `link`: how `deliver` reaches it. `busy`: whether its Claude is at work.
export type Client<L> = { name: string; color: number; link: L; room: Room<L> | null; busy: boolean }
// A request past hello, its text fields checked as text.
type Request = Value & { op: string; name?: string; to?: string; code?: string }
export type Result = Record<string, unknown> & { reason?: Refusal }

export type Rules<L> = {
  // Names the server, for those who connect to tell it from others.
  title: string
  maxRooms?: number | undefined
  deliver: (link: L, event: Value) => void
  newCode: () => string
  now: () => Date
}

const CHANGES_ROOMS = new Set(['create', 'join', 'leave', 'busy'])

export function roomsOf<L>({ title, maxRooms = MAX_ROOMS, deliver, newCode, now }: Rules<L>) {
  const clients = new Map<string, Client<L>>()
  const rooms = new Map<string, Room<L>>() // by code, oldest first
  let lastId = 0
  let lastNumber = 0

  const shown = (room: Room<L>) => ({ code: room.code, label: room.label })
  const roomList = (me: Client<L>) => {
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
    for (const client of clients.values()) deliver(client.link, { ev: 'rooms', rooms: roomList(client) })
  }
  const toRoom = (room: Room<L>, event: Value) => {
    for (const member of room.members) deliver(member.link, event)
  }
  // A connection is in one room at a time: it leaves the one it is in before going into another.
  const elsewhere = (me: Client<L>, code: string | undefined) =>
    me.room !== null && me.room.code !== code ? { reason: 'elsewhere' as const, label: me.room.label } : null
  // Room for one more: the oldest empty room goes when the server holds `maxRooms`.
  const makeRoom = () => {
    if (rooms.size < maxRooms) return true
    const empty = [...rooms.values()].find(room => room.members.size === 0)
    if (empty) rooms.delete(empty.code)
    return empty !== undefined
  }

  const OPS: Record<string, (me: Client<L>, request: Request) => Result> = {
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
        at: now().toISOString(),
      }
      toRoom(me.room, message)
      return { id: message.id }
    },
  }

  function join(me: Client<L>, code: string | undefined): Result {
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

  function leave(me: Client<L>, room: Room<L>): Result {
    room.members.delete(me)
    me.room = null
    me.busy = false
    toRoom(room, { ev: 'member', ...shown(room), name: me.name, action: 'leave' })
    return shown(room)
  }

  return {
    /** The hello of a connection as `name`: its client, or the refusal, after which the connection ends. */
    hello(name: unknown, link: L): { client: Client<L>; result: Result } | { refused: Result } {
      if (!isName(name)) return { refused: { reason: 'bad-name' } }
      if (CLAUDES_NAME.test(name)) return { refused: { reason: 'claude-name' } }
      // A taken name is told apart: one that dropped unseen holds it until the server notices, then frees it. One that
      // reads the same but for its case or its letters' width is taken too: it would pass for the other.
      if ([...clients.keys()].some(taken => readsAs(taken) === readsAs(name)))
        return { refused: { reason: 'name-taken', name } }
      const taken = new Set([...clients.values()].map(client => client.color))
      let color = 0
      while (taken.has(color)) color++
      const client: Client<L> = { name, color, link, room: null, busy: false }
      clients.set(name, client)
      return { client, result: { name, color, title, version: PROTOCOL, rooms: roomList(client) } }
    },

    /**
     * What a request past hello comes to; `answer` takes the reply before anyone hears of the rooms it changed, so the
     * one who asked learns its outcome first.
     */
    request(me: Client<L>, request: Value, answer: (result: Result) => void) {
      const { op, name, to, code } = request
      // Fields an operation reads as text are text, or absent: anything else would throw when put in an error.
      if (typeof op !== 'string' || [name, to, code].some(value => value !== undefined && typeof value !== 'string'))
        return answer({ reason: 'malformed' })
      const run = Object.hasOwn(OPS, op) ? OPS[op] : undefined
      const result: Result = run ? run(me, request as Request) : { reason: 'unknown-op', op }
      answer(result)
      if (!result.reason && CHANGES_ROOMS.has(op)) pushRooms()
    },

    /** A connection gone: out of its room, its name free, and everyone told. */
    drop(me: Client<L>) {
      if (me.room !== null) leave(me, me.room)
      clients.delete(me.name)
      pushRooms()
    },

    clients: () => clients.values(),
  }
}
