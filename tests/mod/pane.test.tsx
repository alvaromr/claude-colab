import { expect, mock, test } from 'claude-code/testing'

import { fromBob, HERE, PANE, SEEDED, seed, statusLines, toasts, until } from './support.ts'

test('unlinked, the pane offers both ways in: an invitation, or opening a server here', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: 'Go into a room' })).toBeDefined()
    expect(await ui.find({ key: 'invitation' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Open a server here' })).toBeDefined()
    expect(await ui.find({ key: 'host' })).toBeDefined()
    await ui.unmount()
  }
})

test('the servers joined before are listed by name, one press away; this machine’s own shows apart', async ($, on) => {
  const state: Record<string, unknown> = {
    known: [
      { address: '192.0.2.5:4747', title: 'Oficina' },
      { address: '198.51.100.20:4747', title: 'Portátil' },
    ],
    hosted: { shape: 'hosted-2', value: { address: '0.0.0.0:4747', title: 'Portátil', addresses: ['198.51.100.20'] } },
  }
  on('state.get', (_, e, next) => (e.key in state ? { value: { value: state[e.key], version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'known:192.0.2.5:4747' })).toBeDefined()
  expect(await ui.find({ key: 'known:198.51.100.20:4747' }), 'its own, by its network address').toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Your server «Portátil» listens on 0\.0\.0\.0:4747/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Your server$/ }), 'said once').toBeUndefined()
  expect(await ui.find({ key: 'stop-serving' })).toBeDefined()
  expect(await ui.find({ key: 'title' })).toBeUndefined()
  await ui.unmount()
})

test('the notes hide behind the i button, which shows them and hides them again', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const nameNote = { type: 'Text', text: /How the others see you/ } as const

  expect(await ui.find(nameNote)).toBeUndefined()
  await ui.press({ key: 'help' })
  expect(await ui.find(nameNote)).toBeDefined()
  await ui.press({ key: 'help' })
  expect(await ui.find(nameNote)).toBeUndefined()
  await ui.unmount()
})

test('the wheel moves the chat alone, back to older messages, while the header and controls stay', async ($, on) => {
  const state: Record<string, unknown> = {
    ...SEEDED,
    link: { ...(SEEDED.link as object), title: 'Oficina' },
    log: Array.from({ length: 6 }, (_, i) => fromBob(i + 1, `mensaje ${i + 1}`)),
  }
  on('state.get', (_, e, next) => (e.key in state ? { value: { value: state[e.key], version: 1 } } : next(e)))
  // What the engine raises for the wheel, three rows up over the pane: the kit hands it on as given.
  const wheel = { component: 'Pane', requestId: PANE.requestId, offset: 0, by: -3 }
  on('ui.scroll', () => ({}))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Markdown', text: 'mensaje 6' })).toBeDefined()
  await $.ui.scroll(wheel as never)
  expect(await ui.find({ type: 'Markdown', text: 'mensaje 6' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: 'mensaje 5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↓ 1 newer message: scroll down with the wheel' })).toBeDefined()
  expect(await ui.find({ key: 'leave' })).toBeDefined()
  expect(await ui.find({ key: 'say' })).toBeDefined()
  await ui.unmount()
})

test('scrolled back as far as it goes, the chat holds to its oldest message, whole at the top', async ($, on) => {
  const state: Record<string, unknown> = {
    ...SEEDED,
    log: Array.from({ length: 20 }, (_, i) => fromBob(i + 1, `mensaje ${i + 1}`)),
  }
  on('state.get', (_, e, next) => (e.key in state ? { value: { value: state[e.key], version: 1 } } : next(e)))
  on('ui.scroll', () => ({}))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const anchors = async () => (await ui.findAll({ type: 'Box' })).map(box => box.props.justifyContent)

  expect(await anchors()).toContain('flex-end')
  await $.ui.scroll({ component: 'Pane', requestId: PANE.requestId, offset: 0, by: -99 } as never)
  expect(await ui.find({ type: 'Markdown', text: 'mensaje 1' })).toBeDefined()
  expect(await anchors()).toContain('flex-start')
  expect(await anchors()).not.toContain('flex-end')
  await ui.unmount()
})

test('the chat does not scroll back past its oldest message: no blank above it', async ($, on) => {
  const state: Record<string, unknown> = {
    ...SEEDED,
    link: { ...(SEEDED.link as object), title: 'Oficina' },
    log: [1, 2].map(n => fromBob(n, `mensaje ${n}`)),
  }
  on('state.get', (_, e, next) => (e.key in state ? { value: { value: state[e.key], version: 1 } } : next(e)))
  on('ui.scroll', () => ({}))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.ui.scroll({ component: 'Pane', requestId: PANE.requestId, offset: 0, by: -9 } as never)
  expect(await ui.find({ type: 'Markdown', text: 'mensaje 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /newer message/ })).toBeUndefined()
  await ui.unmount()
})

test('on a server with no room: the rooms left there to go back to, and on this machine’s own, closing it', async ($, on) => {
  const told = toasts(on)
  const [A, B] = ['a'.repeat(24), 'b'.repeat(24)]
  const state: Record<string, unknown> = {
    link: { status: 'on', server: '127.0.0.1:4747', title: 'Portátil', name: 'Ana', color: 0, socket: '/tmp/s.sock' },
    room: null,
    // A line an older version kept, with no room's code: out of a room, no chat shows it.
    log: [{ n: 1, label: '1', from: 'Bob', by: 'person', text: 'de antes', own: false }],
    hosted: { shape: 'hosted-2', value: { address: '0.0.0.0:4747', title: 'Portátil', addresses: [] } },
    recent: [
      { server: '127.0.0.1:4747', code: A, label: '1' },
      { server: '192.0.2.5:4747', code: B, label: '2' },
    ],
  }
  seed(on, state)
  // The server started over: the room is not there to join, and its number is someone else's label now, so making
  // it again under its code gives it another.
  const asked: string[] = []
  on('http.fetch', (_, e) => {
    asked.push(`${e.url.split('/').pop()} ${String(e.init?.body ?? '')}`)
    const answer = e.url.endsWith('/join')
      ? { ok: false, error: 'Invitación no válida: la sala ya no existe' }
      : { ok: true, code: A, label: '7', members: ['Ana'] }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  for (const key of ['disconnect', 'new-room', 'invitation', 'stop-serving', `recent:${A}`]) {
    expect(await ui.find({ key }), key).toBeDefined()
  }
  expect(await ui.find({ key: `recent:${B}` }), 'a room of another server').toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: 'de antes' }), 'no chat out of a room').toBeUndefined()

  await ui.press({ key: `recent:${A}` })
  expect(asked).toEqual([`join {"code":"${A}"}`, `create {"code":"${A}"}`])
  expect(told).toContain('Made room 7; you are in. For someone to come in, pass them its invitation')
  expect(state.room).toEqual({ code: A, label: '7' })
  expect(state.recent, 'back in, it leaves the list').toEqual([{ server: '192.0.2.5:4747', code: B, label: '2' }])
  await ui.unmount()
})

test('the pane says the mobile app draws no fields', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })

  expect(await ui.find({ type: 'Text', text: /draws no fields/ })).toBeDefined()
  await ui.unmount()
})

test('a field keeps what it turned down, for the person to mend, until it takes something', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  toasts(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = async (key: string) => (await ui.find({ key }))?.props.value

  await ui.input({ key: 'invitation', text: 'hola' })
  await ui.input({ key: 'name', text: 'Carol!' })
  expect([await shown('invitation'), await shown('name')]).toEqual(['hola', 'Carol!'])

  await ui.input({ key: 'name', text: 'Carol' })
  expect([await shown('invitation'), await shown('name')]).toEqual(['hola', 'Carol'])
  await ui.unmount()
})

test('what the pane could not send stays in its field, to send again', async ($, on) => {
  const clock = mock.clock(on)
  const told = toasts(on)
  seed(on, { ...SEEDED })
  const refused = { ok: false, error: 'No connect is listening on /tmp/s.sock' }
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(refused) } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.input({ key: 'say', text: 'mirad esto' })
  await until(clock, () => told.length === 1, 'the failure told')
  expect(told).toEqual([refused.error])
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await again.find({ key: 'say' }))?.props.value).toBe('mirad esto')
  await again.unmount()
})

test('a field takes what it asks for on Enter, and a toast says what it expects otherwise', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const told = toasts(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.input({ key: 'invitation', text: 'hola' })
  await ui.input({ key: 'port', text: '99999' })
  await ui.input({ key: 'name', text: '¿quién?' })
  expect(told).toEqual([
    'A colab invitation: the whole text, which starts with colab:',
    'A whole number from 1 to 65535; empty, 4747',
    'Letters, digits, spaces and . _ -, up to 40, without mixing the Latin, Greek and Cyrillic scripts; empty, your user',
  ])

  await ui.input({ key: 'port', text: '4800' })
  expect((await ui.find({ key: 'port' }))?.props.value).toBe('4800')
  await ui.unmount()
})

test('a press of the pane whose work breaks says so in a toast', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  const told = toasts(on)
  statusLines(on)
  // Nothing answers process.run: running the CLI throws.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()

  await ui.press({ key: 'host' })
  await until(clock, () => told.length === 1, 'the failure told')
  expect(told[0]).toMatch(/no implementation for process\.run/)
  await ui.unmount()
})

test("the pane shows the room's chat, both ways, each name in its color", async ($, on) => {
  const state: Record<string, unknown> = {
    ...SEEDED,
    log: [
      fromBob(1, '¿qué puerto?'),
      { n: 2, ...HERE, from: 'Alice', by: 'claude', text: 'el 4747', own: true },
      { n: 3, code: 'o'.repeat(24), label: 'otra', from: 'Bob', by: 'person', text: 'de otra sala', own: false },
      // Another room under the same name: another server's, or one made after the server started over.
      { ...fromBob(4, 'de otra sala «prueba»'), code: 'x'.repeat(24) },
      { n: 5, ...HERE, from: '', by: 'person', text: '', own: false, gap: true },
    ],
  }
  on('state.get', (_, e, next) => (e.key in state ? { value: { value: state[e.key], version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: 'Chat of room «prueba»' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · in: Alice, Bob' })).toBeDefined()
  expect(await ui.find({ key: 'invite' })).toBeDefined()
  expect(await ui.find({ key: 'leave' })).toBeDefined()
  // In a room the pane is its chat: no way to other rooms or servers there.
  for (const key of ['disconnect', 'new-room', 'invitation', 'stop-serving']) {
    expect(await ui.find({ key }), key).toBeUndefined()
  }
  expect((await ui.findAll({ type: 'Text', text: 'Bob' })).map(found => found.props.color)).toContain('#E5A33B')
  expect(await ui.find({ type: 'Markdown', text: /el 4747/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: "Alice's Claude" })).toBeDefined()
  expect(
    await ui.find({ type: 'Markdown', text: /de otra sala/ }),
    'a room of the same name is another',
  ).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /you are back/ }), 'a return is marked').toBeDefined()
  expect(await ui.find({ key: 'say' })).toBeDefined()
  await ui.unmount()
})

test('the pane shows whose Claude is at work, its own aside', async ($, on) => {
  const state: Record<string, unknown> = {
    ...SEEDED,
    rooms: [{ ...HERE, members: ['Alice', 'Bob'], busy: ['Alice', 'Bob'] }],
  }
  on('state.get', (_, e, next) => (e.key in state ? { value: { value: state[e.key], version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^ · Bob's Claude at work…$/ }))?.props.color).toBe('#E5A33B')
  expect(await ui.find({ type: 'Text', text: /Alice's Claude at work/ })).toBeUndefined()
  await ui.unmount()
})
