import { expect, test } from 'claude-code/testing'

import { CODE, fromBob, HERE, linkedAna, PANE, ROOM, SEEDED, seed } from './support.ts'

test('going back into a room leaves the chat as it was: what was said away comes with the room’s history', async ($, on) => {
  const state: Record<string, unknown> = {
    ...SEEDED,
    room: null,
    want: { server: '127.0.0.1:47470', name: 'Alice', place: null },
    recent: [{ server: '127.0.0.1:47470', ...HERE }],
    log: [fromBob(1, 'hola')],
  }
  seed(on, state)
  const joined = JSON.stringify({ ok: true, ...HERE, members: ['Alice'] })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: joined } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: `recent:${CODE}` })
  expect(state.room).toEqual(HERE)
  expect(state.log).toEqual([fromBob(1, 'hola')])
  await ui.unmount()
})

test('a room the server was not told of leaving is still the room, there and in the pane', async ($, on) => {
  const { state, connect } = await linkedAna($, on, ['Ana', 'Bob'], { leave: { ok: false, error: 'connect se fue' } })

  expect((await $.tool.call({ tool: 'mcp__colab__leave' })).deny).toBe('connect se fue')
  expect((await $.tool.call({ tool: 'mcp__colab__create' })).deny, 'nor is another made').toBe('connect se fue')
  expect(state.room).toEqual(ROOM)
  expect(state.recent).toEqual([])
  expect(connect.asked.filter(one => one.op === 'create')).toHaveLength(1)
})
