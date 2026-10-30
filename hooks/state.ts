import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Language } from '../cli/protocol.mts'
import type { Hosted, Known, Line, Link, Place, Recent, Room, Setup, Want } from '../types'
import { TEXTS } from './strings.ts'

export type Engine = EngineInterface

// Opens every row this mod adds to the conversation, so its drawing finds them.
export const MARK = '[colab] '
// How many messages the pane's chat keeps.
export const LOG_SIZE = 200
// What the mod says, in the language of the session's locale, which start reads: until then, English.
export let T = TEXTS.en

/** Speaks `language` from now on. */
export function speak(language: Language) {
  T = TEXTS[language]
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
const chatBack = atom({ plugin: 'colab', key: 'chatBack' } as const, 0)
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
export function updateRoom($: Engine, change: (value: Place | null) => Place | null) {
  return update($, room, change)
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
export function readChatBack($: Engine) {
  return read($, chatBack)
}
export function updateChatBack($: Engine, change: (value: number) => number) {
  return update($, chatBack, change)
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
export function updateWant($: Engine, change: (value: Want | null) => Want | null) {
  return update($, want, change)
}
export function readLog($: Engine) {
  return read($, log)
}
export function updateLog($: Engine, change: (value: Line[]) => Line[]) {
  return update($, log, change)
}

// This machine, as an address: by loopback, or by one of its network addresses, which its own server's invitations
// carry. Its own server is reached there, and is no server of others to remember.
export const isOwn = (server: string, own: Hosted | null) =>
  /^(127\.|localhost(:|$)|\[::1\]|::1$)/.test(server) ||
  (own?.addresses.includes(server.slice(0, server.lastIndexOf(':'))) ?? false)
const portOf = (server: string) => server.slice(server.lastIndexOf(':') + 1)
/** Whether two addresses reach one server: the same address, or two of this machine's own server, at its port. */
export const isSameServer = (one: string, other: string, own: Hosted | null) =>
  one === other ||
  (own !== null && [one, other].every(server => isOwn(server, own) && portOf(server) === portOf(own.address)))

export type Answer = { ok: boolean; error?: string; text?: string }

export const failed = (why: string): Answer => ({ ok: false, error: why })
export const done = (text: string): Answer => ({ ok: true, text })

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
