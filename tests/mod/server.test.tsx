import { expect, test } from 'claude-code/testing'

import { NO_NODE, SERVER_UNKNOWN, statusLines } from './support.ts'

test('a server opened or closed that the check after cannot see is complained of, the action still told', async ($, on) => {
  const shown = statusLines(on)
  const answers: Record<string, string> = {
    serve: '{"ok":true,"title":"Portátil","listening":"0.0.0.0:4747"}',
    stop: '{"ok":true}',
  }
  on('process.run', (_, e) => {
    const stdout = answers[String(e.argv[2])]

    return {
      value: {
        ...(stdout === undefined ? NO_NODE : { ...NO_NODE, exitCode: 0, stdout }),
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  expect((await $.tool.call({ tool: 'mcp__colab__serve' } as never)).result).toMatch(/Server «Portátil» open/)
  expect(shown).toEqual([SERVER_UNKNOWN])
  expect((await $.tool.call({ tool: 'mcp__colab__stop_serving' } as never)).result).toMatch(/Server closed/)
  expect(shown).toEqual([SERVER_UNKNOWN, SERVER_UNKNOWN])
})
