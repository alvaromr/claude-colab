// What a message of the room becomes on its way in, and how much of the pane's chat it takes. Pure, with no engine:
// Node tests it, with coverage and mutation.

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
