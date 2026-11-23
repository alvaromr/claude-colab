import { ANY_HOST, DEFAULT_PORT, isName, isPort, type Refusal } from '../cli/protocol.mts'
import type { Known, Link, Place, Room, Setup } from '../types'
import { isOwn, localAt, remembered } from './addresses.ts'
import { failureOf, isLetGo, isOthersMove, nextWait, RETRY_FIRST, splitLines } from './linking.ts'
import { type Message, show } from './messages.ts'
import { backInRoom, expectBack, join, rejoin, settleBackNow } from './rooms.ts'
import { checkServer, cli, openServer, runCli } from './server.ts'
import {
  type Answer,
  complain,
  done,
  type Engine,
  failed,
  letGoLink,
  readError,
  readHosted,
  readKnown,
  readLink,
  readRoom,
  readSetup,
  readWant,
  START_TIMEOUT,
  T,
  unattended,
  unlinked,
  updateColors,
  updateKnown,
  updateLink,
  updateRooms,
  updateSetup,
  wantLink,
} from './state.ts'

type Event =
  | { ev: 'connected'; name: string; color: number; server: string; title: string; socket: string; rooms: Room[] }
  | { ev: 'rooms'; rooms: Room[] }
  | (Place & { ev: 'member'; name: string; action: 'join' | 'leave' })
  | ({ ev: 'message' } & Message)
  | { ev: 'error' | 'disconnected'; error?: string; reason?: Refusal }
type Stream = ReturnType<Engine['process']['spawn']>
// The session's inbox, as connect's environment carries it.
type Inbox = Record<string, string>

// The connect process's output while it runs: returning it ends the process.
let child: Stream | undefined
// Settles the connect call that is waiting for the server's greeting.
let settleConnect: ((answer: Answer) => void) | undefined
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
function explained(code: string) {
  const kind = failureOf(code)

  return kind === undefined ? code : T[kind]
}

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
      const { lines, rest } = splitLines(pending, text)

      pending = rest
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

/**
 * Starts connect and settles once the server greets it, or connect ends. `target`, the room to go into once linked;
 * without it, the same server keeps the room to go back to, and another one starts with none.
 */
export async function connect($: Engine, server: string, name: string, target?: Place): Promise<Answer> {
  const ready = await readyToConnect($, server, name)

  return ready.inbox === undefined ? ready : launch($, server, name, ready.inbox, target)
}

/** Why connect cannot start for `server` and `name`, or the session's inbox, which it starts with. */
async function readyToConnect($: Engine, server: string, name: string): Promise<Answer & { inbox?: Inbox }> {
  if (child !== undefined) return failed(T.alreadyLinked)
  if (!server) return failed(T.noServer)
  if (name && !isName(name)) return failed(T.badName)
  // The session's inbox, which connect posts the messages for this session into: without one, colab cannot work.
  const inbox = {
    CLAUDE_CODE_MESSAGING_SOCKET: (await $.env.get('CLAUDE_CODE_MESSAGING_SOCKET')) ?? '',
    CLAUDE_CODE_MESSAGING_TOKEN: (await $.env.get('CLAUDE_CODE_MESSAGING_TOKEN')) ?? '',
  }

  return inbox.CLAUDE_CODE_MESSAGING_SOCKET ? { ok: true, inbox } : failed(T.noInbox)
}

/** Starts connect, which `readyToConnect` cleared, as `connect` says. */
async function launch($: Engine, server: string, name: string, inbox: Inbox, target?: Place): Promise<Answer> {
  const socket = `${await $.env.get('HOME')}/.claude-colab/s-${Math.random().toString(36).slice(2, 10)}.sock`
  const as = name || (await $.process.run(['whoami'])).stdout.trim()
  const linked = new Promise<Answer>(resolve => (settleConnect = resolve))

  refused = undefined
  await updateSetup($, s => ({ ...s, name }))
  await wantLink($, server, name, target)
  await complain($, null)
  await updateLink($, (): Link => ({ status: 'connecting', server }))
  void follow($, ['node', cli($), 'connect', server, '--name', as, '--socket', socket], inbox)

  return withTimeout($, linked, T.serverLate)
}

/** Runs connect for as long as it lives, turning each line it prints into the pane's state or the conversation. */
async function follow($: Engine, argv: string[], inbox: Inbox) {
  child = $.process.spawn({ argv, env: inbox })
  const complaint = await eachLine(child, async line => onEvent($, JSON.parse(line) as Event))

  child = undefined
  await unlinked($)
  // The link may have ended with this machine's server, closed from another session.
  unattended($, T.serverUnknown, checkServer($))
  if (complaint) await complain($, complaint)
  if (isLetGo(refused, droppedAt, await $.clock.now())) {
    await letGo($)
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
  $.clock.after(linkRetry, () => unattended($, T.noRelink, relink($)))
  linkRetry = nextWait(linkRetry)
}

/** Lets go of the link the person asked for: nothing makes it again, and nothing waits any more to be back in a room. */
async function letGo($: Engine) {
  await letGoLink($)
  droppedAt = undefined
  settleBackNow()
}

/**
 * Makes the link the person asked for again, after a reload or a drop. One connect cannot even start, such as with no
 * inbox, would fail the same on every try: it is let go, as a refused name is, and its answer says why. How a try
 * that started ends, follow tells: launch answers it for a press that waits on it, and none does here.
 */
async function relink($: Engine): Promise<Answer | undefined> {
  const wanted = await readWant($)

  if (wanted === null || child !== undefined) return undefined
  const ready = await readyToConnect($, wanted.server, wanted.name)

  if (ready.inbox === undefined) {
    await letGo($)
    await updateLink($, () => ({ status: 'off' }))

    return ready
  }
  await launch($, wanted.server, wanted.name, ready.inbox)

  return undefined
}

/** The link the person had asked for before the reload comes back; what is said meanwhile waits for it. */
export async function resume($: Engine) {
  const wanted = await readWant($)

  if (wanted !== null) {
    droppedAt = await $.clock.now() // the old link's process may not be seen gone yet
    if (wanted.place !== null) expectBack()
    $.clock.after(RETRY_FIRST, () => unattended($, T.noRelink, relink($)))
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

        await updateKnown($, all => remembered(all, server))
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
      if (isOthersMove(event, await readRoom($), await readLink($))) {
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

/** Ends the link for good: no reconnecting after it. */
export async function disconnect($: Engine): Promise<Answer> {
  const wanted = await readWant($)

  await letGo($)
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
  const checked = await checkServer($)

  // Unknown, it may be open already: one opened on a guess may take its port.
  if (!checked.ok) return checked
  if ((await readHosted($)) === null) {
    const number = port ? Number(port) : DEFAULT_PORT

    if (!isPort(number)) return failed(T.badPort(port))
    const opened = await openServer($, ANY_HOST, number, title)

    if (!opened.ok) return opened
  }

  return connect($, localAt(String((await readHosted($))?.address)), name)
}
