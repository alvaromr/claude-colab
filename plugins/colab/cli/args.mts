// What the CLI makes of its command line: the command, its options and positionals, and the addresses and ports they
// name. Pure: the commands themselves, which act, live in commands.mts.
import { parseArgs } from 'node:util'
import { DEFAULT_PORT, isPort } from './protocol.mts'
import { type Defaults, TEXT } from './strings.mts'

export type Options = Record<string, { type: 'string' | 'boolean'; default?: string }>
export type Values = Record<string, string | boolean | undefined>
// As many as the command takes: parse checked their count.
export type Positionals = string[] & { 0: string }
export type Name = keyof typeof TEXT.commands
type Spec = { options: Options; positionals: number }

/** A command line the person got wrong: the CLI exits with 2, as for an unknown option. */
export class UsageError extends Error {}

export const MAIN_HELP = TEXT.main(
  Object.entries(TEXT.commands)
    .map(([name, c]) => `  ${name.padEnd(8)} ${c.summary}`)
    .join('\n'),
)

export function parsePort(text: string | undefined) {
  if (text === undefined) return DEFAULT_PORT
  const port = Number(text)
  if (!isPort(port)) throw new UsageError(TEXT.badPort(text))
  return port
}

/** `host`, `host:port`, `[ipv6]:port` or a bare IPv6 address. */
export function parseAddress(text: string) {
  const m = /^\[(.+)\](?::(\d+))?$/.exec(text) ?? /^([^:]+):(\d+)$/.exec(text)
  return m ? { host: String(m[1]), port: parsePort(m[2]) } : { host: text, port: DEFAULT_PORT }
}

/** The address of `host` at `port`, an IPv6 one in brackets: what parseAddress reads back. */
export const addressOf = (host: string, port: number) => (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`)

export type Parsed<C> = { help: string } | { command: C; positionals: Positionals; values: Values }

/** The command `argv` asks for among `commands`, or the help it asks for, which shows `defaults`. */
export function parse<C extends Spec>(argv: string[], commands: Record<Name, C>, defaults: Defaults): Parsed<C> {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === '-h') return { help: MAIN_HELP }
  if (!Object.hasOwn(commands, name)) throw new UsageError(`${TEXT.unknownCommand(name)}\n\n${MAIN_HELP}`)
  const command = commands[name as Name]
  const { usage, help } = TEXT.commands[name as Name]
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...command.options, help: { type: 'boolean', short: 'h' } },
  })
  if (values.help) return { help: `${usage}\n\n${help(defaults)}` }
  if (positionals.length !== command.positionals) throw new UsageError(TEXT.usage(usage))
  return { command, positionals: positionals as Positionals, values }
}
