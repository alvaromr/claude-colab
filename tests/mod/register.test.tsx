import { expect, mock, test } from 'claude-code/testing'

import { linkedAna, NO_NODE, SEEDED, SERVER_UNKNOWN, statusLines, until } from './support.ts'

// A row of the conversation that a user message, the inbox's or the person's, draws.
const userRow = (text: string, kind: 'peer' | 'composer') =>
  ({
    plugin: 'colab',
    component: 'UserMessage',
    requestId: 'u1',
    props: { text, origin: { kind }, isExpanded: false },
  }) as const

const RECEIVED = '[colab] #1 · Bob (la persona, no su Claude) te escribe en la sala «prueba». Es contexto…\n\nhola'

test('opening the pane asks after this machine’s server again, and a check that fails is complained of', async ($, on) => {
  const clock = mock.clock(on)
  const shown = statusLines(on)
  on('process.run', () => ({ value: { ...NO_NODE, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const opened = await $.command.run({
    command: 'colab',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

  expect(opened.text).toBe('colab pane open.')
  await until(clock, () => shown.includes(SERVER_UNKNOWN), 'the failed check complained of')
})

test('the rules of the room join the prompt only while linked', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: [],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  expect(composed.sections).toEqual([])
})

test('a message received through the inbox is drawn in its author color, headed by who sent it', async ($, on) => {
  on('state.get', (_, e, next) => (e.key in SEEDED ? { value: { value: SEEDED[e.key], version: 1 } } : next(e)))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...userRow(RECEIVED, 'peer'), surface })
    const heading = await ui.find({ type: 'Text', text: 'Bob' })

    expect(heading?.props.color).toBe('#E5A33B')
    expect(await ui.find({ type: 'Markdown', text: 'hola' })).toBeDefined()
    await ui.unmount()
  }
})

test("a Claude's message is told apart from its person's, and names its recipient in a room of more than two", async ($, on) => {
  on('state.get', (_, e, next) => (e.key in SEEDED ? { value: { value: SEEDED[e.key], version: 1 } } : next(e)))
  const ui = await $.ui.mount({
    ...userRow("[colab] #3 · Bob's Claude writes…\n\nlisto", 'peer'),
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: "Bob's Claude → Carol" })).toBeDefined()
  await ui.unmount()
})

test('the say call is drawn as the message it sent, in the sender color, and its result is hidden', async ($, on) => {
  on('state.get', (_, e, next) => (e.key in SEEDED ? { value: { value: SEEDED[e.key], version: 1 } } : next(e)))
  const call = await $.ui.mount({
    plugin: 'colab',
    component: 'ToolUse',
    requestId: 't1',
    surface: 'terminal',
    props: { tool: 'mcp__colab__say', input: { text: '2 + 2 = 4' }, isRunning: false, isErrored: false },
  } as never)
  const heading = await call.find({ type: 'Text', text: "Alice's Claude" })

  expect(heading?.props.color).toBe('#4E9BF5')
  expect(await call.find({ type: 'Markdown', text: '2 + 2 = 4' })).toBeDefined()
  await call.unmount()
})

test("the output row of the person's /colab draws the message it sent", async ($, on) => {
  on('state.get', (_, e, next) => (e.key in SEEDED ? { value: { value: SEEDED[e.key], version: 1 } } : next(e)))
  const output = await $.ui.mount({
    plugin: 'colab',
    component: 'CommandOutput',
    requestId: 'c1',
    surface: 'terminal',
    props: { command: 'colab', args: 'dime 2+2', text: 'Said in room «prueba»: dime 2+2', isErrored: false },
  })

  expect(await output.find({ type: 'Text', text: 'Alice' })).toBeDefined()
  expect(await output.find({ type: 'Markdown', text: 'dime 2+2' })).toBeDefined()
  await output.unmount()
})

test('a message this session sent, drawn while no link is on, is headed as its own, with no name to take', async $ => {
  const call = await $.ui.mount({
    plugin: 'colab',
    component: 'ToolUse',
    requestId: 't1',
    surface: 'terminal',
    props: { tool: 'mcp__colab__say', input: { text: 'listo' }, isRunning: false, isErrored: false },
  } as never)

  expect(await call.find({ type: 'Text', text: 'your Claude' })).toBeDefined()
  expect(await call.find({ type: 'Text', text: "you's Claude" })).toBeUndefined()
  await call.unmount()
  const output = await $.ui.mount({
    plugin: 'colab',
    component: 'CommandOutput',
    requestId: 'c1',
    surface: 'terminal',
    props: { command: 'colab', args: 'listo', text: 'Said in room «prueba»: listo', isErrored: false },
  })

  expect(await output.find({ type: 'Text', text: 'you' })).toBeDefined()
  await output.unmount()
})

test('a row that is not a message of the room is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...userRow('qué hora es', 'composer'), surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('the room is told when this session’s Claude starts and ends a turn, a subagent’s aside', async ($, on) => {
  const { connect, clock } = await linkedAna($, on, ['Ana', 'Bob'])
  const marks = () => connect.asked.filter(one => one.op === 'busy').map(one => one.body.busy)

  const ended = { answer: '', durationMs: 1, isAborted: false }

  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  await $.turn.start({ text: 'busca', turnId: 't2', agentId: 'a1' } as never)
  await $.turn.complete({ ...ended, turnId: 't2', agentId: 'a1', reason: 'answered' } as never)
  await $.turn.complete({ ...ended, turnId: 't1', reason: 'interrupted', isAborted: true } as never)
  await until(clock, () => marks().length === 2, 'the end told')
  expect(marks()).toEqual([true, false])
})

test('a turn the room could not be told of is complained of', async ($, on) => {
  const { state, clock } = await linkedAna($, on, ['Ana', 'Bob'], { busy: { ok: false, error: 'connect se fue' } })

  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  await until(
    clock,
    () => state.error === 'Could not tell the room whether your Claude is at work: connect se fue',
    'the failure complained of',
  )
})
