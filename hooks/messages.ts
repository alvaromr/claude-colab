import type { Author, Line, Place } from '../types'
import { cleaned, quoted } from './chat.ts'
import { request } from './local.ts'
import { backInRoom } from './rooms.ts'
import {
  type Answer,
  complain,
  done,
  type Engine,
  failed,
  LOG_SIZE,
  MARK,
  readLink,
  readRoom,
  readRooms,
  T,
  updateChatBack,
  updateColors,
  updateLog,
} from './state.ts'

/** A message of the room as connect hands it on: its room's code, and the label people read. */
export type Message = Place & {
  id: number
  from: string
  by?: Author
  color?: number
  to?: string
  text: string
  own: boolean
}

// What the person sent from the pane and the server has not echoed yet: the echo goes into the inbox, for a row.
const fromPane: string[] = []

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
    from: current.status === 'on' ? current.name : '', // drawn after the link ended: the name it went under is gone
    by,
    ...(recipient === undefined ? {} : { to: recipient }),
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
 * Every message of the room, both ways and in the server's order, goes to the log the pane's chat draws. A received
 * one is given to the model as context; one for this session wakes it to judge.
 */
export async function show($: Engine, message: Message) {
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
    ...(people > 2 && message.to !== undefined ? { to: message.to } : {}),
    text: cleaned(message.text),
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
  const appended = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })

  if (appended.deny !== undefined) await complain($, T.noContext(line.n, appended.deny))
}

/** Posts `text` into this session's inbox, which wakes the model; a failure shows in the pane. */
async function post($: Engine, line: Line, text: string) {
  const posted = await request($, 'inbox', { text })

  if (!posted.ok) await complain($, T.noNotice(line.n, String(posted.error)))
}
