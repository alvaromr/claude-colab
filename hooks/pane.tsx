import type { On, ResolveInput } from 'claude-code'

import { DEFAULT_PORT, isName } from '../cli/protocol.mts'
import type { Line, Setup } from '../types'
import {
  acceptInvitation,
  connect,
  copyInvitation,
  create,
  disconnect,
  hostHere,
  leave,
  rejoinRecent,
  sayFromPane,
} from './link.ts'
import { closeServer, machine } from './server.ts'
import { ensureStarted } from './session.ts'
import {
  type Answer,
  type Engine,
  isOwn,
  isSameServer,
  readChatBack,
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
  updateChatBack,
  updateHelp,
  updateSetup,
  updateTurnedDown,
} from './state.ts'

export const PANE = 'colab'
export const TITLE = 'Colab'
// How many of the messages the pane's chat keeps it draws at most: those that fit its height show.
const CHAT_DRAWN = 40
// One per person, by the number the server gives each connection: distinct while there are no more people than colors.
const COLORS = ['#4E9BF5', '#E5A33B', '#4CB782', '#C678DD', '#E06C75', '#2BB5C2', '#D4B83A', '#9C8BF0']
const colorOf = (n: number | undefined) =>
  n === undefined ? 'suggestion' : (COLORS[n % COLORS.length] ?? 'suggestion')

// How far back the chat may scroll, as the last drawing of the pane measured it; the wheel stops there.
let chatReach = 0

/** How a message's author is named: the person by their name, their Claude as theirs. */
const authorOf = (line: Pick<Line, 'from' | 'by'>) => (line.by === 'claude' ? T.claudeOf(line.from) : line.from)

/** About how many rows `text` takes wrapped at `columns`, each of its lines on its own. */
const rowsOf = (text: string, columns: number) =>
  text.split('\n').reduce((rows, part) => rows + Math.max(1, Math.ceil(part.length / Math.max(1, columns))), 0)

/**
 * How many of the newest messages the chat may scroll past and still have the older ones fill its `rows`: a box
 * takes its borders, its author's line and its text, wrapped inside its borders and padding, and a row apart.
 */
function farthestBack(lines: Line[], columns: number, rows: number) {
  let filled = 0

  for (const [shown, line] of lines.entries()) {
    filled += (shown === 0 ? 0 : 1) + (line.gap ? rowsOf(T.gap, columns) : 3 + rowsOf(line.text, columns - 4))
    if (filled >= rows) return lines.length - shown - 1
  }

  return 0
}

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

/** Confirms or turns down an action of the pane in a toast, which goes by itself. */
async function report($: Engine, pending: Promise<Answer>) {
  const answer = await pending
  const told = answer.ok ? answer.text : (answer.error ?? T.failed)

  if (told !== undefined) await $.ui.toast(told)
}

/** What the person typed in the pane's fields: kept for this session and the next ones. */
async function changeSetup($: Engine, patch: Partial<Setup>) {
  await updateSetup($, s => ({ ...s, ...patch }))
  await $.store.set('setup', await readSetup($))
}

/** The pane's hooks: its drawing, which first makes sure the session started, and its chat's scrolling. */
export function onPane(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>{T.mobile}</Text>
    }
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    ensureStarted($)
    const current = await readLink($)
    const server = await readHosted($)
    const isHelping = await readHelp($)
    // The notes say what each part does: they take room, so the button i shows and hides them all.
    const note = (text: string) => (isHelping ? <Text dimColor>{text}</Text> : null)
    const info = (
      <Button key="help" plain dimColor={!isHelping} onPress={() => void updateHelp($, shown => !shown)}>
        {isHelping ? T.hideHelp : 'i'}
      </Button>
    )
    const kept = await readTurnedDown($)
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
        <Box backgroundColor={e.surface === 'terminal' ? 'subtle' : undefined}>
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
    const typed = await readSetup($)
    const invitationField = (
      <Box flexDirection="column">
        {field('invitation', T.invitation, '', T.invitationHint, value => {
          if (!value.startsWith('colab:')) return T.notAnInvitation
          void report($, acceptInvitation($, value, typed.name))

          return undefined
        })}
        {note(T.invitationNote)}
      </Box>
    )

    if (current.status === 'connecting') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{T.connecting(current.server)}</Text>
          <Button key="cancel" onPress={() => void report($, disconnect($))}>
            {T.cancel}
          </Button>
          {serving}
        </Box>
      )
    }

    if (current.status === 'off') {
      const servers = (await readKnown($)).filter(one => !isOwn(one.address, server))

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold>{T.enterRoom}</Text>
            {info}
          </Box>
          {field('name', T.yourName, typed.name, T.yourNameHint, value => {
            if (value !== '' && !isName(value)) return T.yourNameRule
            void changeSetup($, { name: value })

            return undefined
          })}
          {note(T.yourNameNote)}
          {invitationField}
          {servers.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor>{T.knownServers}</Text>
              {note(T.knownServersNote)}
              {servers.map(one => (
                <Button
                  key={`known:${one.address}`}
                  onPress={() => void report($, connect($, one.address, typed.name))}
                >
                  {`${one.title} · ${one.address}`}
                </Button>
              ))}
            </Box>
          )}
          {server === null && <Text bold>{T.openHere}</Text>}
          {server === null &&
            field('title', T.serverName, typed.title, machine ?? T.serverNameHint, value => {
              if (value !== '' && !isName(value)) return T.serverNameRule
              void changeSetup($, { title: value })

              return undefined
            })}
          {server === null &&
            field('port', T.port, typed.port, String(DEFAULT_PORT), value => {
              const number = Number(value)

              if (value !== '' && (!Number.isInteger(number) || number < 1 || number > 65535)) return T.portRule
              void changeSetup($, { port: value })

              return undefined
            })}
          {server === null && note(T.openNote)}
          {serving}
          <Button key="host" variant="primary" onPress={() => void report($, hostHere($, typed))}>
            {server === null ? T.openServer : T.linkMine}
          </Button>
        </Box>
      )
    }

    const here = await readRoom($)
    const mine = (await readRooms($)).find(one => one.code === here?.code)
    const inside = mine?.members ?? []
    // The others' Claudes at work: this session's own is in sight in its conversation.
    const working = (mine?.busy ?? []).filter(name => name !== current.name)
    const painted = await readColors($)
    // Out of a room there is no chat: no line of the log goes by a room that is not there.
    const said = here === null ? [] : (await readLog($)).filter(line => line.code === here.code)
    const columns = e.props.bodyColumns
    const notes = [
      here === null ? T.disconnectNote : T.leaveNote,
      here === null ? T.newRoomNote : T.inviteNote,
      T.alsoNote,
    ]
    const left = (await readRecent($)).filter(one => isSameServer(one.server, current.server, server))
    // In a room the pane is its chat: the way in and out of rooms and servers is the pane's without one.
    const controls =
      here === null ? `[ ${T.disconnect} ] [ ${T.newRoom} ]` : `[ ${T.copyInvitation} ] [ ${T.leaveRoom} ]`
    const heading = `● ${T.whereAmI(current.name, current.title, current.server)} i`
    const titleLine =
      here === null
        ? T.noRoomYet
        : T.chatOf(here.label) + T.inRoom(inside.join(', ')) + working.map(name => T.atWork(name)).join('')
    // The rows of everything but the chat, as the pane wraps them: the chat takes the rest of the body's height.
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
      ((await readChatBack($)) > 0 ? 1 : 0) + // the line of the newer messages
      2 // the gaps between the parts
    const height = e.props.scroll?.bodyRows ?? 30
    // Back no further than where the oldest messages still fill the chat: no blank above them.
    const reach = farthestBack(said, columns, height - fixed)
    const back = Math.min(await readChatBack($), reach)
    const chat = said.slice(Math.max(0, said.length - back - CHAT_DRAWN), said.length - back)

    chatReach = reach
    // The pane takes its body's height exactly, so it never scrolls as a whole: the header and its controls stay on
    // top, the field to write in at the bottom, and the chat between them scrolls by itself (the ui.scroll hook).
    return (
      <Box flexDirection="column" height={height} rowGap={1}>
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
  })

  // While the pane shows a room, the wheel moves its chat, not the pane: the header and the controls stay.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const here = await readRoom($)

    if (here === null || (await readLink($)).status !== 'on') return next(e)
    // About one message every three rows the wheel moves; up, by < 0, goes back to older ones, as far as the last
    // drawing found room for.
    const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by) / 3))

    await updateChatBack($, back => Math.min(Math.max(0, back - step), chatReach))

    return {}
  })
}
