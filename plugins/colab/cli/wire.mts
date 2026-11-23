// What serve and connect share: TLS 1.3 with a pre-shared key, and JSON lines with a size cap.
import { randomBytes } from 'node:crypto'
import type { Duplex, Writable } from 'node:stream'
import type { ConnectionOptions, TlsOptions } from 'node:tls'
import { INVITATION_PREFIX, isCode, isName, MAX_LINE, type Value } from './protocol.mts'
import { TEXT } from './strings.mts'

const IDENTITY = 'claude-colab'
// SHA-384 suites fail the PSK handshake in Node 26; the SHA-256 ones work.
const TLS = { minVersion: 'TLSv1.3', ciphers: 'TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256' } as const

export const newKey = () => randomBytes(32).toString('base64url')

// A room's code: whoever has it may go in. Only its members and their invitations hold it.
export const newCode = () => randomBytes(18).toString('base64url')

/**
 * Everything to go into a room from another machine, as one text to pass on by another means: the server's
 * addresses (any of them may be the one that reaches it), its port and key, the room and its code.
 */
export type Invitation = { addresses: string[]; port: number; key: string; room: string; code: string }

export const invitation = ({ addresses, port, key, room, code }: Invitation) =>
  INVITATION_PREFIX + Buffer.from(JSON.stringify({ addresses, port, key, room, code })).toString('base64url')

/** What `invitation` put in, checked; throws on anything else. */
export function parseInvitation(text: unknown): Invitation {
  const bad = new Error(TEXT.badInvitation)
  const body = String(text).trim()
  if (!body.startsWith(INVITATION_PREFIX)) throw bad
  let found: Partial<Record<keyof Invitation, unknown>> | null
  // Stryker disable BlockStatement: what does not parse fails the checks below just the same
  try {
    found = JSON.parse(Buffer.from(body.slice(INVITATION_PREFIX.length), 'base64url').toString('utf8'))
  } catch {
    throw bad
  }
  // Stryker restore BlockStatement
  const { addresses, port, key, room, code } = found ?? {}
  const fine =
    Array.isArray(addresses) &&
    addresses.length > 0 &&
    addresses.every(address => typeof address === 'string' && address.length <= 64) &&
    // Stryker disable next-line ConditionalExpression: for the type checker; Number.isInteger refuses the rest too
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    typeof key === 'string' &&
    isName(room) &&
    isCode(code)
  if (!fine) throw bad
  parseKey(key)
  return { addresses, port, key, room, code }
}

export function parseKey(text: string | undefined) {
  const key = Buffer.from(String(text), 'base64url')
  if (key.length !== 32) throw new Error(TEXT.badKey)
  return key
}

export const serverOptions = (key: Buffer): TlsOptions => ({
  ...TLS,
  pskCallback: (_socket, identity) => (identity === IDENTITY ? key : null),
})

// There is no certificate to check: knowing the key is what proves the server. One that shows a certificate has not
// used the key, and is turned down.
export const clientOptions = (key: Buffer): ConnectionOptions => ({
  ...TLS,
  pskCallback: () => ({ psk: key, identity: IDENTITY }),
  // Node passes an empty object when the server shows none.
  checkServerIdentity: (_host, cert) => (cert.raw ? new Error(TEXT.certificate) : undefined),
})

/** Calls `onValue` with each JSON line the socket sends; destroys it on bad JSON or a line over MAX_LINE. */
export function readLines(socket: Duplex, onValue: (value: Value) => void) {
  let buffer = ''
  // Stryker disable next-line StringLiteral: an empty encoding is utf8 too
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    const lines = (buffer + chunk).split('\n')
    buffer = String(lines.pop()) // split always leaves the last, unfinished line
    for (const line of lines) {
      let value: unknown
      // Stryker disable BlockStatement: what does not parse fails the check below just the same
      try {
        value = JSON.parse(line)
      } catch {
        return socket.destroy()
      }
      // Stryker restore BlockStatement
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return socket.destroy()
      onValue(value as Value)
    }
    if (buffer.length > MAX_LINE) socket.destroy()
  })
}

export const writeLine = (socket: Writable, value: unknown) => socket.write(`${JSON.stringify(value)}\n`)
