// Which addresses reach which server, and the servers and rooms kept to go back to. Pure, with no engine: Node tests
// it, with coverage and mutation.
import { LOOPBACK } from '../cli/protocol.mts'

/** This machine's server, as far as telling its addresses apart needs: where it listens, and the machine's own. */
type Own = { address: string; addresses: string[] } | null

// This machine, as an address: by loopback, or by one of its network addresses, which its own server's invitations
// carry. Its own server is reached there, and is no server of others to remember.
export const isOwn = (server: string, own: Own) =>
  /^(127\.|localhost(:|$)|\[::1\]|::1$)/.test(server) ||
  (own?.addresses.includes(server.slice(0, server.lastIndexOf(':'))) ?? false)
const portOf = (server: string) => server.slice(server.lastIndexOf(':') + 1)
/** Where this machine reaches a server of its own that listens at `listening`: by loopback, at its port. */
export const localAt = (listening: string) => `${LOOPBACK}:${portOf(listening)}`
/** Whether two addresses reach one server: the same address, or two of this machine's own server, at its port. */
export const isSameServer = (one: string, other: string, own: Own) =>
  one === other ||
  (own !== null && [one, other].every(server => isOwn(server, own) && portOf(server) === portOf(own.address)))
/** Whether two rooms left are one: the same code, on the same server. */
export const isSameRoom = (one: { code: string; server: string }, other: { code: string; server: string }, own: Own) =>
  one.code === other.code && isSameServer(one.server, other.server, own)

/** The servers known, newest first, with `server` first and no other at its address. */
export const remembered = <K extends { address: string }>(known: K[], server: K) => [
  server,
  ...known.filter(one => one.address !== server.address),
]
/** The rooms left, without `left` or any that is the same room. */
export const without = <R extends { code: string; server: string }>(recent: R[], left: R, own: Own) =>
  recent.filter(one => !isSameRoom(one, left, own))
/** The rooms left, newest first, with `left` first, once, and only the newest `size` kept. */
export const withLeft = <R extends { code: string; server: string }>(recent: R[], left: R, own: Own, size: number) =>
  [left, ...without(recent, left, own)].slice(0, size)
