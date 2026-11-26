import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isLoopback, LOOPBACK, type Language } from '../cli/protocol'
import type { Hosted, Known, Line, Link, Place, Recent, Room, Setup } from '../types'
import { addressesOf } from './addresses'
import type { Answer } from './linking'
import { TEXTS } from './strings'

export type Engine = EngineInterface

// Opens every row this mod adds to the conversation, so its drawing finds them.
export const MARK = '[colab] '
// How many messages the pane's chat keeps.
export const LOG_SIZE = 200
// How long a tool waits for connect or serve to say it is up, or for the session to be back in its room.
export const START_TIMEOUT = 15_000
// What the mod says, in the language of the session's locale, which start reads: until then, English.
export let T = TEXTS.en

/** Speaks `language` from now on. */
export function speak(language: Language) {
  T = TEXTS[language]
}

// Whether the session runs on native Windows, where colab does not: its CLI stands on POSIX. WSL is not it. Start
// reads it, as it reads the language: until then, not.
export let isNativeWindows = false

/** Runs on `platform`, as the engine names it, from now on. */
export function standOn(platform: string | undefined) {
  isNativeWindows = platform === 'windows'
}

// The engine reads and writes a value only where its atom is declared: each file of the mod reaches these through
// the functions below, the one place each is declared.
const link = atom({ plugin: 'colab', key: 'link' } as const, { status: 'off' })
const rooms = atom({ plugin: 'colab', key: 'rooms' } as const, [])
const room = atom({ plugin: 'colab', key: 'room' } as const, null)
const setup = atom({ plugin: 'colab', key: 'setup' } as const, { name: '', title: '', port: '' })
const error = atom({ plugin: 'colab', key: 'error' } as const, null)
// Tagged: a reload whose Hosted gained a field reads the old code's value as none, until the next status.
const hosted = atom({ plugin: 'colab', key: 'hosted' } as const, null, { shape: 'hosted-2' })
const known = atom({ plugin: 'colab', key: 'known' } as const, [])
const recent = atom({ plugin: 'colab', key: 'recent' } as const, [])
const help = atom({ plugin: 'colab', key: 'help' } as const, false)
const turnedDown = atom({ plugin: 'colab', key: 'turnedDown' } as const, {})
const chatWheel = atom({ plugin: 'colab', key: 'chatWheel' } as const, [])
const colors = atom({ plugin: 'colab', key: 'colors' } as const, {})
const want = atom({ plugin: 'colab', key: 'want' } as const, null)
const log = atom({ plugin: 'colab', key: 'log' } as const, [])

export function readLink($: Engine) {
  return read($, link)
}
export function updateLink($: Engine, change: (value: Link) => Link) {
  return update($, link, change)
}
export function readRooms($: Engine) {
  return read($, rooms)
}
export function updateRooms($: Engine, change: (value: Room[]) => Room[]) {
  return update($, rooms, change)
}
export function readRoom($: Engine) {
  return read($, room)
}
export function readSetup($: Engine) {
  return read($, setup)
}
export function updateSetup($: Engine, change: (value: Setup) => Setup) {
  return update($, setup, change)
}
export function readError($: Engine) {
  return read($, error)
}
export function readHosted($: Engine) {
  return read($, hosted)
}
export function updateHosted($: Engine, change: (value: Hosted | null) => Hosted | null) {
  return update($, hosted, change)
}
export function readKnown($: Engine) {
  return read($, known)
}
export function updateKnown($: Engine, change: (value: Known[]) => Known[]) {
  return update($, known, change)
}
export function readRecent($: Engine) {
  return read($, recent)
}
export function updateRecent($: Engine, change: (value: Recent[]) => Recent[]) {
  return update($, recent, change)
}
export function readHelp($: Engine) {
  return read($, help)
}
export function updateHelp($: Engine, change: (value: boolean) => boolean) {
  return update($, help, change)
}
export function readTurnedDown($: Engine) {
  return read($, turnedDown)
}
export function updateTurnedDown($: Engine, change: (value: Record<string, string>) => Record<string, string>) {
  return update($, turnedDown, change)
}
export function readChatWheel($: Engine) {
  return read($, chatWheel)
}
export function updateChatWheel($: Engine, change: (value: number[]) => number[]) {
  return update($, chatWheel, change)
}
export function readColors($: Engine) {
  return read($, colors)
}
export function updateColors($: Engine, change: (value: Record<string, number>) => Record<string, number>) {
  return update($, colors, change)
}
export function readWant($: Engine) {
  return read($, want)
}

// The link and the room the person asked for (`want`), and the room this session is in (`room`), change only here,
// by these steps: which room the link goes back to follows from them.

/** The person asks for a link to `server` as `name`: into `target`, or back into the room wanted on that server. */
export async function wantLink($: Engine, server: string, name: string, target?: Place) {
  await update($, want, w => ({ server, name, place: target ?? (w?.server === server ? w.place : null) }))
}
/** The person lets go of the link: nothing makes it again. */
export async function letGoLink($: Engine) {
  await update($, want, () => null)
}
/** This session went into `place`, which the link goes back to after a reload or a drop. */
export async function enteredRoom($: Engine, place: Place) {
  await update($, room, () => place)
  await update($, want, w => w && { ...w, place })
}
/** This session left its room, and the link goes back to none. */
export async function leftRoom($: Engine) {
  await update($, room, () => null)
  await update($, want, w => w && { ...w, place: null })
}
/** The link ended, or never was in this module: no room is seen, and the one wanted stays wanted. */
export async function unlinked($: Engine) {
  await update($, rooms, () => [])
  await update($, room, () => null)
}
export function readLog($: Engine) {
  return read($, log)
}
export function updateLog($: Engine, change: (value: Line[]) => Line[]) {
  return update($, log, change)
}

export { type Answer, done, failed } from './linking'
/** This machine's addresses, by the protocol's loopback: what every part tells servers and rooms apart by. */
export const { isOwn, isSameServer, localAt, withLeft, without } = addressesOf({ loopback: LOOPBACK, isLoopback })

/**
 * A failure of the link or of the inbox, which no press is waiting on: kept in sight on the status line until the
 * next connect clears it; `null` clears it.
 */
export async function complain($: Engine, why: string | null) {
  await update($, error, () => why)
  $.ui.status(why ?? undefined) // the engine heads it with the plugin's name
}

/** Work no press waits on: its failure, answered or thrown, is complained of instead of dropped. */
export function unattended($: Engine, what: string, pending: Promise<Answer | undefined>) {
  void complained($, what, pending)
}

/** As unattended, for work the caller awaits: settles once a failure of `pending` is complained of. */
export function complained($: Engine, what: string, pending: Promise<Answer | undefined>) {
  return pending.then(
    answer => (answer && !answer.ok ? complain($, `${what}: ${answer.error ?? T.failed}`) : undefined),
    (caught: unknown) => complain($, `${what}: ${String(caught)}`),
  )
}
