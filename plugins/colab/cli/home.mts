// This machine's side: a folder only its user can open, with the local sockets and the saved keys.
import { lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { LOOPBACK } from './protocol.ts'
import { TEXT } from './strings.mts'
import { newKey, parseKey } from './wire.mts'

export const HOME = join(homedir(), '.claude-colab')
/** The local socket a command uses when it is told none: the one `env` names, or the home's. */
export const defaultSocket = (env: Record<string, string | undefined>) =>
  env.CLAUDE_COLAB_SOCKET ?? join(HOME, 'colab.sock')
const KEYS = join(HOME, 'keys')
const ME = userInfo().uid

/**
 * Makes `folder` if missing and refuses one that someone else can open, or one under a folder someone else could
 * swap it in: one they may write in and is not sticky, or one of theirs.
 */
export function privateFolder(folder: string) {
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const { mode, uid } = statSync(folder)
  // Stryker disable next-line ConditionalExpression: a folder of another user takes root to stage
  if ((mode & 0o077) !== 0 || uid !== ME) {
    throw new Error(TEXT.notPrivateFolder(folder))
  }
  let above = folder
  do {
    above = dirname(above)
    const { mode, uid } = statSync(above)
    const isOpen = (mode & 0o022) !== 0 && (mode & 0o1000) === 0
    // Stryker disable next-line ConditionalExpression,LogicalOperator: a folder of another user takes root to stage
    if (isOpen || (uid !== ME && uid !== 0)) throw new Error(TEXT.notPrivateParent(above))
  } while (dirname(above) !== above)
  return folder
}

/**
 * `err` worded, for a local socket at `path` the system turned down: the limit of its path's length is the system's
 * own (on macOS, 104 bytes up to libuv 1.52 and 253 from 1.53), and macOS tells it apart only as EINVAL; a name
 * past the system's own limit fails as ENAMETOOLONG before that.
 */
export const socketError = (path: string, err: NodeJS.ErrnoException) =>
  err.code === 'EINVAL' || err.code === 'ENAMETOOLONG' ? new Error(TEXT.socketTooLong(path)) : err

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

// What reading the server's record and asking after its process fail with when there is no server.
const GONE = ['ENOENT', 'ESRCH', 'EPERM']

/** The room server listening on this machine, or undefined; forgets one that ended. */
export function runningServer(): Running | undefined {
  privateFolder(HOME)
  try {
    const server = JSON.parse(readFileSync(SERVER, 'utf8')) as Running
    process.kill(server.pid, 0)
    return server
  } catch (err) {
    // Missing, junk, or its process gone (or reused by another user's, EPERM): no server. Any other failure, as one
    // reading the file, says nothing of the server, which may live: it stays as it came.
    if (!(err instanceof SyntaxError) && !GONE.includes(String((err as NodeJS.ErrnoException).code))) throw err
    rmSync(SERVER, { force: true })
    return undefined
  }
}

/** Waits for the machine's room server to end, asking every `every` ms; fails if it has not within `timeout` ms. */
export async function serverEnded({ timeout, every }: { timeout: number; every: number }) {
  const until = Date.now() + timeout
  while (runningServer() !== undefined) {
    // Stryker disable next-line EqualityOperator: a millisecond either way of the time tells nothing apart
    if (Date.now() >= until) throw new Error(TEXT.notStopped)
    await sleep(every)
  }
}

/**
 * What markServer takes from the process it runs in: its pid, its exit, and the signals that ask it to end. The
 * process itself, but for a test, which runs it in its own.
 */
export type ServerProcess = {
  pid: number
  exit: (code: number) => void
  on: (event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void) => unknown
}

/** Writes down this process as the machine's room server, and forgets it when the process ends. */
export function markServer(host: string, port: number, title: string, serving: ServerProcess = process) {
  privateFolder(HOME)
  writeFileSync(SERVER, `${JSON.stringify({ pid: serving.pid, host, port, title })}\n`, { mode: 0o600 })
  serving.on('exit', () => runningServer()?.pid === serving.pid && rmSync(SERVER))
  for (const signal of ['SIGINT', 'SIGTERM'] as const) serving.on(signal, () => serving.exit(0))
}

/** The key saved for that server. */
export function loadKey(host: string, port: number) {
  const text = savedKey(host, port)
  if (text === undefined) throw new Error(TEXT.noKey(`${host}:${port}`))
  return parseKey(text)
}

/**
 * The key this machine's server opens with on `port`: its saved one unless `isNew`, else a new one. It comes from no
 * variable of the environment, which every process the session starts would inherit.
 */
export const serverKey = (port: number, isNew: boolean) => (isNew ? undefined : savedKey(LOOPBACK, port)) || newKey()
