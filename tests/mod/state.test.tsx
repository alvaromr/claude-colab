import { expect, test } from 'claude-code/testing'

import { PANE, SEEDED, seed } from './support.ts'

test('this machine’s own server is one at any of its addresses: its rooms left are there to go back to', async ($, on) => {
  const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(24))
  const state: Record<string, unknown> = {
    ...SEEDED,
    link: { status: 'on', server: '127.0.0.1:4747', title: 'Portátil', name: 'Ana', color: 0, socket: '/tmp/s.sock' },
    room: { code: A, label: '1' },
    want: { server: '127.0.0.1:4747', name: 'Ana', place: { code: A, label: '1' } },
    hosted: { shape: 'hosted-2', value: { address: '0.0.0.0:4747', title: 'Portátil', addresses: ['192.0.2.5'] } },
    recent: [
      { server: '192.0.2.5:4747', code: A, label: '1' },
      { server: '192.0.2.5:4747', code: B, label: '2' },
      { server: '192.0.2.5:4800', code: C, label: '3' },
      { server: '192.0.2.9:4747', code: D, label: '4' },
    ],
  }
  seed(on, state)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'leave' })
  expect(state.recent, 'one entry a room, whichever address it was left by').toEqual([
    { server: '127.0.0.1:4747', code: A, label: '1' },
    { server: '192.0.2.5:4747', code: B, label: '2' },
    { server: '192.0.2.5:4800', code: C, label: '3' },
    { server: '192.0.2.9:4747', code: D, label: '4' },
  ])
  await ui.unmount()
  const out = await $.ui.mount({ ...PANE, surface: 'terminal' })

  for (const code of [A, B]) expect(await out.find({ key: `recent:${code}` }), code).toBeDefined()
  expect(await out.find({ key: `recent:${C}` }), 'another port is another server').toBeUndefined()
  expect(await out.find({ key: `recent:${D}` }), 'another machine is another server').toBeUndefined()
  await out.unmount()
})
