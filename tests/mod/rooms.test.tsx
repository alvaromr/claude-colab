import { expect, test } from 'claude-code/testing'

import { CODE, fromBob, HERE, linkedAna, PANE, ROOM, SEEDED, seed } from './support.ts'

test('going back into a room marks where: what was said away never came', async ($, on) => {
  const state: Record<string, unknown> = {
    ...SEEDED,
    room: null,
    want: { server: '127.0.0.1:47470', name: 'Alice', place: null },
    recent: [{ server: '127.0.0.1:47470', ...HERE }],
  }
  seed(on, state)
  const joined = JSON.stringify({ ok: true, ...HERE, members: ['Alice'] })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: joined } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: `recent:${CODE}` })
  expect((state.log as { code: string; gap?: true }[]).at(-1)).toMatchObject({ code: CODE, gap: true })
  await ui.unmount()
})

test('going back again with nothing said in between keeps the one mark there is', async ($, on) => {
  const marked = [fromBob(1, 'hola'), { n: 2, ...HERE, from: '', by: 'person', text: '', own: false, gap: true }]
  const state: Record<string, unknown> = {
    ...SEEDED,
    room: null,
    want: { server: '127.0.0.1:47470', name: 'Alice', place: null },
    recent: [{ server: '127.0.0.1:47470', ...HERE }],
    log: marked,
  }
  seed(on, state)
  const joined = JSON.stringify({ ok: true, ...HERE, members: ['Alice'] })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: joined } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: `recent:${CODE}` })
  expect(state.room).toEqual(HERE)
  expect(state.log).toEqual(marked)
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
