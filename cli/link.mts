// connect: one per Claude session. Keeps the TLS link to a room server and prints each event the server pushes as
// one JSON line on stdout. Takes requests from this machine over HTTP on a Unix socket, in a folder only its user
// can open; the mod and the CLI's other commands use it. Run by a Claude Code session, it can also post into that
// session's inbox (CLAUDE_CODE_MESSAGING_SOCKET), where a line wakes the model as another session's message.
import { lstatSync, rmSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import tls from 'node:tls'
import { privateFolder, socketError } from './home.mts'
import { DEAD_AFTER, MAX_LINE, PING_EVERY, PROTOCOL, type Refusal, type Value } from './protocol.mts'
import { TEXT } from './strings.mts'
import { clientOptions, invitation, readLines, writeLine } from './wire.mts'

const REPLY_TIMEOUT = 10_000
// What the local socket takes, with the fields each passes on: the server's operations, and `inbox` and `invite`,
// which this process answers itself.
// Stryker disable ArrayDeclaration: a field added to an empty list arrives undefined, and JSON leaves it out
const REQUESTS: Record<string, string[]> = {
  rooms: [],
  create: ['name', 'code'],
  join: ['code'],
  leave: [],
  say: ['text', 'to', 'by'],
  busy: ['busy'],
  inbox: ['text'],
  invite: [],
}
// Stryker restore ArrayDeclaration
// What the server may push; `connected`, `disconnected` and `error` are this process's own, never the server's.
const SERVER_EVENTS = new Set(['rooms', 'member', 'message'])
const INBOX_TIMEOUT = 5_000

export type Answer = Value & { ok: boolean; error?: string }

/** A server's reply as this process answers it: a refusal gets its `reason` put in words, in this machine's language. */
function worded(reply: Value): Answer {
  if (reply.ok) return reply as Answer
  const reason = String(reply.reason)
  // A reason this version has no words for is shown as it came.
  const error = Object.hasOwn(TEXT.refused, reason) ? TEXT.refused[reason as Refusal](reply) : reason
  return { ...reply, ok: false, error }
}

/**
 * Posts `text` into the inbox of the Claude Code session that runs this process, as its docs describe: an auth
 * line with the session's token, then the message as a user line. The session wakes on it, and checks it as any
 * message from another session; it takes it unasked only from its own child processes, as this one is.
 */
async function postToInbox(text: unknown, wait: number): Promise<Answer> {
  const { CLAUDE_CODE_MESSAGING_SOCKET: path, CLAUDE_CODE_MESSAGING_TOKEN: token } = process.env
  if (!path) return { ok: false, error: TEXT.noInbox }
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: TEXT.refused['no-text']() }
  return new Promise(resolve => {
    const inbox = net.connect(path, () => {
      if (token) writeLine(inbox, { type: 'auth', token })
      inbox.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    })
    inbox.setTimeout(wait, () => inbox.destroy(new Error(TEXT.inboxSilent)))
    inbox.on('close', hadError => hadError || resolve({ ok: true }))
    inbox.on('error', err => resolve({ ok: false, error: err.message }))
    inbox.resume() // whatever the inbox answers is not needed
  })
}

/**
 * Where others reach a server this process reaches at `host`: that host, or, for this machine's own server, each
 * address this machine has on a network (a LAN, a VPN), since which one reaches it depends on the guest.
 */
export function reachableAt(host: string) {
  return /^(127\.|localhost$|::1$)/.test(host) ? networkAddresses() : [host]
}

// Stryker disable next-line ConditionalExpression: for the type checker; Node lists no undefined interface
const isListed = (one: NetworkInterfaceInfo | undefined): one is NetworkInterfaceInfo => one !== undefined

/** This machine's addresses on its networks, IPv4: where others reach its room server. */
export function networkAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((one): one is NetworkInterfaceInfo => isListed(one) && !one.internal && one.family === 'IPv4')
    .map(one => one.address)
}

export type Linking = {
  key: Buffer
  host: string
  port: number
  name: string
  socketPath: string
  pingEvery?: number
  // How long a request waits for the server's reply, and a message for the inbox to take it.
  replyWait?: number
  inboxWait?: number
}

export function connect({
  key,
  host,
  port,
  name,
  socketPath,
  pingEvery = PING_EVERY,
  replyWait = REPLY_TIMEOUT,
  inboxWait = INBOX_TIMEOUT,
}: Linking) {
  const emit = (event: Value) => writeLine(process.stdout, event)
  const pending = new Map<unknown, (result: Answer) => void>() // by ref
  let lastRef = 0
  let heard = Date.now() // when the server last sent anything
  let lastError: string | undefined

  const server = tls.connect({ ...clientOptions(key), host, port })
  // A request is answered once, by its reply or by the wait running out; the bookkeeping that frees the other side
  // (the pending entry, the timer) changes no answer, so the mutants that drop it are let be.
  const call = (request: Value) =>
    new Promise<Answer>(resolve => {
      // Stryker disable next-line UpdateOperator: counting down gives unique refs too
      const ref = ++lastRef
      const timer = setTimeout(() => {
        // Stryker disable next-line CallExpression: bookkeeping, see above
        pending.delete(ref)
        resolve({ ok: false, error: TEXT.serverSilent })
      }, replyWait)
      pending.set(ref, result => {
        // Stryker disable next-line CallExpression: bookkeeping, see above
        clearTimeout(timer)
        resolve(result)
      })
      writeLine(server, { ...request, ref })
    })

  readLines(server, event => {
    heard = Date.now()
    if (event.ev === 'reply') {
      const { ev, ref, ...result } = event
      pending.get(ref)?.(worded(result))
      // Stryker disable next-line CallExpression: bookkeeping, see above
      pending.delete(ref)
      return
    }
    if (!SERVER_EVENTS.has(String(event.ev))) return
    emit(event.ev === 'message' ? { ...event, own: event.from === name } : event)
  })
  let socketId: number | undefined // the inode of the socket this process listens on, so that it removes only its own
  server.on('secureConnect', async () => {
    const hello = await call({ op: 'hello', name })
    // The server closes the link. `reason` tells a taken name apart, for whoever started connect to choose another.
    if (!hello.ok) return emit({ ev: 'error', error: hello.error, reason: hello.reason })
    if (hello.version !== PROTOCOL) {
      emit({ ev: 'error', error: TEXT.otherVersion(`${host}:${port}`) })
      return server.destroy()
    }
    // The room this connection is in, with its code, as the server's replies said: what an invitation hands on.
    let here: { label: string; code: string } | undefined
    const local = async (op: string, fields: Value): Promise<Answer> => {
      if (op === 'inbox') return postToInbox(fields.text, inboxWait)
      if (op === 'invite') {
        if (!here) return { ok: false, error: TEXT.refused['not-in-room']() }
        const addresses = reachableAt(host)
        if (addresses.length === 0) return { ok: false, error: TEXT.noAddress }
        const { label: room, code } = here
        return { ok: true, invitation: invitation({ addresses, port, key: key.toString('base64url'), room, code }) }
      }
      const result = await call({ ...fields, op })
      if (result.ok && (op === 'create' || op === 'join')) {
        here = { label: String(result.label), code: String(result.code) }
      }
      if (result.ok && op === 'leave') here = undefined
      return result
    }
    try {
      socketId = await listenLocally(socketPath, local)
    } catch (err) {
      emit({ ev: 'error', error: (err as Error).message })
      return server.destroy()
    }
    emit({
      ev: 'connected',
      name,
      color: hello.color,
      server: `${host}:${port}`,
      title: hello.title,
      socket: socketPath,
      rooms: hello.rooms,
    })
    // A server silent past its pings is gone: the link ends, and whoever started this process links again.
    setInterval(() => {
      // Stryker disable next-line EqualityOperator: a millisecond either way of the limit tells nothing apart
      if (Date.now() - heard > DEAD_AFTER * pingEvery) {
        lastError = TEXT.serverGone
        return server.destroy()
      }
      void call({ op: 'ping' })
    }, pingEvery)
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    // Without a code: this client's own refusal of a server that shows a certificate, which a test cannot provoke,
    // since Node checks only one its trusted authorities signed.
    /* node:coverage disable */
    lastError = err.code ?? err.message
    /* node:coverage enable */
  })
  server.on('close', () => {
    emit({ ev: 'disconnected', ...(lastError ? { error: lastError } : {}) })
    process.exit(1)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0))
  process.on('exit', () => {
    if (socketId !== undefined && lstatSync(socketPath, { throwIfNoEntry: false })?.ino === socketId) rmSync(socketPath)
  })
}

/** Whether a process is listening on the Unix socket at `path`; one that does not answer as refused counts as yes. */
const isListening = (path: string) =>
  new Promise<boolean>(resolve => {
    const probe = net.connect(path, () => {
      // Stryker disable next-line CallExpression: on yes, this process ends at once, and the probe with it
      probe.destroy()
      resolve(true)
    })
    probe.on('error', (err: NodeJS.ErrnoException) => resolve(err.code !== 'ECONNREFUSED'))
  })

/**
 * Listens on `socketPath`, handing each request to `answerOp(op, fields)`, and resolves with its inode; turns it down
 * if another process listens there.
 */
async function listenLocally(socketPath: string, answerOp: (op: string, fields: Value) => Promise<Answer>) {
  privateFolder(dirname(socketPath))
  if (lstatSync(socketPath, { throwIfNoEntry: false })?.isSocket()) {
    if (await isListening(socketPath)) throw new Error(TEXT.connectThere(socketPath))
    rmSync(socketPath) // left by a crash
  }

  const local = http.createServer((req, res) => {
    const op = String(req.url).slice(1)
    const passed = Object.hasOwn(REQUESTS, op) ? REQUESTS[op] : undefined
    const answer = (status: number, value: Answer) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (req.method !== 'POST' || passed === undefined)
      return answer(404, { ok: false, error: TEXT.unknownRequest(`${req.method} ${req.url}`) })
    let body = ''
    // Stryker disable next-line StringLiteral: an empty encoding is utf8 too
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
      if (body.length > MAX_LINE) req.destroy()
    })
    req.on('end', async () => {
      let args: unknown
      try {
        args = body ? JSON.parse(body) : {}
      } catch {
        return answer(400, { ok: false, error: TEXT.notJson })
      }
      if (args === null || typeof args !== 'object' || Array.isArray(args))
        return answer(400, { ok: false, error: TEXT.notObject })
      const fields = Object.fromEntries(passed.map(field => [field, (args as Value)[field]]))
      answer(200, await answerOp(op, fields))
    })
  })
  const umask = process.umask(0o177) // the socket is born 600, with no moment open to others
  const listening = new Promise((resolve, reject) => {
    local.once('error', err => reject(socketError(socketPath, err)))
    local.listen(socketPath, () => resolve(undefined))
  })
  // Stryker disable next-line all: this process makes no other file to tell the umask by
  await listening.finally(() => process.umask(umask))
  return lstatSync(socketPath).ino
}
