import type { Author, Line, Place } from '../types'
import { appended, cleaned, isForMe, lineOf, membersIn, quoted, shownTo, withHistory } from './chat'
import { request } from './local'
import { backInRoom } from './rooms'
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
  updateChatWheel,
  updateColors,
  updateLog,
} from './state'

/** A message of the room as connect hands it on: its room's code, and the label people read. */
export type Message = Place & {
  id: number
  at: string
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
  return membersIn(await readRooms($), (await readRoom($))?.code)
}

/** A message this session sends, as its row draws it: the log gets it later, from the server's echo. */
export async function sentLine($: Engine, text: string, by: Author, to?: unknown): Promise<Line> {
  const current = await readLink($)
  const here = await readRoom($)
  const recipient = shownTo(to, await peopleHere($))

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
  await updateChatWheel($, () => []) // back to the latest, where what is said shows
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
  const people = membersIn(await readRooms($), message.code)
  const isMine = isForMe(message, await readLink($), people)
  const line: Line = lineOf(message, people)

  await updateColors($, all => ({ ...all, [line.from]: message.color ?? 0 }))
  await updateLog($, all => {
    const logged = appended(all, line, LOG_SIZE)

    line.n = Number(logged.at(-1)?.n) // the number it is logged under, which its row and the model read

    return logged
  })
  // What this session sent shows in the rows of the call or command that sent it; the pane's has none, so it goes
  // into the inbox: its row is drawn as the room's, and the model judges whether it concerns it.
  if (message.own) {
    const pending = fromPane.indexOf(message.text)

    if (pending === -1 || line.by !== 'person') return
    fromPane.splice(pending, 1)
    const said = `${MARK}#${line.n} · ${T.saidInPane(line.label)}\n\n${quoted(line.text)}`

    await post($, line, said)

    return
  }
  const told = T.received({
    from: line.from,
    isClaude: line.by === 'claude',
    isForMe: isMine,
    to: message.to === undefined ? undefined : cleaned(message.to),
    label: line.label,
  })
  const text = `${MARK}#${line.n} · ${told}\n\n${quoted(line.text)}`

  // One for this session goes into its inbox: the model wakes on it as on another session's message, and its row
  // is drawn as the room's. Any other is context alone, with no row: the pane shows it.
  if (isMine) return post($, line, text)
  const added = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })

  if (added.deny !== undefined) await complain($, T.noContext(line.n, added.deny))
}

/**
 * What the server keeps of a room, which comes on going in: the chat gets what it lacks, and the model too, in one
 * block of context. It never wakes the model, and none of it is for this session: it is past, whoever it was for.
 */
export async function showHistory($: Engine, history: Place & { messages: Message[] }) {
  const people = membersIn(await readRooms($), history.code)
  const label = cleaned(history.label)
  let fresh: Line[] = []

  // A color the chat knows is newer than one of the history's.
  await updateColors($, all => ({
    ...Object.fromEntries(history.messages.map(message => [cleaned(message.from), message.color ?? 0])),
    ...all,
  }))
  await updateLog($, all => {
    const added = withHistory(
      all,
      history,
      history.messages.map(message => lineOf(message, people)),
      LOG_SIZE,
    )

    fresh = added.fresh

    return added.log
  })
  if (fresh.length === 0) return
  const told = fresh.map(line => {
    const from = T.pastAuthor({ from: line.from, isClaude: line.by === 'claude', own: line.own, to: line.to })

    return `#${line.n} · ${from}:\n${quoted(line.text)}`
  })
  const text = [`${MARK}${T.earlier(label)}`, ...told].join('\n\n')
  const added = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })

  if (added.deny !== undefined) await complain($, T.noEarlier(label, added.deny))
}

/** Posts `text` into this session's inbox, which wakes the model; a failure shows in the pane. */
async function post($: Engine, line: Line, text: string) {
  const posted = await request($, 'inbox', { text })

  if (!posted.ok) await complain($, T.noNotice(line.n, String(posted.error)))
}
