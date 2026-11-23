// Runs with Vitest: what the CLI makes of its command line.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  addressOf,
  MAIN_HELP,
  type Name,
  type Options,
  parse,
  parseAddress,
  parsePort,
  UsageError,
} from '../plugins/colab/cli/args.mts'
import { DEFAULT_PORT } from '../plugins/colab/cli/protocol.mts'
import { TEXT } from '../plugins/colab/cli/strings.mts'

const DEFAULTS = { machine: 'equipo', user: 'ana', log: '/home/ana/server.log', socket: '/home/ana/colab.sock' }
type Spec = { options: Options; positionals: number }
const none: Spec = { options: {}, positionals: 0 }
const COMMANDS: Record<Name, Spec> = {
  ...(Object.fromEntries(Object.keys(TEXT.commands).map(name => [name, none])) as Record<Name, Spec>),
  say: { options: { to: { type: 'string' } }, positionals: 1 },
}

test('a port is a whole number from 1 to 65535, or the default when none is given', () => {
  assert.equal(parsePort(undefined), DEFAULT_PORT)
  for (const [text, port] of [
    ['1', 1],
    ['5000', 5000],
    ['65535', 65535],
  ] as const) {
    assert.equal(parsePort(text), port)
  }
  for (const text of ['0', '65536', '1.5', 'abc', '']) {
    assert.throws(() => parsePort(text), new UsageError(TEXT.badPort(text)), text)
  }
})

test('an address is a host with its port or the default one, an IPv6 one in brackets when it has a port', () => {
  for (const [text, address] of [
    ['192.0.2.5', { host: '192.0.2.5', port: DEFAULT_PORT }],
    ['192.0.2.5:5000', { host: '192.0.2.5', port: 5000 }],
    ['[2001:db8::9]:5000', { host: '2001:db8::9', port: 5000 }],
    ['[2001:db8::9]', { host: '2001:db8::9', port: DEFAULT_PORT }],
    ['2001:db8::9', { host: '2001:db8::9', port: DEFAULT_PORT }],
  ] as const) {
    assert.deepEqual(parseAddress(text), address, text)
  }
  assert.throws(() => parseAddress('192.0.2.5:0'), new UsageError(TEXT.badPort('0')))
  // Brackets only around the whole host: anything else is a host as it came, at the default port.
  for (const text of ['x[2001:db8::9]:5000', '[2001:db8::9]:5000x', '192.0.2.5:5000x', '2001:db8::5:9']) {
    assert.deepEqual(parseAddress(text), { host: text, port: DEFAULT_PORT }, text)
  }
})

test('an address written from a host and a port reads back as them', () => {
  assert.equal(addressOf('192.0.2.5', 5000), '192.0.2.5:5000')
  assert.equal(addressOf('2001:db8::9', 5000), '[2001:db8::9]:5000')
  for (const host of ['192.0.2.5', '2001:db8::9']) {
    assert.deepEqual(parseAddress(addressOf(host, 5000)), { host, port: 5000 })
  }
})

test('the help is asked with no command or its flag; a command’s with its own, showing the defaults', () => {
  for (const argv of [[], ['--help'], ['-h']]) assert.deepEqual(parse(argv, COMMANDS, DEFAULTS), { help: MAIN_HELP })
  const { usage, help } = TEXT.commands.say
  assert.deepEqual(parse(['say', '--help'], COMMANDS, DEFAULTS), { help: `${usage}\n\n${help(DEFAULTS)}` })
  assert.match(MAIN_HELP, /^ {2}say {6}/m)
})

test('a command is taken with its positionals and options; anything else is a usage error that says why', () => {
  assert.deepEqual(parse(['say', 'hola', '--to', 'Bob'], COMMANDS, DEFAULTS), {
    command: COMMANDS.say,
    positionals: ['hola'],
    values: Object.assign(Object.create(null), { to: 'Bob' }), // as parseArgs gives it
  })
  assert.throws(
    () => parse(['volar'], COMMANDS, DEFAULTS),
    new UsageError(`${TEXT.unknownCommand('volar')}\n\n${MAIN_HELP}`),
  )
  assert.throws(() => parse(['toString'], COMMANDS, DEFAULTS), UsageError, 'no command is inherited')
  for (const argv of [['say'], ['say', 'a', 'b']]) {
    assert.throws(() => parse(argv, COMMANDS, DEFAULTS), new UsageError(TEXT.usage(TEXT.commands.say.usage)))
  }
  assert.throws(() => parse(['say', 'hola', '--clave', 'x'], COMMANDS, DEFAULTS), {
    code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION',
  })
})
