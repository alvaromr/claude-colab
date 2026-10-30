import { DEAD_AFTER, DEFAULT_PORT, isName, PING_EVERY, type Refusal } from '../cli/protocol.mts'
import type { Author, Hosted, Known, Line, Link, Place, Recent, Room, Setup } from '../types'
import { checkServer, cli, openServer, runCli } from './server.ts'
import {
  type Answer,
  complain,
  done,
  type Engine,
  failed,
  isOwn,
  isSameServer,
  LOG_SIZE,
  MARK,
  readError,
  readHosted,
  readKnown,
  readLink,
  readRoom,
  readRooms,
  readSetup,
  readWant,
  T,
  unattended,
  updateChatBack,
  updateColors,
  updateKnown,
  updateLink,
  updateLog,
  updateRecent,
  updateRoom,
  updateRooms,
  updateSetup,
  updateWant,
} from './state.ts'
import { isNumbered } from './strings.ts'

// How long a tool waits for connect or serve to say it is up.
const START_TIMEOUT = 15_000
// The wait before linking again after a drop, doubling up to the last.
const RETRY_FIRST = 1_000
const RETRY_LAST = 30_000
// How long after a drop or a reload a taken name may still be this session's own link, not yet seen gone: past the
// server's pings and one more, it is someone else's.
const GHOST_WAIT = (DEAD_AFTER + 1) * PING_EVERY
// How many rooms left behind the pane offers to go back to.
const RECENT_SIZE = 5

// What could redraw the terminal or change how a text reads: C0 and C1 controls but tab and newline, bidirectional
// marks and line separators, and the invisible ones the model still reads (zero-width marks and tag characters).
// A message loses them on arrival.
const CONTROLS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{61C}\u{200B}\u{200E}\u{200F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2060}\u{2066}-\u{2069}\u{FEFF}\u{E0000}-\u{E007F}]/gu
// A message's text goes to the model quoted line by line under the mod's header, so no line of it passes for one.
const quoted = (text: string) =>
  text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')

// The room a message or a member event is of: its code, and the label people read.
type Message = Place & {
  id: number
  from: string
  by?: Author
  color?: number
  to?: string
  text: string
  own: boolean
}
type Event =
  | { ev: 'connected'; name: string; color: number; server: string; title: string; socket: string; rooms: Room[] }
  | { ev: 'rooms'; rooms: Room[] }
  | (Place & { ev: 'member'; name: string; action: 'join' | 'leave' })
  | ({ ev: 'message' } & Message)
  | { ev: 'error' | 'disconnected'; error?: string; reason?: Refusal }
type Stream = ReturnType<Engine['process']['spawn']>

// The connect process's output while it runs: returning it ends the process.
let child: Stream | undefined
// Settles the connect call that is waiting for the server's greeting.
let settleConnect: ((answer: Answer) => void) | undefined
// What the person sent from the pane and the server has not echoed yet: the echo goes into the inbox, for a row.
const fromPane: string[] = []
let back: Promise<void> | undefined
let settleBack: (() => void) | undefined
let linkRetry = RETRY_FIRST
// When the link dropped or the module reloaded, while it is being made again; undefined once linked or let go.
let droppedAt: number | undefined
// Why the server turned down the last connect's hello, if it did: the name, which breaks its rules or someone holds.
let refused: Refusal | undefined

const stop = (stream: Stream | undefined) => void stream?.return?.({ code: null, signal: 'SIGTERM' })
function withTimeout($: Engine, pending: Promise<Answer>, why: string) {
  return Promise.race([
    pending,
    new Promise<Answer>(resolve => $.clock.after(START_TIMEOUT, () => resolve(failed(why)))),
  ])
}

/** The person's words for what connect or TLS reported. */
const explained = (code: string) =>
  /DECRYPT_ERROR|BINDER/.test(code)
    ? T.keyMismatch
    : code === 'ECONNREFUSED'
      ? T.nobodyThere
      : /ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(code)
        ? T.unreachable
        : code

/** Calls `onLine` with each line a process prints, and returns what it printed on stderr. */
async function eachLine(stream: Stream, onLine: (line: string) => Promise<void>) {
  let pending = ''
  let complaint = ''

  try {
    for await (const { stream: from, text } of stream) {
      if (from === 'stderr') {
        complaint += text
        continue
      }
      const lines = (pending + text).split('\n')

      pending = lines.pop() ?? ''
      for (const line of lines) {
        try {
          await onLine(line)
        } catch (caught) {
          complaint += `${String(caught)}\n`
        }
      }
    }
  } catch (caught) {
    complaint += String(caught)
  }

  return complaint.trim()
}

/** One request to this session's connect process, over its local socket. */
async function request($: Engine, op: string, args: Record<string, unknown> = {}): Promise<Answer> {
  const current = await readLink($)

  if (current.status !== 'on') return failed(T.notLinked)
  try {
    const { text } = await $.http.fetch(`http://claude-colab/${op}`, {
      method: 'POST',
      socketPath: current.socket,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })

    return JSON.parse(text) as Answer
  } catch (caught) {
    return failed(String(caught))
  }
}

/** From a reload or a drop until the session is back in the room it was in: what is said meanwhile waits for it. */
function expectBack() {
  back ??= new Promise(resolve => (settleBack = resolve))
}

function settleBackNow() {
  settleBack?.()
  back = settleBack = undefined
}

export async function say($: Engine, text: string, by: Author, to?: string): Promise<Answer> {
  await backInRoom($)
  const here = await readRoom($)

  if (here === null) return failed(T.notInRoomToSay)
  // Said in the room connect is in: the request names none.
  const sent = await request($, 'say', { text, to, by })

  return sent.ok ? done(`${T.sent} «${here.label}»`) : sent
}

/** Tells the room whether this session's Claude is at work: any turn of its own, while it is in a room. */
export async function markBusy($: Engine, busy: boolean): Promise<Answer | undefined> {
  return (await readRoom($)) === null ? undefined : request($, 'busy', { busy })
}

/** How many people are in this session's room, as the server last said. */
async function peopleHere($: Engine) {
  const here = await readRoom($)

  return (await readRooms($)).find(one => one.code === here?.code)?.members.length ?? 0
}

/** A message this session sends, as its row draws it: the log gets it later, from the server's echo. */
export async function sentLine($: Engine, text: string, by: Author, to?: unknown): Promise<Line> {
  const current = await readLink($)
  const here = await readRoom($)
  const recipient = typeof to === 'string' && to && (await peopleHere($)) > 2 ? to : undefined

  return {
    n: 0,
    label: here?.label ?? '',
    code: '', // drawn in its own row, never looked up in the chat
    from: current.status === 'on' ? current.name : T.you,
    by,
    to: recipient,
    text,
    own: true,
  }
}

/** What the person writes in the pane's chat: the model is told, as it is of what they say with /colab. */
export async function sayFromPane($: Engine, text: string): Promise<Answer> {
  await updateChatBack($, () => 0) // back to the latest, where what is said shows
  fromPane.push(text)
  const sent = await say($, text, 'person')

  if (!sent.ok) fromPane.splice(fromPane.indexOf(text), 1)

  return sent
}

/**
 * Starts connect and settles once the server greets it, or connect ends. `target`, the room to go into once linked;
 * without it, the same server keeps the room to go back to, and another one starts with none.
 */
export async function connect($: Engine, server: string, name: string, target?: Place): Promise<Answer> {
  if (child !== undefined) return failed(T.alreadyLinked)
  if (!server) return failed(T.noServer)
  if (name && !isName(name)) return failed(T.badName)
  // The session's inbox, which connect posts the messages for this session into: without one, colab cannot work.
  const inbox = {
    CLAUDE_CODE_MESSAGING_SOCKET: (await $.env.get('CLAUDE_CODE_MESSAGING_SOCKET')) ?? '',
    CLAUDE_CODE_MESSAGING_TOKEN: (await $.env.get('CLAUDE_CODE_MESSAGING_TOKEN')) ?? '',
  }

  if (!inbox.CLAUDE_CODE_MESSAGING_SOCKET) {
    return failed(T.noInbox)
  }
  const socket = `${await $.env.get('HOME')}/.claude-colab/s-${Math.random().toString(36).slice(2, 10)}.sock`
  const as = name || (await $.process.run(['whoami'])).stdout.trim()
  const linked = new Promise<Answer>(resolve => (settleConnect = resolve))

  refused = undefined
  await updateSetup($, s => ({ ...s, name }))
  await updateWant($, w => ({ server, name, place: target ?? (w?.server === server ? w.place : null) }))
  await complain($, null)
  await updateLink($, (): Link => ({ status: 'connecting', server }))
  void follow($, ['node', cli($), 'connect', server, '--name', as, '--socket', socket], inbox)

  return withTimeout($, linked, T.serverLate)
}

/** Runs connect for as long as it lives, turning each line it prints into the pane's state or the conversation. */
async function follow($: Engine, argv: string[], inbox: Record<string, string>) {
  child = $.process.spawn({ argv, env: inbox })
  const complaint = await eachLine(child, async line => onEvent($, JSON.parse(line) as Event))

  child = undefined
  await updateRooms($, () => [])
  await updateRoom($, () => null)
  // The link may have ended with this machine's server, closed from another session.
  unattended($, T.serverUnknown, checkServer($))
  if (complaint) await complain($, complaint)
  // A name the server turned down is turned down again on every try, so the person picks another. A taken one alone
  // may be this session's own old link for a while after a drop, until the server lets it go.
  const isOwnOldLink =
    refused === 'name-taken' && droppedAt !== undefined && (await $.clock.now()) - droppedAt <= GHOST_WAIT

  if (refused !== undefined && !isOwnOldLink) {
    await updateWant($, () => null)
    droppedAt = undefined
    settleBackNow()
    if (refused === 'name-taken') await complain($, T.nameTaken)
  }
  settleConnect?.(failed((await readError($)) ?? T.linkClosed))
  settleConnect = undefined
  const wanted = await readWant($)

  if (wanted === null) {
    await updateLink($, () => ({ status: 'off' }))

    return
  }
  // Dropped, not left: try again, waiting longer each time.
  droppedAt ??= await $.clock.now()
  if (wanted.place !== null) expectBack()
  await updateLink($, (): Link => ({ status: 'connecting', server: wanted.server }))
  $.clock.after(linkRetry, () => void relink($))
  linkRetry = Math.min(linkRetry * 2, RETRY_LAST)
}

/** Makes the link the person asked for again, after a reload or a drop. */
async function relink($: Engine) {
  const wanted = await readWant($)

  if (wanted !== null && child === undefined) await connect($, wanted.server, wanted.name)
}

/** The link the person had asked for before the reload comes back; what is said meanwhile waits for it. */
export async function resume($: Engine) {
  const wanted = await readWant($)

  if (wanted !== null) {
    droppedAt = await $.clock.now() // the old link's process may not be seen gone yet
    if (wanted.place !== null) expectBack()
    $.clock.after(RETRY_FIRST, () => void relink($))
  }
}

/**
 * Goes into a room by its code: the one the person was in, was invited to or left. A server that started over no
 * longer has it, so it is made again under that code, which its invitations carry; one someone made again first is
 * joined. Its label may change then: the code is the room.
 */
async function enterAgain($: Engine, place: Place): Promise<Answer> {
  const joined = await join($, place)

  if (joined.ok) return joined
  const made = await create($, isNumbered(place.label) ? undefined : place.label, place.code)

  return made.ok ? made : failed(T.noReturn(place.label, String(made.error)))
}

/** Goes back into the room the person was in after a reload or a drop, and says so if it cannot. */
async function rejoin($: Engine, place: Place) {
  const back = await enterAgain($, place)

  if (!back.ok) await complain($, back.error ?? null)
  settleBackNow()
}

/** Waits, a while at most, until the session is back in its room after a reload, a drop or an invitation. */
async function backInRoom($: Engine) {
  if (back !== undefined) {
    await Promise.race([back, new Promise<void>(resolve => $.clock.after(START_TIMEOUT, () => resolve()))])
  }
}

/** Ends the link, as disconnect does, and waits until its connect process is gone. */
async function unlink($: Engine) {
  await disconnect($)
  for (let waited = 0; child !== undefined && waited < START_TIMEOUT; waited += 100) {
    await new Promise<void>(resolve => $.clock.after(100, () => resolve()))
  }
}

/**
 * Goes into the room of an invitation: its key saved by the CLI for this person, then linked to its server at the
 * first of its addresses that answers, unless this session is linked to it already.
 */
export async function acceptInvitation($: Engine, text: string, name: string): Promise<Answer> {
  if (!text.trim()) return failed(T.noInvitation)
  const accepted = await runCli($, ['accept'], text)

  if (!accepted.ok) return accepted
  const servers = accepted.servers as string[]
  const target: Place = { code: String(accepted.code), label: String(accepted.room) }
  const current = await readLink($)

  if (current.status === 'on' && servers.includes(current.server)) return join($, target)
  if (current.status !== 'off') await unlink($)
  // Why each address failed: the server may have been reached and said no, as to a name already taken.
  const reasons: string[] = []

  for (const server of servers) {
    expectBack()
    const linked = await connect($, server, name, target)

    if (linked.ok) {
      await backInRoom($)
      const here = await readRoom($)

      return here?.code === target.code ? done(T.inside(here.label)) : failed((await readError($)) ?? T.noEntry)
    }
    reasons.push(`${server}: ${linked.error}`)
    await unlink($)
  }

  return failed(T.invitationFailed(reasons.join('; ')))
}

async function onEvent($: Engine, event: Event) {
  switch (event.ev) {
    case 'connected':
      await updateLink($, (): Link => ({
        status: 'on',
        server: event.server,
        title: event.title,
        name: event.name,
        color: event.color,
        socket: event.socket,
      }))
      await updateRooms($, () => event.rooms)
      // This session's own color, for the boxes of what it sends.
      await updateColors($, all => ({ ...all, [event.name]: event.color }))
      await $.store.set('setup', await readSetup($))
      if (!isOwn(event.server, await readHosted($))) {
        const server: Known = { address: event.server, title: event.title }

        await updateKnown($, all => [server, ...all.filter(one => one.address !== server.address)])
        await $.store.set('servers', await readKnown($))
      }
      settleConnect?.(done(T.connected(event.title, event.server, event.name)))
      settleConnect = undefined
      linkRetry = RETRY_FIRST
      droppedAt = undefined
      {
        const again = await readWant($)

        if (again?.place) void rejoin($, again.place)
        else settleBackNow()
      }

      return
    case 'rooms':
      await updateRooms($, () => event.rooms)

      return
    case 'member': {
      const current = await readLink($)

      if (event.code === (await readRoom($))?.code && current.status === 'on' && event.name !== current.name) {
        $.ui.log((event.action === 'join' ? T.joined : T.left)(event.name, event.label))
      }

      return
    }
    case 'message':
      await show($, event)

      return
    case 'error':
    case 'disconnected':
      if (event.reason !== undefined) refused = event.reason
      if (event.error !== undefined) await complain($, explained(event.error))
  }
}

/**
 * Every message of the room, both ways and in the server's order, goes to the log the pane's chat draws. A received
 * one is given to the model as context; one for this session wakes it to judge.
 */
async function show($: Engine, message: Message) {
  const current = await readLink($)
  const people = (await readRooms($)).find(one => one.code === message.code)?.members.length ?? 0
  // In a room of two, whatever the other side says without a recipient is for this side.
  const isForMe =
    !message.own &&
    current.status === 'on' &&
    (message.to === current.name || (message.to === undefined && people === 2))
  const line: Line = {
    n: 0,
    code: message.code,
    label: message.label,
    from: message.from,
    by: message.by ?? 'person',
    to: people > 2 ? message.to : undefined,
    text: message.text.replace(CONTROLS, ''),
    own: message.own,
  }

  await updateColors($, all => ({ ...all, [message.from]: message.color ?? 0 }))
  await updateLog($, all => {
    line.n = (all.at(-1)?.n ?? 0) + 1

    return [...all, line].slice(-LOG_SIZE)
  })
  // What this session sent shows in the rows of the call or command that sent it; the pane's has none, so it goes
  // into the inbox: its row is drawn as the room's, and the model judges whether it concerns it.
  if (message.own) {
    const pending = fromPane.indexOf(message.text)

    if (pending === -1 || line.by !== 'person') return
    fromPane.splice(pending, 1)
    const said = `${MARK}#${line.n} · ${T.saidInPane(message.label)}\n\n${quoted(line.text)}`

    await post($, line, said)

    return
  }
  const told = T.received({
    from: message.from,
    isClaude: line.by === 'claude',
    isForMe,
    to: message.to,
    label: message.label,
  })
  const text = `${MARK}#${line.n} · ${told}\n\n${quoted(line.text)}`

  // One for this session goes into its inbox: the model wakes on it as on another session's message, and its row
  // is drawn as the room's. Any other is context alone, with no row: the pane shows it.
  if (isForMe) return post($, line, text)
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
}

/** Posts `text` into this session's inbox, which wakes the model; a failure shows in the pane. */
async function post($: Engine, line: Line, text: string) {
  const posted = await request($, 'inbox', { text })

  if (!posted.ok) await complain($, T.noNotice(line.n, String(posted.error)))
}

/** Notes the room this session is now in, to go back to it after a reload or a drop. */
async function enter($: Engine, place: Place) {
  await updateChatBack($, () => 0)
  // Back in a room this session was in: what was said meanwhile never reached it, and the chat says so, once until
  // the room says something again.
  await updateLog($, all => {
    const last = all.findLast(line => line.code === place.code)

    if (last === undefined || last.gap) return all
    const n = (all.at(-1)?.n ?? 0) + 1
    const gap: Line = { ...place, n, from: '', by: 'person', text: '', own: false, gap: true }

    return [...all, gap].slice(-LOG_SIZE)
  })
  await updateRoom($, () => place)
  await updateWant($, w => w && { ...w, place })
}

/** What the server answers on making or joining a room: the room, as it tells it. */
type Entered = Answer & Partial<Place>

/** Goes into the room of `place.code`, out of the one this session is in. */
async function join($: Engine, place: Place): Promise<Answer> {
  const here = await readRoom($)

  if (here?.code === place.code) return done(T.alreadyInside(here.label))
  if (here !== null) await leave($)
  const joined = (await request($, 'join', { code: place.code })) as Entered

  if (!joined.ok || !joined.code || !joined.label) return joined
  await enter($, { code: joined.code, label: joined.label })

  return done(T.inside(joined.label))
}

/** Makes a room and goes in: labelled by the server with a number unless named; under `code` when made again. */
export async function create($: Engine, name?: string, code?: string): Promise<Answer> {
  if (name !== undefined && !isName(name)) return failed(T.badRoomName)
  if ((await readRoom($)) !== null) await leave($)
  const created = (await request($, 'create', { name, code })) as Entered

  if (!created.ok || !created.code || !created.label) return created
  await enter($, { code: created.code, label: created.label })

  return done(T.created(created.label))
}

export async function leave($: Engine): Promise<Answer> {
  const here = await readRoom($)

  if (here === null) return done(T.wasInNoRoom)
  const wanted = await readWant($)

  await request($, 'leave')
  await updateRoom($, () => null)
  await updateWant($, w => w && { ...w, place: null })
  // Kept to go back to: the code is what lets anyone in, and the server shows no list of rooms.
  if (wanted !== null) {
    const left: Recent = { ...here, server: wanted.server }
    const own = await readHosted($)

    await updateRecent($, all => [left, ...all.filter(one => !isSameRoom(one, left, own))].slice(0, RECENT_SIZE))
  }

  return done(T.youLeft(here.label))
}

const isSameRoom = (one: Recent, other: Recent, own: Hosted | null) =>
  one.code === other.code && isSameServer(one.server, other.server, own)

/** Goes back into a room left before, made again by its code if the server started over meanwhile. */
export async function rejoinRecent($: Engine, left: Recent): Promise<Answer> {
  const back = await enterAgain($, left)
  const own = await readHosted($)

  if (back.ok) await updateRecent($, all => all.filter(one => !isSameRoom(one, left, own)))

  return back
}

export async function roomList($: Engine): Promise<Answer> {
  if ((await readLink($)).status !== 'on') return failed(T.notLinked)
  const here = await readRoom($)
  const mine = (await readRooms($)).find(one => one.code === here?.code)

  return done(mine === undefined ? T.inNoRoom : `${T.room(mine.label)}: ${mine.members.join(', ')}`)
}

/** The invitation to this session's room, from its connect process: it holds the server's key and the room's code. */
export async function invite($: Engine): Promise<Answer & { invitation?: string }> {
  return request($, 'invite')
}

/** Puts the invitation to this session's room on the clipboard of the surface the press came from. */
export async function copyInvitation(
  $: Engine,
  surface: Parameters<Engine['ui']['copy']>[0]['surface'],
): Promise<Answer> {
  const invited = await invite($)

  if (!invited.ok || !invited.invitation) return invited
  const copied = await $.ui.copy({ text: invited.invitation, surface })

  return copied.isCopied ? done(T.copied) : failed(copied.reason)
}

/** Ends the link for good: no reconnecting after it. */
export async function disconnect($: Engine): Promise<Answer> {
  const wanted = await readWant($)

  await updateWant($, () => null)
  droppedAt = undefined
  settleBackNow()
  if (child !== undefined) {
    stop(child)

    return done(T.disconnected)
  }
  await updateLink($, () => ({ status: 'off' }))

  return wanted === null ? failed(T.notConnected) : done(T.noMoreRelinking)
}

/**
 * Connects to this machine's room server, as to any other, opening it first when it is not open: to its view of
 * rooms, where the person makes one, one step at a time.
 */
export async function hostHere($: Engine, { name, title, port }: Setup): Promise<Answer> {
  await checkServer($)
  if ((await readHosted($)) === null) {
    const number = port ? Number(port) : DEFAULT_PORT

    if (!Number.isInteger(number) || number < 1 || number > 65535) return failed(T.badPort(port))
    const opened = await openServer($, '0.0.0.0', number, title)

    if (!opened.ok) return opened
  }

  return connect($, `127.0.0.1:${(await readHosted($))?.address.split(':').pop()}`, name)
}
