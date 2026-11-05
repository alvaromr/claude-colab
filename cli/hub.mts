// serve: the room server, the sockets around the rules of `rooms.mts`. Every request carries a `ref` and gets one
// `reply` with it; changes are pushed to everyone as events.
import type { AddressInfo } from 'node:net'
import tls from 'node:tls'
import { DEAD_AFTER, PING_EVERY, type Value } from './protocol.mts'
import { type Client, type Result, roomsOf } from './rooms.mts'
import { newCode, readLines, serverOptions, writeLine } from './wire.mts'

// Without the key no one gets past the handshake; these keep anyone from holding connections open on the way to it.
const HANDSHAKE_TIMEOUT = 5_000
const HELLO_TIMEOUT = 10_000
const MAX_CLIENTS = 64
// What may wait unread for one connection; one that does not read is dropped before it fills the server's memory.
const MAX_BACKLOG = 1024 * 1024

// `heard`: when it last sent anything.
type Link = { socket: tls.TLSSocket; heard: number }

export type Serving = {
  key: Buffer
  host: string
  port: number
  // Names the server, for those who connect to tell it from others.
  title: string
  // How often connect pings.
  pingEvery?: number
  // How long a connection may take to finish the handshake, and then to say hello.
  handshakeWait?: number
  helloWait?: number
  maxRooms?: number
}

export function serve(
  {
    key,
    host,
    port,
    title,
    pingEvery = PING_EVERY,
    handshakeWait = HANDSHAKE_TIMEOUT,
    helloWait = HELLO_TIMEOUT,
    maxRooms,
  }: Serving,
  onListening: (at: AddressInfo) => void,
) {
  const send = (socket: tls.TLSSocket, event: Value) =>
    // Stryker disable next-line EqualityOperator: one byte either way of the cap tells nothing apart
    socket.writableLength > MAX_BACKLOG ? socket.destroy() : writeLine(socket, event)
  const rooms = roomsOf<Link>({
    title,
    maxRooms,
    deliver: (link, event) => send(link.socket, event),
    newCode,
    now: () => new Date(),
  })

  const server = tls.createServer({ ...serverOptions(key), handshakeTimeout: handshakeWait }, socket => {
    let me: Client<Link> | undefined
    const helloTimer = setTimeout(() => socket.destroy(), helloWait)
    const reply = (ref: unknown, result: Result) => send(socket, { ev: 'reply', ref, ok: !result.reason, ...result })

    readLines(socket, request => {
      const { op, ref } = request
      if (me === undefined) {
        if (op !== 'hello') return socket.destroy()
        clearTimeout(helloTimer)
        const greeted = rooms.hello(request.name, { socket, heard: Date.now() })
        if ('refused' in greeted) {
          reply(ref, greeted.refused)
          return socket.end()
        }
        me = greeted.client
        return reply(ref, greeted.result)
      }
      me.link.heard = Date.now()
      rooms.request(me, request, result => reply(ref, result))
    })

    socket.on('close', () => {
      // Stryker disable next-line CallExpression: frees the timer early; once it fires, it ends a socket already gone
      clearTimeout(helloTimer)
      if (me !== undefined) rooms.drop(me)
    })
    // A dropped connection is handled on close, which follows. Without a listener, an error would end the server;
    // Node rarely raises one on a TLS socket the server holds, and no test makes it.
    // Stryker disable next-line all
    // biome-ignore lint/suspicious/noEmptyBlockStatements: handled on close
    socket.on('error', () => {})
  })
  // A failed handshake (wrong key, junk, timeout) reaches no room, and Node leaves its socket open: it is closed here.
  server.on('tlsClientError', (_err, socket) => socket.destroy())
  server.maxConnections = MAX_CLIENTS // counts connections still in the handshake too
  // One silent past its pings is gone, though TCP never said: it leaves its room, and its name is free again.
  const sweep = setInterval(() => {
    for (const client of rooms.clients()) {
      // Stryker disable next-line EqualityOperator: a millisecond either way of the limit tells nothing apart
      if (Date.now() - client.link.heard > DEAD_AFTER * pingEvery) client.link.socket.destroy()
    }
  }, pingEvery).unref()
  // Stryker disable next-line all: frees the sweep of a closed server, which, unref'd, holds nothing open anyway
  server.on('close', () => clearInterval(sweep))
  server.listen(port, host, () => onListening(server.address() as AddressInfo))
  return server
}
