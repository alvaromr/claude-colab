import { expect, mock, test } from 'claude-code/testing'

import { NO_NODE, PANE, SERVER_UNKNOWN, startable, statusLines } from './support.ts'

test('the mod starts with the session, not with a drawing of its pane, which writes nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  statusLines(on)
  const session = startable($, on)
  on('process.run', () => ({ value: { ...NO_NODE, isStdoutTruncated: false, isStderrTruncated: false } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()

  expect(session.registered).toEqual([])
  await session.start()
  await clock.settle()
  expect(session.registered).toEqual(['colab'])
  await ui.unmount()
})

test('a check of this machine’s server that fails is complained of on the status line, not dropped', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  const shown = statusLines(on)
  const session = startable($, on)
  on('process.run', () => ({ value: { ...NO_NODE, isStdoutTruncated: false, isStderrTruncated: false } }))
  await session.start()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()

  // The engine heads a plugin's status line with the plugin's name: the mod's own would show it twice.
  expect(shown).toContain(SERVER_UNKNOWN)
  await ui.unmount()
})

// The language is the session's locale, read as POSIX does: the first of LC_ALL, LC_MESSAGES and LANG that is set.
for (const [locale, heading, left] of [
  [{ LANG: 'es_ES.UTF-8' }, 'Entrar en una sala', /No estabas en ninguna sala/],
  [{ LC_MESSAGES: 'es_ES.UTF-8', LANG: 'en_US.UTF-8' }, 'Entrar en una sala', /No estabas en ninguna sala/],
  [{ LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'es_ES.UTF-8', LANG: 'es_ES.UTF-8' }, 'Go into a room', /You were in no room/],
] as const) {
  test(`a session of locale ${JSON.stringify(locale)} gets the pane and the tools’ answers in its language`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, locale)
    const session = startable($, on)
    on('process.run', () => ({
      value: {
        exitCode: 0,
        stdout: '{"ok":true,"running":false,"machine":"equipo"}',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    await session.start()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await clock.settle()

    expect(await ui.find({ type: 'Text', text: heading })).toBeDefined()
    expect((await $.tool.call({ tool: 'mcp__colab__leave' })).result).toMatch(left)
    await ui.unmount()
  })
}
