import type { On } from 'claude-code'

import { DEFAULT_PORT } from '../cli/protocol.mts'
import { acceptInvitation, connect, create, disconnect, invite, leave, roomList, say } from './link.ts'
import { closeServer, openServer } from './server.ts'
import { type Answer, done, type Engine, failed, readSetup, T } from './state.ts'

export type Input = Record<string, unknown>
const text = (input: Input, field: string) => (typeof input[field] === 'string' ? input[field].trim() : '')

/**
 * What Claude can do without the pane: each one is `mcp__colab__<name>`, run by `act`, and described to the model by
 * its words in the session's language, the tool's and each field's.
 */
const TOOLS: Record<keyof typeof T.tools, { properties?: Record<string, { type: string }>; required?: string[] }> = {
  say: { properties: { text: { type: 'string' }, to: { type: 'string' } }, required: ['text'] },
  serve: { properties: { name: { type: 'string' }, host: { type: 'string' }, port: { type: 'number' } } },
  stop_serving: {},
  connect: { properties: { server: { type: 'string' }, name: { type: 'string' } }, required: ['server'] },
  disconnect: {},
  rooms: {},
  create: { properties: { room: { type: 'string' } } },
  join: { properties: { invitation: { type: 'string' }, name: { type: 'string' } }, required: ['invitation'] },
  invite: {},
  leave: {},
}

/** Registers each tool of TOOLS, in the session's language. */
export async function registerTools($: Engine) {
  for (const [name, tool] of Object.entries(TOOLS)) {
    const words: { description: string } & Record<string, string> = T.tools[name as keyof typeof TOOLS]
    const properties = Object.entries(tool.properties ?? {}).map(([field, kind]) => [
      field,
      { ...kind, description: words[field] },
    ])

    await $.tool.register({
      name,
      description: words.description,
      inputSchema: { type: 'object', properties: Object.fromEntries(properties), required: tool.required ?? [] },
      isDeferred: name !== 'say',
    })
  }
}

/** Runs the tool `name` of TOOLS with what the model gave it. */
async function act($: Engine, name: string, input: Input): Promise<Answer> {
  switch (name) {
    case 'say':
      return say($, text(input, 'text'), 'claude', text(input, 'to') || undefined)
    case 'serve':
      return openServer(
        $,
        text(input, 'host') || '0.0.0.0',
        typeof input.port === 'number' ? input.port : DEFAULT_PORT,
        text(input, 'name'),
      )
    case 'stop_serving':
      return closeServer($)
    case 'connect':
      return connect($, text(input, 'server'), text(input, 'name'))
    case 'disconnect':
      return disconnect($)
    case 'rooms':
      return roomList($)
    case 'create':
      return create($, text(input, 'room') || undefined)
    case 'join':
      return acceptInvitation($, text(input, 'invitation'), text(input, 'name') || (await readSetup($)).name)
    case 'invite': {
      const invited = await invite($)

      return invited.ok && invited.invitation ? done(invited.invitation) : invited
    }
    case 'leave':
      return leave($)
    default:
      return failed(T.unknownTool(name))
  }
}

/** Each tool of TOOLS, by its name after the prefix. */
export function onTools(on: On) {
  on('tool.call', { tool: new RegExp(`^mcp__colab__(${Object.keys(TOOLS).join('|')})$`) }, async ($, e) => {
    const answer = await act($, e.tool.slice('mcp__colab__'.length), e as unknown as Input)

    return answer.ok ? { result: answer.text ?? T.done } : { deny: answer.error ?? T.failed }
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: T.toolBroke(e.tool) }))
}
