import type { Caught, Next, On } from 'claude-code'

import { ANY_HOST, DEFAULT_PORT } from '../cli/protocol'
import { acceptInvitation, connect, disconnect } from './link'
import { say } from './messages'
import { create, invite, leave, roomList } from './rooms'
import { closeServer, openServer } from './server'
import { type Answer, done, type Engine, isNativeWindows, readSetup, T } from './state'

export type Input = Record<string, unknown>
const text = (input: Input, field: string) => (typeof input[field] === 'string' ? input[field].trim() : '')

/**
 * What Claude can do without the pane: each one is `mcp__colab__<name>`, described to the model by its words in the
 * session's language, the tool's and each field's, and run by its hook in `onTools`.
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

/** A tool of TOOLS by its full name, which the engine calls it by. */
export const toolName = (name: keyof typeof TOOLS) => `mcp__colab__${name}`

/**
 * The tool of TOOLS a hook answers, by its full name: a hook can only match a tool that TOOLS describes. A pattern,
 * since the engine's types know only the tools in front, not the deferred ones.
 */
const tool = (name: keyof typeof TOOLS) => new RegExp(`^${toolName(name)}$`)

/** What the model is told of an answer. */
const reply = (answer: Answer) => (answer.ok ? { result: answer.text ?? T.done } : { deny: answer.error ?? T.failed })

/**
 * Each tool of TOOLS, answered by its own hook. The engine follows `$` only into a function named at the call, so
 * each hook names its tool and its handler here, and a test checks that every tool of TOOLS has one.
 */
export function onTools(on: On) {
  // Outermost, as registered first: on native Windows no tool's own hook runs.
  const anyTool = new RegExp(
    `^(${Object.keys(TOOLS)
      .map(name => toolName(name as keyof typeof TOOLS))
      .join('|')})$`,
  )
  on('tool.call', { tool: anyTool }, nativeWindowsTool).catch(broke)
  on('tool.call', { tool: tool('say') }, sayTool).catch(broke)
  on('tool.call', { tool: tool('serve') }, serveTool).catch(broke)
  on('tool.call', { tool: tool('stop_serving') }, stopServingTool).catch(broke)
  on('tool.call', { tool: tool('connect') }, connectTool).catch(broke)
  on('tool.call', { tool: tool('disconnect') }, disconnectTool).catch(broke)
  on('tool.call', { tool: tool('rooms') }, roomsTool).catch(broke)
  on('tool.call', { tool: tool('create') }, createTool).catch(broke)
  on('tool.call', { tool: tool('join') }, joinTool).catch(broke)
  on('tool.call', { tool: tool('invite') }, inviteTool).catch(broke)
  on('tool.call', { tool: tool('leave') }, leaveTool).catch(broke)
}

/** A hook that broke: what the model is told, unless the engine beneath it was what broke. */
function broke<E extends { tool: string }>(_$: Engine, e: E, next: Next<'tool.call', E> & Caught) {
  return next.called ? next(e) : { deny: T.toolBroke(e.tool) }
}

/** Every tool of TOOLS, on native Windows: turned down with why, before it runs anything. */
function nativeWindowsTool<E extends { tool: string }>(_$: Engine, e: E, next: Next<'tool.call', E>) {
  return isNativeWindows ? { deny: T.nativeWindows } : next(e)
}

async function sayTool($: Engine, e: Input) {
  return reply(await say($, text(e, 'text'), 'claude', text(e, 'to') || undefined))
}

async function serveTool($: Engine, e: Input) {
  const port = typeof e.port === 'number' ? e.port : DEFAULT_PORT

  return reply(await openServer($, text(e, 'host') || ANY_HOST, port, text(e, 'name')))
}

async function stopServingTool($: Engine) {
  return reply(await closeServer($))
}

async function connectTool($: Engine, e: Input) {
  return reply(await connect($, text(e, 'server'), text(e, 'name')))
}

async function disconnectTool($: Engine) {
  return reply(await disconnect($))
}

async function roomsTool($: Engine) {
  return reply(await roomList($))
}

async function createTool($: Engine, e: Input) {
  return reply(await create($, text(e, 'room') || undefined))
}

async function joinTool($: Engine, e: Input) {
  return reply(await acceptInvitation($, text(e, 'invitation'), text(e, 'name') || (await readSetup($)).name))
}

/** The invitation alone, for the model to show its person. */
async function inviteTool($: Engine) {
  const invited = await invite($)

  return reply(invited.ok && invited.invitation ? done(invited.invitation) : invited)
}

async function leaveTool($: Engine) {
  return reply(await leave($))
}
