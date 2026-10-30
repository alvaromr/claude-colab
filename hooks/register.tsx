import type { Register } from 'claude-code'

import { markBusy, say, sentLine } from './link.ts'
import { bubble, onPane, PANE, TITLE } from './pane.tsx'
import { checkServer } from './server.ts'
import { start } from './session.ts'
import { MARK, readColors, readLink, readLog, T } from './state.ts'
import { type Input, onTools } from './tools.ts'

// The number a received message carries into the conversation: its line in the log, which its row is drawn from.
const NUMBERED = /\[colab\] #(\d+)/
const SAY = 'mcp__colab__say'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await start($)

    return next(e)
  })

  on('command.run', { command: 'colab' }, async ($, e) => {
    const said = e.args.trim()

    if (!said) {
      await $.ui.open({ id: PANE, title: TITLE })
      void checkServer($) // opened or closed from another session meanwhile

      return { text: T.paneOpened }
    }
    const sent = await say($, said, 'person')

    return { text: sent.ok ? `${sent.text}: ${said}` : T.notSent(String(sent.error)) }
  })

  onTools(on)

  // The room sees this session's Claude at work from the start of each of its turns to the end, however it ended; a
  // subagent's turns are inside one of those.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) void markBusy($, true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) void markBusy($, false)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return (await readLink($)).status === 'on'
      ? {
          sections: [
            ...composed.sections,
            { id: 'colab:rules', text: T.rules(MARK.trim()), scope: 'session' as const },
          ],
        }
      : composed
  })

  // Each message of the room shows once in the conversation, boxed in its author's color, in the row that brought
  // it: a received one in its inbox row, one sent in the row of the /colab or the say call that sent it.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const n = e.props.origin.kind === 'peer' ? Number(NUMBERED.exec(e.props.text)?.[1]) : NaN
    const line = (await readLog($)).find(one => one.n === n)

    // One the log no longer holds (a resumed session) is left to the engine.
    return line === undefined ? next(e) : bubble($, e, line, await readColors($))
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'colab' } }, async ($, e, next) => {
    const said = e.props.args.trim()

    if (e.props.isErrored || !said || !e.props.text.includes(T.sent)) return next(e)

    return bubble($, e, await sentLine($, said, 'person'), await readColors($))
  })

  on('ui.render', { component: 'ToolUse', props: { tool: SAY } }, async ($, e, next) => {
    const { text, to } = (e.props.input ?? {}) as Input

    if (e.props.isErrored || typeof text !== 'string') return next(e)

    return bubble($, e, await sentLine($, text, 'claude', to), await readColors($))
  })

  // The say call's own result repeats nothing the box does not show.
  on('ui.render', { component: 'ToolResult', props: { tool: SAY } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  // A run of say calls folded into one count line: each message drawn instead.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const calls = e.props.calls

    if (!e.props.isCallsOnly || calls.length === 0 || calls.some(call => call.tool !== SAY || call.isErrored)) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    const painted = await readColors($)
    const lines = await Promise.all(
      calls.map(call => {
        const { text, to } = (call.input ?? {}) as Input

        return sentLine($, String(text ?? ''), 'claude', to)
      }),
    )

    return <Box flexDirection="column">{lines.map(line => bubble($, e, line, painted))}</Box>
  })

  onPane(on)
}
