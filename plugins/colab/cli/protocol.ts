// What serve, connect and the mod agree on. Pure, with no Node: the mod, which has none, imports it too.

export const DEFAULT_PORT = 4747
// Where serve listens unless told: every interface, since others have to reach it (docs/decisions/05).
export const ANY_HOST = '0.0.0.0'
// Where this machine reaches its own server, and the address its server's key is saved for.
export const LOOPBACK = '127.0.0.1'
/** Whether `host` is this machine by loopback: any 127 address, localhost, or ::1, bracketed or not. */
export const isLoopback = (host: string) => /^(127\.|localhost$|\[::1\]$|::1$)/.test(host)
// The private folder of each machine, in its user's home: the CLI keeps its keys and sockets there, and the mod
// puts each connect's socket there.
export const HOME_FOLDER = '.claude-colab'
// What every invitation starts with: the pane and the CLI tell one apart by it.
export const INVITATION_PREFIX = 'colab:'
/** Whether `n` is a TCP port a server can listen on: a whole number from 1 to 65535. */
export const isPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535
// What serve and connect speak: raised whenever one would misread the other. A server runs apart, and outlives the
// code it started from: connect turns down one of another version, which has to be closed and opened again.
export const PROTOCOL = 5
// A link that died unseen (a machine asleep, a network gone) sends nothing, and TCP alone never tells: connect pings
// the server this often, and each side drops the other once it has heard nothing for DEAD_AFTER pings.
export const PING_EVERY = 15_000
export const DEAD_AFTER = 3
export const MAX_LINE = 64 * 1024
export const MAX_TEXT = 16 * 1024

// What people read colab in: Spanish where their locale is Spanish, English anywhere else. Each side speaks its own:
// the server sends codes, never text, and each client words them.
export type Language = 'es' | 'en'
export type Locale = { LC_ALL?: string | undefined; LC_MESSAGES?: string | undefined; LANG?: string | undefined }
/** The language of messages a locale asks for: the first of LC_ALL, LC_MESSAGES and LANG that is set, as POSIX reads. */
export const languageOf = ({ LC_ALL, LC_MESSAGES, LANG }: Locale): Language =>
  // Stryker disable next-line StringLiteral: with no locale any text but a Spanish one gives English, as '' does
  /^es([_.@]|$)/i.test(LC_ALL || LC_MESSAGES || LANG || '') ? 'es' : 'en'

// What the CLI and the mod say on native Windows, where neither runs: both stop at once with it. WSL is Linux to both.
export const NATIVE_WINDOWS: Record<Language, string> = {
  es: 'colab no funciona en Windows nativo: usa Claude Code y colab dentro de WSL',
  en: 'colab does not run on native Windows: use Claude Code and colab inside WSL',
}

// Why the server turns a request down, with the fields its reply adds for the client's words.
export type Refusal =
  | 'bad-name' // the name breaks NAME_RULE
  | 'claude-name' // the name reads like someone's Claude
  | 'name-taken' // someone connected holds the name
  | 'bad-room-name'
  | 'bad-code' // a room's code that isCode turns down
  | 'rooms-full' // `max`: every room the server may hold has someone in
  | 'room-gone'
  | 'elsewhere' // `label`: the room the connection is in, which it leaves first
  | 'not-in-room'
  | 'no-text'
  | 'text-too-long' // `max`: characters
  | 'not-member' // `to`, `label`: the one named is not in the room
  | 'malformed'
  | 'unknown-op' // `op`

// A person's or a room's name: letters, digits, spaces and . _ -, starting with a letter or digit.
export const NAME_LENGTH = 40
export const NAME_RULE: Record<Language, string> = {
  es: `letras, números, espacios y . _ -, hasta ${NAME_LENGTH}, sin mezclar los alfabetos latino, griego y cirílico`,
  en: `letters, digits, spaces and . _ -, up to ${NAME_LENGTH}, without mixing the Latin, Greek and Cyrillic scripts`,
}
const NAME = new RegExp(`^[\\p{L}\\p{N}][\\p{L}\\p{N} ._-]{0,${NAME_LENGTH - 1}}$`, 'u')
// Scripts whose letters look alike: a name that mixes two of them could pass for another one («Аna», its A Cyrillic).
const LOOKALIKES = [/\p{Script=Latin}/u, /\p{Script=Greek}/u, /\p{Script=Cyrillic}/u]
export const isName = (s: unknown): s is string =>
  typeof s === 'string' && NAME.test(s) && LOOKALIKES.filter(script => script.test(s)).length <= 1

// What each JSON line between serve and connect carries.
export type Value = Record<string, unknown>

// A room's code: whoever has it may go in. Only its members and their invitations hold it.
export const isCode = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{24}$/.test(s)
