// Which addresses reach which server. Pure, with no engine: Node tests it, with coverage and mutation.

/** This machine's server, as far as telling its addresses apart needs: where it listens, and the machine's own. */
type Own = { address: string; addresses: string[] } | null

// This machine, as an address: by loopback, or by one of its network addresses, which its own server's invitations
// carry. Its own server is reached there, and is no server of others to remember.
export const isOwn = (server: string, own: Own) =>
  /^(127\.|localhost(:|$)|\[::1\]|::1$)/.test(server) ||
  (own?.addresses.includes(server.slice(0, server.lastIndexOf(':'))) ?? false)
const portOf = (server: string) => server.slice(server.lastIndexOf(':') + 1)
/** Whether two addresses reach one server: the same address, or two of this machine's own server, at its port. */
export const isSameServer = (one: string, other: string, own: Own) =>
  one === other ||
  (own !== null && [one, other].every(server => isOwn(server, own) && portOf(server) === portOf(own.address)))
/** Whether two rooms left are one: the same code, on the same server. */
export const isSameRoom = (one: { code: string; server: string }, other: { code: string; server: string }, own: Own) =>
  one.code === other.code && isSameServer(one.server, other.server, own)
