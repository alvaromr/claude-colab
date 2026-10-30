// This machine's side: a folder only its user can open, with the local sockets and the saved keys.
import { lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { TEXT } from './strings.mts'
import { parseKey } from './wire.mts'

export const HOME = join(homedir(), '.claude-colab')
export const DEFAULT_SOCKET = process.env.CLAUDE_COLAB_SOCKET ?? join(HOME, 'colab.sock')
const KEYS = join(HOME, 'keys')
const ME = userInfo().uid

/** Makes `folder` if missing and refuses one that someone else can open. */
export function privateFolder(folder: string) {
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const { mode, uid } = statSync(folder)
  // Stryker disable next-line ConditionalExpression: a folder of another user takes root to stage
  if ((mode & 0o077) !== 0 || uid !== ME) {
    throw new Error(TEXT.notPrivateFolder(folder))
  }
  return folder
}

/**
 * `err` worded, for a local socket at `path` the system turned down: the limit of its path's length is the system's
 * own (104 bytes on macOS), and macOS tells it apart only as EINVAL.
 */
export const socketError = (path: string, err: NodeJS.ErrnoException) =>
  err.code === 'EINVAL' ? new Error(TEXT.socketTooLong(path)) : err

const keyFile = (host: string, port: number) => join(KEYS, encodeURIComponent(`${host}:${port}`))

export function saveKey(host: string, port: number, text: string) {
  parseKey(text)
  privateFolder(HOME)
  privateFolder(KEYS)
  const file = keyFile(host, port)
  rmSync(file, { force: true }) // a new file, so that a link left there is not followed
  // Stryker disable next-line StringLiteral: `wx` refuses a file made in between, a race no test can stage
  writeFileSync(file, `${text.trim()}\n`, { mode: 0o600, flag: 'wx' }) // the umask can only narrow 600
  return file
}

/** The key saved for that server, as text, or undefined when there is none; refuses a file that is not only yours. */
export function savedKey(host: string, port: number) {
  privateFolder(HOME)
  const file = keyFile(host, port)
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (stat === undefined) return undefined
  // Stryker disable next-line ConditionalExpression: a file of another user takes root to stage
  if (!stat.isFile() || stat.uid !== ME || (stat.mode & 0o077) !== 0) {
    throw new Error(TEXT.notPrivateKey(file))
  }
  return readFileSync(file, 'utf8').trim()
}

// The room server of this machine, one at most: what serve writes while it listens, and its output in the background.
const SERVER = join(HOME, 'server.json')
export const SERVER_LOG = join(HOME, 'server.log')

export type Running = { pid: number; host: string; port: number; title: string }

/** The room server listening on this machine, or undefined; forgets one that ended. */
export function runningServer(): Running | undefined {
  privateFolder(HOME)
  try {
    const server = JSON.parse(readFileSync(SERVER, 'utf8')) as Running
    process.kill(server.pid, 0)
    return server
  } catch {
    // Missing, or its process gone (or reused by another user's, EPERM): no server.
    rmSync(SERVER, { force: true })
    return undefined
  }
}

/** Writes down this process as the machine's room server, and forgets it when the process ends. */
export function markServer(host: string, port: number, title: string) {
  privateFolder(HOME)
  writeFileSync(SERVER, `${JSON.stringify({ pid: process.pid, host, port, title })}\n`, { mode: 0o600 })
  process.on('exit', () => runningServer()?.pid === process.pid && rmSync(SERVER))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0))
}

/** CLAUDE_COLAB_KEY if set, else the key saved for that server. */
export function loadKey(host: string, port: number) {
  const text = process.env.CLAUDE_COLAB_KEY || savedKey(host, port)
  if (text === undefined) throw new Error(TEXT.noKey(`${host}:${port}`))
  return parseKey(text)
}
