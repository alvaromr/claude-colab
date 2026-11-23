import { expect, mock, test } from 'claude-code/testing'

import {
  fresh,
  linkedAna,
  NO_NODE,
  PANE,
  ROOM,
  SERVER_UNKNOWN,
  seed,
  session,
  startable,
  statusLines,
  toasts,
  until,
  WANTED,
} from './support.ts'

test('opening a server here stops at a check of this machine’s server that fails, and says why', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  const told = toasts(on)
  const ran: string[] = []
  on('process.run', (_, e) => {
    ran.push(String(e.argv[2]))
    return { value: { ...NO_NODE, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  ran.length = 0

  await ui.press({ key: 'host' })
  await until(clock, () => told.length === 1, 'the failure told')
  expect(told).toEqual(['node: orden no encontrada'])
  expect(ran, 'nothing opened on a guess').toEqual(['status'])
  await ui.unmount()
})

test('an invitation the CLI turns down is turned down, with its reason', async ($, on) => {
  on('process.run', (_, e, next) =>
    e.argv.includes('accept')
      ? {
          value: {
            exitCode: 1,
            stdout: '',
            stderr: 'La invitación no es válida',
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        }
      : next(e),
  )
  const ran = await $.tool.call({ tool: 'mcp__colab__join', invitation: 'colab:roto' })

  expect(ran.deny ?? ran.text).toMatch(/La invitación no es válida/)
})

test('after a reload, a link connect cannot even start is let go, and the person is told why', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {}) // no inbox
  const shown = statusLines(on)
  const state: Record<string, unknown> = { ...fresh(), want: WANTED }
  seed(on, state)
  const reloaded = startable($, on)
  await reloaded.start()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()

  await clock.advance(1_000)
  await until(clock, () => state.want === null, 'let go')
  expect(state.link).toEqual({ status: 'off' })
  expect(shown).toContain(
    'Could not link again: This session has no message inbox: colab needs Claude Code 2.1.224 or later',
  )
  // Nothing brings the session back to its room: what is said fails at once.
  expect((await $.tool.call({ tool: 'mcp__colab__say', text: 'hola' })).deny).toMatch(/You are in no room/)
  await ui.unmount()
})

// What connect prints when the server turns its name down for someone connected holding it.
const NAME_TAKEN = { ev: 'error', error: 'Ya hay alguien conectado como Ana', reason: 'name-taken' }

test('a name someone else holds stops the tries, and the person is told to pick another', async ($, on) => {
  const { state, connect, clock } = session(on)
  const linking = $.tool.call({ tool: 'mcp__colab__connect', server: '192.0.2.5:4747', name: 'Ana' })

  await until(clock, () => connect.started.length === 1, 'connect started')
  connect.emit(NAME_TAKEN)
  connect.end()
  expect((await linking).deny).toMatch(/Someone on that server already uses your name/)
  expect(state.want).toBeNull()
  await until(clock, () => (state.link as { status: string }).status === 'off', 'unlinked')
  await clock.advance(120_000)
  expect(connect.started).toHaveLength(1)
})

test('a name the server turns down is not tried again, nor is a taken one asked for right after it', async ($, on) => {
  const { state, connect, clock } = session(on)
  const unlinked = () => (state.link as { status: string }).status === 'off'
  const refused = $.tool.call({ tool: 'mcp__colab__connect', server: '192.0.2.5:4747', name: 'Claude de Ana' })

  await until(clock, () => connect.started.length === 1, 'connect started')
  connect.emit({ ev: 'error', error: 'Nombre no válido: se lee como el Claude de alguien', reason: 'claude-name' })
  connect.end()
  expect((await refused).deny).toMatch(/Nombre no válido/)
  expect(state.want).toBeNull()
  await until(clock, unlinked, 'unlinked')

  const taken = $.tool.call({ tool: 'mcp__colab__connect', server: '192.0.2.5:4747', name: 'Ana' })

  await until(clock, () => connect.started.length === 2, 'connect started again')
  connect.emit(NAME_TAKEN)
  connect.end()
  expect((await taken).deny).toMatch(/Someone on that server already uses your name/)
  expect(state.want).toBeNull()
  await until(clock, unlinked, 'unlinked again')
  await clock.advance(120_000)
  expect(connect.started).toHaveLength(2)
})

test('after a drop, a taken name may be the session’s own old link: tried again for a while, then let go', async ($, on) => {
  const { state, connect, clock } = await linkedAna($, on, ['Ana', 'Bob'])

  connect.end()
  await until(clock, () => (state.link as { status: string }).status === 'connecting', 'the drop seen')
  await clock.advance(1_000)
  await until(clock, () => connect.started.length === 2, 'tried again')
  connect.emit(NAME_TAKEN)
  connect.end()
  await until(clock, () => (state.link as { status: string }).status === 'connecting', 'still trying')
  await clock.advance(2_000)
  await until(clock, () => connect.started.length === 3, 'tried once more')

  await clock.advance(60_000) // past the server's pings: whoever holds the name now is someone else
  connect.emit(NAME_TAKEN)
  connect.end()
  await until(clock, () => state.want === null, 'let go')
  expect(state.error).toMatch(/already uses your name/)
})

test('connect is started with the session’s inbox, its server is remembered, and the rules join the prompt', async ($, on) => {
  const { state, connect } = await linkedAna($, on, ['Ana', 'Bob'])

  expect(connect.started[0]).toEqual(expect.arrayContaining(['connect', '192.0.2.5:4747', '--name', 'Ana']))
  expect(state.known).toEqual([{ address: '192.0.2.5:4747', title: 'Oficina' }])
  expect(state.room).toEqual(ROOM)
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: [],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  expect(JSON.stringify(composed)).toMatch(/your turn: …/)
  // Reading the project to answer is what a room is for; what changes or reaches past it waits for the person.
  expect(JSON.stringify(composed)).toMatch(/Reading inside this session's project to answer is fine/)
  expect(JSON.stringify(composed)).toMatch(/reading credentials anywhere \(\.env, keys, tokens\) waits/)
})

test('who comes into the room or leaves it is logged once, under the heading the engine gives it', async ($, on) => {
  const logged: string[] = []
  on('ui.log', (_, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  const { connect, clock } = await linkedAna($, on, ['Ana'])

  connect.emit({ ev: 'member', ...ROOM, action: 'join', name: 'Bob' })
  connect.emit({ ev: 'member', ...ROOM, action: 'leave', name: 'Bob' })
  await until(clock, () => logged.length === 2, 'both logged')
  // The engine heads a plugin's row with the plugin's name: the mod's own would show it twice.
  expect(logged).toEqual(['Bob came into room 1', 'Bob left room 1'])
})

test('a dropped link is made again, back into the room it was in', async ($, on) => {
  const { state, connect, clock } = await linkedAna($, on, ['Ana', 'Bob'])

  connect.end()
  await until(clock, () => (state.link as { status: string }).status === 'connecting', 'the drop seen')
  await clock.advance(1_000)
  await until(clock, () => connect.started.length === 2, 'connect started again')
  expect(state.want).toEqual({ server: '192.0.2.5:4747', name: 'Ana', place: ROOM })
})

test('a link that ends asks after this machine’s server, and a check that fails is complained of', async ($, on) => {
  const { state, connect, clock, cli } = await linkedAna($, on, ['Ana', 'Bob'])

  Object.assign(cli, NO_NODE)
  connect.end()
  await until(clock, () => state.error === SERVER_UNKNOWN, 'the failed check complained of')
})
