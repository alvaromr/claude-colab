// Which addresses reach which server, and the servers and rooms kept to go back to. Pure, with no engine: Node tests
// it, with coverage and mutation.

/** This machine's server, as far as telling its addresses apart needs: where it listens, and the machine's own. */
type Own = { address: string; addresses: string[] } | null
/** This machine as an address by loopback, which the protocol says: the one it reaches itself at, and any such. */
type Machine = { loopback: string; isLoopback: (host: string) => boolean }
/** A room left, as far as telling it apart needs: its code, on its server. */
type Left = { code: string; server: string }

const portOf = (server: string) => server.slice(server.lastIndexOf(':') + 1)

/**
 * The addresses of `machine`, which the mod hands the protocol's: this module imports nothing (`AGENTS.md`,
 * Architecture).
 */
export function addressesOf({ loopback, isLoopback }: Machine) {
  // This machine, as an address: by loopback, or by one of its network addresses, which its own server's
  // invitations carry. Its own server is reached there, and is no server of others to remember. A server is its
  // host, then the port.
  const isOwn = (server: string, own: Own) => {
    const host = server.slice(0, server.lastIndexOf(':'))
    return isLoopback(server) || isLoopback(host) || (own?.addresses.includes(host) ?? false)
  }
  /** Whether two addresses reach one server: the same address, or two of this machine's own server, at its port. */
  const isSameServer = (one: string, other: string, own: Own) =>
    one === other ||
    (own !== null && [one, other].every(server => isOwn(server, own) && portOf(server) === portOf(own.address)))
  /** Whether two rooms left are one: the same code, on the same server. */
  const isSameRoom = (one: Left, other: Left, own: Own) =>
    one.code === other.code && isSameServer(one.server, other.server, own)
  /** The rooms left, without `left` or any that is the same room. */
  const without = <R extends Left>(recent: R[], left: R, own: Own) => recent.filter(one => !isSameRoom(one, left, own))

  return {
    isOwn,
    isSameServer,
    isSameRoom,
    without,
    /** Where this machine reaches a server of its own that listens at `listening`: by loopback, at its port. */
    localAt: (listening: string) => `${loopback}:${portOf(listening)}`,
    /** The rooms left, newest first, with `left` first, once, and only the newest `size` kept. */
    withLeft: <R extends Left>(recent: R[], left: R, own: Own, size: number) =>
      [left, ...without(recent, left, own)].slice(0, size),
  }
}

/** The servers known, newest first, with `server` first and no other at its address. */
export const remembered = <K extends { address: string }>(known: K[], server: K) => [
  server,
  ...known.filter(one => one.address !== server.address),
]
