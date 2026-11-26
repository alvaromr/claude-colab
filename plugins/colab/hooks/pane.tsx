import type { On, RenderInput, ResolveInput } from 'claude-code'

import { DEFAULT_PORT, INVITATION_PREFIX, isName, isPort } from '../cli/protocol'
import type { Line, Link, Setup } from '../types'
import { acceptInvitation, connect, disconnect, hostHere } from './link'
import { sayFromPane } from './messages'
import { copyInvitation, create, leave, rejoinRecent } from './rooms'
import { colorOf, farthestBack, rowsOf, scrolledBack, wheeled } from './chat'
import { closeServer, machine } from './server'
import {
  type Answer,
  type Engine,
  failed,
  isNativeWindows,
  isOwn,
  isSameServer,
  readChatWheel,
  readColors,
  readHelp,
  readHosted,
  readKnown,
  readLink,
  readLog,
  readRecent,
  readRoom,
  readRooms,
  readSetup,
  readTurnedDown,
  T,
  updateChatWheel,
  updateHelp,
  updateSetup,
  updateTurnedDown,
} from './state'

export const PANE = 'colab'
export const TITLE = 'Colab'
// How many of the messages the pane's chat keeps it draws at most: those that fit its height show.
const CHAT_DRAWN = 40
// The pane's drawing, as the engine asks for it: with the body's size.
type PaneInput = RenderInput<'Pane'>

/** How a message's author is named: the person by their name, their Claude as theirs. */
const authorOf = (line: Pick<Line, 'from' | 'by'>) =>
  line.from === ''
    ? line.by === 'claude'
      ? T.yourClaude
      : T.you
    : line.by === 'claude'
      ? T.claudeOf(line.from)
      : line.from

/** One message as the conversation and the pane draw it: boxed, with round corners, in its author's color. */
export function bubble($: Engine, e: ResolveInput, line: Line, painted: Record<string, number>) {
  const { Box, Text, Markdown } = $.ui.resolve(e)
  const color = colorOf(painted[line.from])

  return (
    // Never shrunk to fit: in the pane's chat, what does not fit is cut, not squeezed into lines that overlap.
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={color} paddingX={1}>
      <Text color={color} bold>
        {`${authorOf(line)}${line.to === undefined ? '' : ` → ${line.to}`}`}
      </Text>
      <Markdown text={line.text} />
    </Box>
  )
}

/** Keeps `text` in the pane's field `key`, turned down or not sent, for the person to mend; undefined lets it go. */
function keepInField($: Engine, key: string, text: string | undefined) {
  return updateTurnedDown($, all => {
    const { [key]: _taken, ...others } = all

    return text === undefined ? others : { ...others, [key]: text }
  })
}

/** Confirms or turns down an action of the pane in a toast, which goes by itself; one that broke is turned down. */
async function report($: Engine, pending: Promise<Answer>) {
  const answer = await pending.catch((caught: unknown) => failed(String(caught)))
  const told = answer.ok ? answer.text : (answer.error ?? T.failed)

  if (told !== undefined) await $.ui.toast(told)
}

/** What the person typed in the pane's fields: kept for this session and the next ones. */
async function changeSetup($: Engine, patch: Partial<Setup>) {
  await updateSetup($, s => ({ ...s, ...patch }))
  await $.store.set('setup', await readSetup($))
}

/** The parts every view of the pane is made of, and what they read. */
async function partsOf($: Engine, e: ResolveInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button, Input } = ui
  const server = await readHosted($)
  const isHelping = await readHelp($)
  const kept = await readTurnedDown($)
  const typed = await readSetup($)
  // The notes say what each part does: they take room, so the button i shows and hides them all.
  const note = (text: string) => (isHelping ? <Text dimColor>{text}</Text> : null)
  const info = (
    <Button key="help" plain dimColor={!isHelping} onPress={() => void updateHelp($, shown => !shown)}>
      {isHelping ? T.hideHelp : 'i'}
    </Button>
  )
  // The terminal draws a field as bare text: a ground of its own marks it, its label beside, outside it. `take`
  // acts on what Enter submits, or says what it expects instead; what it turns down stays in the field, to mend.
  const field = (
    key: string,
    label: string,
    value: string,
    hint: string,
    take: (text: string) => string | undefined,
  ) => (
    <Box key={`field-${key}`} flexDirection="row" gap={1}>
      <Text>{label}</Text>
      <Box {...(e.surface === 'terminal' ? { backgroundColor: 'subtle' as const } : {})}>
        <Input
          key={key}
          value={kept[key] ?? value}
          placeholder={hint}
          onSubmit={text => {
            const expected = take(text.trim())

            void keepInField($, key, expected === undefined ? undefined : text)
            if (expected !== undefined) $.ui.toast(expected)
          }}
        />
      </Box>
    </Box>
  )
  const serving =
    server === null ? null : (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{T.yourServer(server.title, server.address)}</Text>
          <Button key="stop-serving" onPress={() => void report($, closeServer($))}>
            {T.closeServer}
          </Button>
        </Box>
        {note(T.closeServerNote)}
      </Box>
    )
  const invitationField = (
    <Box flexDirection="column">
      {field('invitation', T.invitation, '', T.invitationHint, value => {
        if (!value.startsWith(INVITATION_PREFIX)) return T.notAnInvitation
        void report($, acceptInvitation($, value, typed.name))

        return undefined
      })}
      {note(T.invitationNote)}
    </Box>
  )

  return { ui, server, isHelping, typed, note, info, field, serving, invitationField }
}
type Parts = Awaited<ReturnType<typeof partsOf>>

/** While connect starts: where to, and the way to call it off. */
function connectingView($: Engine, { ui: { Box, Text, Button }, serving }: Parts, server: string) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text>{T.connecting(server)}</Text>
      <Button key="cancel" onPress={() => void report($, disconnect($))}>
        {T.cancel}
      </Button>
      {serving}
    </Box>
  )
}

/** Not linked: the name, an invitation, the servers known, and this machine's own server to open or link to. */
async function entryView($: Engine, parts: Parts) {
  const { ui, server, typed, note, info, field, serving, invitationField } = parts
  const { Box, Text, Button } = ui
  const servers = (await readKnown($)).filter(one => !isOwn(one.address, server))
  /** A field of the setup, kept once `isValid`; empty is the default. */
  const setupField = (
    key: keyof Setup,
    label: string,
    hint: string,
    isValid: (value: string) => boolean,
    rule: string,
  ) =>
    field(key, label, typed[key], hint, value => {
      if (value !== '' && !isValid(value)) return rule
      void changeSetup($, { [key]: value })

      return undefined
    })

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold>{T.enterRoom}</Text>
        {info}
      </Box>
      {setupField('name', T.yourName, T.yourNameHint, isName, T.yourNameRule)}
      {note(T.yourNameNote)}
      {invitationField}
      {servers.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>{T.knownServers}</Text>
          {note(T.knownServersNote)}
          {servers.map(one => (
            <Button key={`known:${one.address}`} onPress={() => void report($, connect($, one.address, typed.name))}>
              {`${one.title} · ${one.address}`}
            </Button>
          ))}
        </Box>
      )}
      {server === null && <Text bold>{T.openHere}</Text>}
      {server === null && setupField('title', T.serverName, machine ?? T.serverNameHint, isName, T.serverNameRule)}
      {server === null && setupField('port', T.port, String(DEFAULT_PORT), value => isPort(Number(value)), T.portRule)}
      {server === null && note(T.openNote)}
      {serving}
      <Button key="host" variant="primary" onPress={() => void report($, hostHere($, typed))}>
        {server === null ? T.openServer : T.linkMine}
      </Button>
    </Box>
  )
}

/**
 * Linked: in no room, the way into one and off the server; in one, its chat. The pane takes its body's height
 * exactly, so it never scrolls as a whole: the header and its controls stay on top, the field to write in at the
 * bottom, and the chat between them scrolls by itself (the ui.scroll hook).
 */
async function linkedView($: Engine, e: PaneInput, parts: Parts, current: Extract<Link, { status: 'on' }>) {
  const { ui, server, isHelping, note, info, field, serving, invitationField } = parts
  const { Box, Text, Button } = ui
  const here = await readRoom($)
  const mine = (await readRooms($)).find(one => one.code === here?.code)
  const inside = mine?.members ?? []
  // The others' Claudes at work: this session's own is in sight in its conversation.
  const working = (mine?.busy ?? []).filter(name => name !== current.name)
  const painted = await readColors($)
  // Out of a room there is no chat: no line of the log goes by a room that is not there.
  const said = here === null ? [] : (await readLog($)).filter(line => line.code === here.code)
  const notes = [
    here === null ? T.disconnectNote : T.leaveNote,
    here === null ? T.newRoomNote : T.inviteNote,
    T.alsoNote,
  ]
  const left = (await readRecent($)).filter(one => isSameServer(one.server, current.server, server))
  const { chat, back, reach } = await chatShown($, e, { here, inside, working, isHelping, notes, said, current })

  return (
    <Box flexDirection="column" height={e.props.scroll?.bodyRows ?? 30} rowGap={1}>
      <Box flexDirection="column" flexShrink={0} rowGap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text>
              <Text color={colorOf(current.color)}>●</Text> {T.whereAmI(current.name, current.title, current.server)}
            </Text>
            {info}
          </Box>
          {note(notes[0] ?? '')}
        </Box>
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {here === null && (
              <Button key="disconnect" onPress={() => void report($, disconnect($))}>
                {T.disconnect}
              </Button>
            )}
            {here !== null && (
              <Button
                key="invite"
                variant="primary"
                onPress={press => void report($, copyInvitation($, press.surface))}
              >
                {T.copyInvitation}
              </Button>
            )}
            {here !== null && (
              <Button key="leave" onPress={() => void report($, leave($))}>
                {T.leaveRoom}
              </Button>
            )}
            {here === null && (
              <Button key="new-room" onPress={() => void report($, create($))}>
                {T.newRoom}
              </Button>
            )}
          </Box>
          {notes.slice(1, -1).map(note)}
        </Box>
        {here === null && left.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>{T.roomsBeen}</Text>
            {left.map(one => (
              <Button key={`recent:${one.code}`} onPress={() => void report($, rejoinRecent($, one))}>
                {T.backTo(one.label)}
              </Button>
            ))}
          </Box>
        )}
        {here === null && invitationField}
        {here === null && isOwn(current.server, server) && serving}
        {note(notes.at(-1) ?? '')}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} rowGap={1}>
        {here === null ? (
          <Text dimColor>{T.noRoomYet}</Text>
        ) : (
          <Text>
            <Text bold>{T.chatOf(here.label)}</Text>
            <Text dimColor>{T.inRoom(inside.join(', '))}</Text>
            {working.map(name => (
              <Text key={`busy:${name}`} color={colorOf(painted[name])}>
                {T.atWork(name)}
              </Text>
            ))}
          </Text>
        )}
        {/* Held to the bottom, where the latest come in; scrolled back as far as it goes, held to the top, so that
            the oldest message shows whole and what the rows' reckoning missed is cut below it, not above. */}
        <Box
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          overflow="hidden"
          justifyContent={back > 0 && back === reach ? 'flex-start' : 'flex-end'}
        >
          {here !== null && said.length === 0 && <Text dimColor>{T.noMessages}</Text>}
          {chat.map(line =>
            line.gap ? (
              <Text key={`gap:${line.n}`} dimColor>
                {T.gap}
              </Text>
            ) : (
              bubble($, e, line, painted)
            ),
          )}
        </Box>
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        {back > 0 && <Text dimColor>{T.newer(back)}</Text>}
        {here !== null &&
          field('say', '›', '', T.sayHint, value => {
            if (value === '') return T.sayNothing
            // What is said shows in the chat: only a failure is told, and what failed stays in the field.
            void sayFromPane($, value).then(async sent => {
              if (sent.ok) return
              await keepInField($, 'say', value)
              $.ui.toast(sent.error ?? T.notSentToast)
            })

            return undefined
          })}
      </Box>
    </Box>
  )
}

/**
 * The messages the chat has room for, `back` from the latest, and how far back it may go: the rows of everything but
 * the chat, as the pane wraps them, leave it the rest of the body's height, and the wheel's moves lead back within it.
 */
async function chatShown(
  $: Engine,
  e: PaneInput,
  view: {
    here: { label: string } | null
    inside: string[]
    working: string[]
    isHelping: boolean
    notes: string[]
    said: Line[]
    current: Extract<Link, { status: 'on' }>
  },
) {
  const { here, inside, working, isHelping, notes, said, current } = view
  const columns = e.props.bodyColumns
  // In a room the pane is its chat: the way in and out of rooms and servers is the pane's without one.
  const controls = here === null ? `[ ${T.disconnect} ] [ ${T.newRoom} ]` : `[ ${T.copyInvitation} ] [ ${T.leaveRoom} ]`
  const heading = `● ${T.whereAmI(current.name, current.title, current.server)} i`
  const titleLine =
    here === null
      ? T.noRoomYet
      : T.chatOf(here.label) + T.inRoom(inside.join(', ')) + working.map(name => T.atWork(name)).join('')
  const fixed =
    rowsOf(heading, columns) +
    rowsOf(controls, columns) +
    (here === null ? 1 : 0) + // the invitation's field
    rowsOf(titleLine, columns) +
    1 + // the row apart from the chat
    // the rows apart between the header's groups: who, the controls, the invitation, the note
    1 +
    (here === null ? 1 : 0) +
    (isHelping ? 1 : 0) +
    (isHelping ? notes.reduce((rows, text) => rows + rowsOf(text, columns), 0) : 0) +
    1 + // the field to write in
    2 // the gaps between the parts
  const rows = (e.props.scroll?.bodyRows ?? 30) - fixed
  const moves = await readChatWheel($)
  // Back no further than where the oldest messages still fill the chat: no blank above them. Scrolled back, the
  // line of the newer messages takes a row of the chat's.
  const reachIn = (room: number) => farthestBack(said, columns, room, T.gap)
  const reach = reachIn(scrolledBack(moves, reachIn(rows)) > 0 ? rows - 1 : rows)
  const back = scrolledBack(moves, reach)

  return { chat: said.slice(Math.max(0, said.length - back - CHAT_DRAWN), said.length - back), back, reach }
}

/** The pane's hooks: its drawing and its chat's scrolling. */
export function onPane(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const cannot = e.surface === 'mobile' ? T.mobile : isNativeWindows ? T.nativeWindows : undefined

    if (cannot !== undefined) {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>{cannot}</Text>
    }
    const parts = await partsOf($, e)
    const current = await readLink($)

    if (current.status === 'connecting') return connectingView($, parts, current.server)
    if (current.status === 'off') return entryView($, parts)

    return linkedView($, e, parts, current)
  })

  // While the pane shows a room, the wheel moves its chat, not the pane: the header and the controls stay.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const here = await readRoom($)

    if (here === null || (await readLink($)).status !== 'on') return next(e)
    // About one message every three rows the wheel moves; up, by < 0, goes back to older ones. How far back that
    // leads, the drawing reckons, which alone knows how much of the chat has room.
    const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by) / 3))
    const count = (await readLog($)).filter(line => line.code === here.code).length

    await updateChatWheel($, moves => wheeled(moves, -step, count))

    return {}
  })
}
