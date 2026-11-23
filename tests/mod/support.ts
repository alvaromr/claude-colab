// What the mod's tests share: the fixtures, and the helpers that play the engine and connect for them.
import { expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

export const PANE = {
  plugin: 'colab',
  component: 'Pane',
  requestId: 'colab',
  props: {
    title: 'Colab',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// The room the seeded session is in: its code is what it is, its label only what people read.
export const CODE = 'p'.repeat(24)
export const HERE = { code: CODE, label: 'prueba' }

// What the rows draw their messages from: the link, the room, the colors and the log, by number.
export const SEEDED: Record<string, unknown> = {
  link: { status: 'on', server: '127.0.0.1:47470', name: 'Alice', color: 0, socket: '/tmp/s.sock' },
  room: HERE,
  want: { server: '127.0.0.1:47470', name: 'Alice', place: HERE },
  rooms: [{ ...HERE, members: ['Alice', 'Bob'] }],
  colors: { Alice: 0, Bob: 1 },
  log: [
    { n: 1, ...HERE, from: 'Bob', by: 'person', text: 'hola', own: false },
    { n: 3, code: 't'.repeat(24), label: 'trío', from: 'Bob', by: 'claude', to: 'Carol', text: 'listo', own: false },
  ],
}

/** A message of the seeded room, by Bob. */
export const fromBob = (n: number, text: string) => ({
  n,
  ...HERE,
  from: 'Bob',
  by: 'person',
  text,
  own: false,
})

/** Answers the plugin's state from `values`, by key, and takes its writes there, versioned as the engine does. */
export function seed(on: Parameters<TestBody>[1], values: Record<string, unknown>) {
  const versions: Record<string, number> = {}
  on('state.get', (_, e, next) =>
    e.key in values ? { value: { value: values[e.key], version: versions[e.key] ?? 1 } } : next(e),
  )
  on('state.set', (_, e, next) => {
    if (!(e.key in values)) return next(e)
    const now = versions[e.key] ?? 1

    if (e.ifVersion !== undefined && e.ifVersion !== now) return { value: { isSet: false, version: now } }
    values[e.key] = e.value
    versions[e.key] = now + 1

    return { value: { isSet: true, version: now + 1 } }
  })
}

/** The texts of the toasts the plugin raises, as the test's hook beneath it takes them. */
export function toasts(on: Parameters<TestBody>[1]) {
  const told: string[] = []
  on('ui.toast', (_, e) => {
    told.push(e.text)

    return { value: undefined }
  })

  return told
}

// What the CLI answers on a machine where it cannot run, and what the mod pins on its status line then.
export const NO_NODE = { exitCode: 127, stdout: '', stderr: 'node: orden no encontrada' }
export const SERVER_UNKNOWN = 'Could not tell whether this machine has a server: node: orden no encontrada'

/** The lines the mod pins on its status line, as the test's hook beneath it takes them. */
export function statusLines(on: Parameters<TestBody>[1]) {
  const shown: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    shown.push(e.text)
    return { value: undefined }
  })

  return shown
}

/** Lets the event loop settle, a few times at most, until `isIt()` holds. */
export async function until(clock: ReturnType<typeof mock.clock>, isIt: () => boolean, why: string) {
  for (let tries = 0; tries < 50; tries++) {
    if (isIt()) return
    await clock.settle()
  }
  throw new Error(`Nunca pasó: ${why}`)
}

/**
 * The connect process, played by the test: `emit` makes it print an event and `end` makes it exit; `started` holds
 * the argv of each start. The requests to its local socket are answered by `answers`, by op, and kept in `asked`.
 */
export function fakeConnect(on: Parameters<TestBody>[1], answers: Record<string, Record<string, unknown>> = {}) {
  const queue: string[] = []
  const started: string[][] = []
  const asked: { op: string; body: Record<string, unknown> }[] = []
  let wake: () => void = () => undefined
  let isEnded = false

  on('process.spawn', async function* (_, e) {
    started.push([...e.argv])
    isEnded = false // each start is a process of its own, which `end` ends
    for (;;) {
      while (queue.length > 0) yield { stream: 'stdout' as const, text: `${queue.shift()}\n` }
      if (isEnded) return { value: { code: 1, signal: null } }
      await new Promise<void>(resolve => (wake = resolve))
    }
  })
  on('http.fetch', (_, e) => {
    const op = e.url.split('/').pop() ?? ''

    asked.push({ op, body: JSON.parse(String(e.init?.body ?? '{}')) as Record<string, unknown> })

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answers[op] ?? { ok: true }) } }
  })

  return {
    started,
    asked,
    emit(event: Record<string, unknown>) {
      queue.push(JSON.stringify(event))
      wake()
    },
    end() {
      isEnded = true
      wake()
    },
  }
}

/** State as a fresh session holds it, in an object the test reads. */
export const fresh = (): Record<string, unknown> => ({
  link: { status: 'off' },
  rooms: [],
  room: null,
  want: null,
  log: [],
  colors: {},
  known: [],
  error: null,
  recent: [],
})

export const ROOM = { code: 'r'.repeat(24), label: '1' }

// The link a session had asked for before a reload: to a server, back into a room.
export const WANTED = { server: '192.0.2.5:4747', name: 'Ana', place: { code: 'c'.repeat(24), label: '1' } }

/**
 * A session linked to 192.0.2.5:4747 as Ana, through the connect tool, and in room 1 with `members`; connect gives
 * `answers` too, by request.
 */
export async function linkedAna(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  members: string[],
  answers: Record<string, Record<string, unknown>> = {},
) {
  const linked = session(on, answers)
  const { state, connect, clock } = linked
  const linking = $.tool.call({ tool: 'mcp__colab__connect', server: '192.0.2.5:4747', name: 'Ana' })

  await until(clock, () => connect.started.length === 1, 'connect started')
  connect.emit({
    ev: 'connected',
    name: 'Ana',
    color: 0,
    server: '192.0.2.5:4747',
    title: 'Oficina',
    socket: '/home/ana/.claude-colab/s-1.sock',
    rooms: [],
  })
  expect((await linking).result).toMatch(/Connected to «Oficina» \(192\.0\.2\.5:4747\) as Ana/)
  expect((await $.tool.call({ tool: 'mcp__colab__create' })).result).toMatch(/Made room 1/)
  connect.emit({ ev: 'rooms', rooms: [{ ...ROOM, members }] })
  await until(clock, () => (state.rooms as unknown[]).length === 1, 'the rooms pushed')

  return linked
}

/**
 * What the engine answers the mod's start, with the commands it registers kept in `registered`, and `start`, which
 * starts the session as the engine does at each load of the mod, a reload included. Called before the test's first
 * call on `$`, as hooks must be.
 */
export function startable($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const registered: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))

  return {
    registered,
    start: () => $.session.start({ cwd: '/home/ana/project', surface: 'terminal', isInteractive: true }),
  }
}

/**
 * A fresh session with an inbox, its connect played by the test and giving `answers` too, and what it appends to the
 * conversation kept. `cli` is what the CLI answers, which the test may change.
 */
export function session(on: Parameters<TestBody>[1], answers: Record<string, Record<string, unknown>> = {}) {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('prompt.compose', () => ({ sections: [] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // This machine's server, which the mod asks after when a link ends: none.
  const cli = { exitCode: 0, stdout: '{"ok":true,"running":false,"machine":"equipo"}', stderr: '' }
  on('process.run', () => ({ value: { ...cli, isStdoutTruncated: false, isStderrTruncated: false } }))
  mock.env(on, { CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/inbox.sock', HOME: '/home/ana' })
  const state = fresh()
  seed(on, state)
  const appended: string[] = []
  // Why the conversation turns down what the mod appends, once the test says it does.
  const appending: { deny?: string } = {}
  on('session.append', (_, e, next) => {
    const [block] = e.message.content

    appended.push(block?.type === 'text' ? String(block.text) : '')

    return appending.deny === undefined ? next(e) : { deny: appending.deny }
  })
  const connect = fakeConnect(on, { create: { ok: true, ...ROOM, members: ['Ana'] }, ...answers })

  return { state, connect, appended, appending, clock, cli }
}
