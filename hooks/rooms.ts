import { isName } from '../cli/protocol.mts'
import type { Line, Place, Recent } from '../types'
import { isSameRoom } from './addresses.ts'
import { request } from './local.ts'
import {
  type Answer,
  complain,
  done,
  type Engine,
  failed,
  LOG_SIZE,
  readHosted,
  readLink,
  readRoom,
  readRooms,
  readWant,
  START_TIMEOUT,
  T,
  updateChatBack,
  updateLog,
  updateRecent,
  updateRoom,
  updateWant,
} from './state.ts'
import { isNumbered } from './strings.ts'

// How many rooms left behind the pane offers to go back to.
const RECENT_SIZE = 5

let back: Promise<void> | undefined
let settleBack: (() => void) | undefined

/** From a reload or a drop until the session is back in the room it was in: what is said meanwhile waits for it. */
export function expectBack() {
  back ??= new Promise(resolve => (settleBack = resolve))
}

/** Nothing waits any more to be back in a room: it is, or it will not be. */
export function settleBackNow() {
  settleBack?.()
  back = settleBack = undefined
}

/** Waits, a while at most, until the session is back in its room after a reload, a drop or an invitation. */
export async function backInRoom($: Engine) {
  if (back !== undefined) {
    await Promise.race([back, new Promise<void>(resolve => $.clock.after(START_TIMEOUT, () => resolve()))])
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
export async function rejoin($: Engine, place: Place) {
  const entered = await enterAgain($, place)

  if (!entered.ok) await complain($, entered.error ?? null)
  settleBackNow()
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
export async function join($: Engine, place: Place): Promise<Answer> {
  const here = await readRoom($)

  if (here?.code === place.code) return done(T.alreadyInside(here.label))
  const left = await leave($)

  if (!left.ok) return left
  const joined = (await request($, 'join', { code: place.code })) as Entered

  if (!joined.ok || !joined.code || !joined.label) return joined
  await enter($, { code: joined.code, label: joined.label })

  return done(T.inside(joined.label))
}

/** Makes a room and goes in: labelled by the server with a number unless named; under `code` when made again. */
export async function create($: Engine, name?: string, code?: string): Promise<Answer> {
  if (name !== undefined && !isName(name)) return failed(T.badRoomName)
  const left = await leave($)

  if (!left.ok) return left
  const created = (await request($, 'create', { name, code })) as Entered

  if (!created.ok || !created.code || !created.label) return created
  await enter($, { code: created.code, label: created.label })

  return done(T.created(created.label))
}

export async function leave($: Engine): Promise<Answer> {
  const here = await readRoom($)

  if (here === null) return done(T.wasInNoRoom)
  const wanted = await readWant($)
  const left = await request($, 'leave')

  // Still in it on the server, which keeps sending its messages: still in it here too.
  if (!left.ok) return left
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

/** Goes back into a room left before, made again by its code if the server started over meanwhile. */
export async function rejoinRecent($: Engine, left: Recent): Promise<Answer> {
  const entered = await enterAgain($, left)
  const own = await readHosted($)

  if (entered.ok) await updateRecent($, all => all.filter(one => !isSameRoom(one, left, own)))

  return entered
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
  const copied = await $.ui.copy({ text: invited.invitation, ...(surface === undefined ? {} : { surface }) })

  return copied.isCopied ? done(T.copied) : failed(copied.reason)
}
