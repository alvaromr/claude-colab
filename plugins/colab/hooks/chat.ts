// What a message of the room becomes on its way in, who it is for, how the chat's log keeps it, how much of the
// pane's chat it takes and how far back the wheel's moves lead it. Pure, with no engine: Node tests it, with coverage
// and mutation.

/** A line of the chat's log, as far as its order and its gaps need. */
type Logged = { n: number; code: string; gap?: true }
/** A link, as far as telling whether a message is for it needs: its name, while it is on. */
type Linked = { status: string; name?: string }

/** The log with `line` added last, numbered after the one before it, and only its newest `size` lines kept. */
export const appended = <L extends Logged>(log: L[], line: L, size: number) =>
  [...log, { ...line, n: (log.at(-1)?.n ?? 0) + 1 }].slice(-size)

/**
 * Back in the room of `place`: what was said there meanwhile never came, and the log says so, with a gap after its
 * last line, unless the room has none or it ends in a gap already, until the room says something again.
 */
export function withGap<L extends Logged>(log: L[], place: { code: string; label: string }, size: number) {
  const last = log.findLast(line => line.code === place.code)
  if (last === undefined || last.gap) return log
  const gap = { ...place, n: 0, from: '', by: 'person' as const, text: '', own: false, gap: true as const }
  return appended<L | typeof gap>(log, gap, size)
}

/** How many people the server last listed in the room of `code`: none for one it did not list. */
export const membersIn = (rooms: { code: string; members: string[] }[], code: string | undefined) =>
  rooms.find(one => one.code === code)?.members.length ?? 0

/** Whether a message is for this session: addressed to its name, or, in a room of two, to no one. */
export const isForMe = (message: { own: boolean; to?: string }, link: Linked, people: number) =>
  !message.own && link.status === 'on' && (message.to === link.name || (message.to === undefined && people === 2))

/** The recipient a message shows: only in a room of more than two, the one case naming it tells anything. */
export const shownTo = (to: unknown, people: number) => (typeof to === 'string' && to && people > 2 ? to : undefined)

/**
 * A message received, as a line of the chat: its text and who, where and to whom cleaned, by its person unless it says
 * otherwise, numbered on logging.
 */
export function lineOf<B extends string>(
  message: { code: string; label: string; from: string; by?: B; to?: string; text: string; own: boolean },
  people: number,
) {
  const to = shownTo(message.to === undefined ? undefined : cleaned(message.to), people)
  return {
    n: 0,
    code: message.code,
    label: cleaned(message.label),
    from: cleaned(message.from),
    by: message.by ?? ('person' as const),
    ...(to === undefined ? {} : { to }),
    text: cleaned(message.text),
    own: message.own,
  }
}

// What could redraw the terminal or change how a text reads: C0 and C1 controls but tab and newline, bidirectional
// marks and line separators, and the invisible ones the model still reads (zero-width marks and tag characters).
// A message loses them on arrival.
const CONTROLS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{61C}\u{200B}\u{200E}\u{200F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2060}\u{2066}-\u{2069}\u{FEFF}\u{E0000}-\u{E007F}]/gu

/** A message's text without what could redraw the terminal or hide from the person what the model reads. */
export const cleaned = (text: string) => text.replace(CONTROLS, '')

// A message's text goes to the model quoted line by line under the mod's header, so no line of it passes for one.
export const quoted = (text: string) =>
  text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')

// One per person, by the number the server gives each connection: distinct while there are no more people than colors.
const COLORS = ['#4E9BF5', '#E5A33B', '#4CB782', '#C678DD', '#E06C75', '#2BB5C2', '#D4B83A', '#9C8BF0']
/** The color of the connection numbered `n`; the theme's own for one with no number yet, or none of a server's. */
export const colorOf = (n: number | undefined) => COLORS[Number(n) % COLORS.length] ?? 'suggestion'

/** About how many rows `text` takes wrapped at `columns`, each of its lines on its own. */
export const rowsOf = (text: string, columns: number) =>
  text.split('\n').reduce((rows, part) => rows + Math.max(1, Math.ceil(part.length / Math.max(1, columns))), 0)

/**
 * How many of the newest messages the chat may scroll past and still have the older ones fill its `rows`: a box
 * takes its borders, its author's line and its text, wrapped inside its borders and padding, and a row apart; a gap
 * takes the line `gap` says.
 */
export function farthestBack(lines: { text: string; gap?: true }[], columns: number, rows: number, gap: string) {
  let filled = 0

  for (const [shown, line] of lines.entries()) {
    filled += (shown === 0 ? 0 : 1) + (line.gap ? rowsOf(gap, columns) : 3 + rowsOf(line.text, columns - 4))
    if (filled >= rows) return lines.length - shown - 1
  }

  return 0
}

/**
 * How many of the newest messages the chat has scrolled past after the wheel's `moves`, each so many messages back
 * (> 0) or forward, taken in turn and held between the latest and `reach`: as far as the drawing finds it goes, so that
 * a move the other way shows at once.
 */
export const scrolledBack = (moves: readonly number[], reach: number) =>
  moves.reduce((back, by) => Math.min(Math.max(0, back + by), reach), 0)

/**
 * The wheel's `moves` with one more, `by` messages back: joined to the last when the same way, which changes nothing
 * of where they lead; none once they lead to the latest, whatever the chat has room for, since past the oldest of its
 * `count` messages it goes nowhere.
 */
export function wheeled(moves: readonly number[], by: number, count: number) {
  const last = moves.at(-1)
  const next =
    last !== undefined && Math.sign(last) === Math.sign(by) ? [...moves.slice(0, -1), last + by] : [...moves, by]
  return scrolledBack(next, Math.max(0, count - 1)) === 0 ? [] : next
}
