/**
 * A room as the server tells it: `code`, random and secret, is what it is (joining takes it); `label`, a number or a
 * name, is only what people read, and two rooms may share one.
 */
export type Place = { code: string; label: string }

/**
 * The room of the server this session is in, who is in it, and whose Claude is at work on a turn: the server shows
 * no other room.
 */
export type Room = Place & { members: string[]; busy: string[] }

/**
 * `off`: no connect process; `connecting`: started, not yet greeted by the
 * server; `on`: linked to `server` as `name`, its requests taken on `socket`,
 * drawn in the server's `color` for this person.
 */
export type Link =
  | { status: 'off' }
  | { status: 'connecting'; server: string }
  | { status: 'on'; server: string; title: string; name: string; color: number; socket: string }

/**
 * What the pane asks, kept across sessions: `name` empty means `whoami`'s; `title` and `port`, what to open this
 * machine's server with, empty meaning the CLI's defaults.
 */
export type Setup = { name: string; title: string; port: string }

/** A room server this person has connected to, by its address, under the name it gives itself. */
export type Known = { address: string; title: string }

/**
 * This machine's room server: where it listens, its name, and the machine's network addresses, by which a link to
 * it may come too.
 */
export type Hosted = { address: string; title: string; addresses: string[] }

/**
 * The link the person asked for and the room they are in: kept through reloads and drops, and made again. The room's
 * code also makes it again on a server that started over.
 */
export type Want = { server: string; name: string; place: Place | null }

/** A room this session left, to go back to while it lives: the server lists no rooms. */
export type Recent = Place & { server: string }

/** Who wrote a message at its connection: the person, or their Claude. */
export type Author = 'person' | 'claude'

/**
 * A message of the room as the pane's chat and the conversation's rows show it; `n` numbers it in this session, and
 * `to` is kept only where the room had more than two people, the one case naming the recipient tells anything.
 * `code` is its room's, which the chat goes by: rooms of the same label (another server's, or one made after the
 * server started over) never mix. A `gap` line holds no message: it marks a return, after which what was said away is
 * missing. `from` is empty in a gap, and in a message of this session drawn after its link ended, whose name is gone.
 */
export type Line = Place & {
  n: number
  from: string
  by: Author
  to?: string
  text: string
  own: boolean
  gap?: true
}

declare module 'claude-code' {
  interface PluginState {
    colab: {
      link: Link
      rooms: Room[]
      /** The room this session is in, one at a time. */
      room: Place | null
      setup: Setup
      /** Why the last connect or request failed, shown in the pane until the next one. */
      error: string | null
      /** Where this machine's room server listens, or null while none is open: it runs apart from the sessions. */
      hosted: Shaped<Hosted | null>
      /** The servers of others this person has connected to, newest first, kept across sessions. */
      known: Known[]
      /** Each person's color number as the server gave it, by name: what the room's rows are drawn in. */
      colors: Record<string, number>
      want: Want | null
      /** The last messages of every room this session was in, oldest first. */
      log: Line[]
      /** The rooms this session left, newest first. */
      recent: Recent[]
      /** Whether the pane shows its notes, which say what each part does. */
      help: boolean
      /** What each field of the pane turned down, by its key: kept in it for the person to mend, until it takes one. */
      turnedDown: Record<string, string>
      /**
       * The wheel's moves over the chat since it last showed the room's latest message, in turn: each so many
       * messages back (> 0) or forward. How far back that leads, the drawing reckons, which alone knows the room.
       */
      chatWheel: number[]
    }
  }
}
