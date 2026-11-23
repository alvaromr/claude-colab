// What connect and the CLI say, and what the mod makes of it: how a link that ends is made again or let go, and what
// a command answered. Pure, with no engine: Node tests it, with coverage and mutation.
import { DEAD_AFTER, PING_EVERY, type Refusal } from '../cli/protocol.mts'

export type Answer = { ok: boolean; error?: string; text?: string }

export const failed = (why: string): Answer => ({ ok: false, error: why })
export const done = (text: string): Answer => ({ ok: true, text })

// The wait before linking again after a drop, doubling up to the last.
export const RETRY_FIRST = 1_000
const RETRY_LAST = 30_000
// How long after a drop or a reload a taken name may still be this session's own link, not yet seen gone: past the
// server's pings and one more, it is someone else's.
const GHOST_WAIT = (DEAD_AFTER + 1) * PING_EVERY

/** The wait before the next try, after one that waited `wait`. */
export const nextWait = (wait: number) => Math.min(wait * 2, RETRY_LAST)

/** The lines `text` ends after what was `pending`, and what it leaves pending: a line counts once it ends. */
export function splitLines(pending: string, text: string) {
  const lines = (pending + text).split('\n')
  const rest = String(lines.pop())
  return { lines, rest }
}

/** What kind of failure connect or TLS reported, for the person's words; none where its code says it best. */
export const failureOf = (code: string) =>
  /DECRYPT_ERROR|BINDER/.test(code)
    ? 'keyMismatch'
    : code === 'ECONNREFUSED'
      ? 'nobodyThere'
      : /ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(code)
        ? 'unreachable'
        : undefined

/**
 * Whether a link that ended is let go, not made again: a name the server turned down is turned down on every try, so
 * the person picks another. A taken one alone may be this session's own old link for a while after a drop, until the
 * server lets it go.
 */
export const isLetGo = (refused: Refusal | undefined, droppedAt: number | undefined, now: number) =>
  refused !== undefined && !(refused === 'name-taken' && now - (droppedAt ?? Number.NEGATIVE_INFINITY) <= GHOST_WAIT)

/** Whether someone else came into or left the room this session is in, which the conversation is told. */
export const isOthersMove = (
  move: { code: string; name: string },
  room: { code: string } | null,
  link: { status: string; name?: string },
) => move.code === room?.code && link.status === 'on' && move.name !== link.name

/**
 * What a CLI command answered: its JSON line, unless it exited failing with no refusal of its own; then what it
 * complained of, or none, for the caller to say which command failed.
 */
export function answerOf(ran: { stdout: string; stderr: string; exitCode: number }) {
  try {
    const answer = JSON.parse(ran.stdout) as Answer & Record<string, unknown>

    if (ran.exitCode === 0 || answer.ok === false) return answer
  } catch {
    // Nothing on stdout that reads as an answer: the reason is on stderr.
  }
  const complaint = ran.stderr.trim()

  return complaint ? (failed(complaint) as Answer & Record<string, unknown>) : undefined
}

/** This machine's room server, from what `status` answered: where it listens while it runs, else none. */
export const hostedOf = (status: Record<string, unknown>) =>
  status.running
    ? { address: String(status.listening), title: String(status.title), addresses: status.addresses as string[] }
    : null
