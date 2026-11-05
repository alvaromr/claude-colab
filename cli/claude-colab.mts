#!/usr/bin/env node
// claude-colab: connects Claude Code sessions of different people over a LAN or a VPN.
// Run with --help for the commands. What it tells people is in strings.mts, in the language of their locale.
import { spawn } from 'node:child_process'
import { openSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { hostname, userInfo } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  addressOf,
  type Name,
  type Options,
  type Positionals,
  parse,
  parseAddress,
  parsePort,
  UsageError,
  type Values,
} from './args.mts'
import {
  DEFAULT_SOCKET,
  HOME,
  loadKey,
  markServer,
  privateFolder,
  runningServer,
  saveKey,
  savedKey,
  SERVER_LOG,
  serverEnded,
  serverKey,
  socketError,
} from './home.mts'
import { serve } from './hub.mts'
import { type Answer, connect, networkAddresses } from './link.mts'
import { isName, NAME_LENGTH, type Value } from './protocol.mts'
import { type Defaults, TEXT } from './strings.mts'
import { parseInvitation, parseKey } from './wire.mts'

const SOCKET_OPTION = { socket: { type: 'string', default: DEFAULT_SOCKET } } as const

type Command = { options: Options; positionals: number } & (
  | { run: (positionals: Positionals, values: Values) => void | Promise<void> }
  | { request: (positionals: Positionals, values: Values) => [string, Value] }
)

// A string option's value: parseArgs gives each option the type its command declares, and its default when it has one.
const option = (values: Values, name: string) => values[name] as string | undefined
const setting = (values: Values, name: string) => values[name] as string

const COMMANDS: Record<Name, Command> = {
  serve: {
    options: {
      name: { type: 'string', default: hostTitle() },
      host: { type: 'string', default: '0.0.0.0' },
      port: { type: 'string' },
      'new-key': { type: 'boolean' },
      background: { type: 'boolean' },
    },
    positionals: 0,
    run(_, o) {
      const running = runningServer()
      if (running) throw new Error(TEXT.serverHere(`${running.host}:${running.port}`))
      const port = parsePort(option(o, 'port'))
      const title = setting(o, 'name')
      if (!isName(title)) throw new UsageError(TEXT.refused['bad-name']())
      if (o.background) return inBackground(port)
      const text = serverKey(port, o['new-key'] === true)
      const server = serve({ key: parseKey(text), host: setting(o, 'host'), port, title }, ({ address, port }) => {
        saveKey('127.0.0.1', port, text)
        markServer(address, port, title)
        tell({ ok: true, listening: `${address}:${port}`, title, key: text })
      })
      server.on('error', (err: NodeJS.ErrnoException) => {
        tell({ ok: false, error: err.code === 'EADDRINUSE' ? TEXT.portInUse(port) : err.message })
        process.exitCode = 1
      })
    },
  },
  status: {
    options: {},
    positionals: 0,
    run() {
      const running = runningServer()
      const found = running && {
        listening: `${running.host}:${running.port}`,
        title: running.title,
        pid: running.pid,
        key: savedKey('127.0.0.1', running.port),
        addresses: networkAddresses(),
      }
      console.log(JSON.stringify({ ok: true, running: Boolean(running), machine: hostTitle(), ...found }))
    },
  },
  stop: {
    options: {},
    positionals: 0,
    async run() {
      const running = runningServer()
      if (!running) throw new Error(TEXT.noServer)
      process.kill(running.pid, 'SIGTERM')
      await serverEnded({ timeout: STOP_TIMEOUT, every: 100 })
      console.log(JSON.stringify({ ok: true, stopped: running.port }))
    },
  },
  key: {
    options: {},
    positionals: 1,
    run([address]) {
      const { host, port } = parseAddress(address)
      saveKey(host, port, readFileSync(0, 'utf8'))
      console.log(JSON.stringify({ ok: true, saved: `${host}:${port}` }))
    },
  },
  connect: {
    options: { name: { type: 'string', default: userInfo().username }, ...SOCKET_OPTION },
    positionals: 1,
    run([address], o) {
      const { host, port } = parseAddress(address)
      connect({
        key: loadKey(host, port),
        host,
        port,
        name: setting(o, 'name'),
        socketPath: setting(o, 'socket'),
      })
    },
  },
  rooms: {
    options: SOCKET_OPTION,
    positionals: 0,
    request: () => ['rooms', {}],
  },
  create: {
    options: { name: { type: 'string' }, ...SOCKET_OPTION },
    positionals: 0,
    request: (_, o) => ['create', { name: option(o, 'name') }],
  },
  invite: {
    options: SOCKET_OPTION,
    positionals: 0,
    request: () => ['invite', {}],
  },
  accept: {
    options: {},
    positionals: 0,
    run() {
      const { addresses, port, key, room, code } = parseInvitation(readFileSync(0, 'utf8'))
      for (const address of addresses) saveKey(address, port, key)
      const servers = addresses.map(address => addressOf(address, port))
      console.log(JSON.stringify({ ok: true, servers, room, code }))
    },
  },
  join: {
    options: SOCKET_OPTION,
    positionals: 0,
    request: () => ['join', { code: parseInvitation(readFileSync(0, 'utf8')).code }],
  },
  leave: {
    options: SOCKET_OPTION,
    positionals: 0,
    request: () => ['leave', {}],
  },
  say: {
    options: { to: { type: 'string' }, claude: { type: 'boolean' }, ...SOCKET_OPTION },
    positionals: 1,
    request: ([text], o) => ['say', { text, to: option(o, 'to'), by: o.claude ? 'claude' : 'person' }],
  },
}

// What the help shows as each option's default.
const DEFAULTS: Defaults = { machine: hostTitle(), user: userInfo().username, log: SERVER_LOG, socket: DEFAULT_SOCKET }

/** This machine's name as the network knows it, without its domain: a server's name when none is given. */
function hostTitle() {
  return hostname().replace(/\..*/s, '').slice(0, NAME_LENGTH)
}

// How long stop waits for the server to end.
const STOP_TIMEOUT = 5_000

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

/** Answers on stdout, or, run by `serve --background`, to the process that started it, which then lets it go. */
function tell(result: Answer) {
  if (process.send) process.send(result, () => process.disconnect?.())
  else console.log(JSON.stringify(result))
}

/** Runs this same serve as a process of its own, left running, and answers with what it says once it listens. */
function inBackground(port: number) {
  privateFolder(HOME)
  const output = openSync(SERVER_LOG, 'a', 0o600)
  const argv = process.argv.slice(2).filter(arg => arg !== '--background')
  const server = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
    detached: true,
    stdio: ['ignore', output, output, 'ipc'],
  })
  server.once('message', (result: Answer) => {
    console.log(JSON.stringify(result))
    server.unref()
    process.exit(result.ok ? 0 : 1)
  })
  server.once('exit', code => fail(TEXT.neverListened(port, code, SERVER_LOG)))
}

/** Sends one request to the local connect process and prints its answer. */
function request(socketPath: string, op: string, args: Value) {
  const req = http.request(
    { socketPath, path: `/${op}`, method: 'POST', headers: { 'content-type': 'application/json' } },
    res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (body += chunk))
      res.on('end', () => {
        const result = JSON.parse(body)
        console.log(JSON.stringify(result, null, 2))
        process.exit(result.ok ? 0 : 1)
      })
    },
  )
  req.on('error', (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === 'ENOENT' || err.code === 'ECONNREFUSED'
        ? TEXT.noConnect(socketPath)
        : socketError(socketPath, err).message,
    )
    process.exit(1)
  })
  req.end(JSON.stringify(args))
}

try {
  const parsed = parse(process.argv.slice(2), COMMANDS, DEFAULTS)
  if ('help' in parsed) {
    console.log(parsed.help)
    process.exit(0)
  }
  const { command, positionals, values } = parsed
  if ('run' in command) await command.run(positionals, values)
  else request(setting(values, 'socket'), ...command.request(positionals, values))
} catch (caught) {
  const err = caught as NodeJS.ErrnoException
  console.error(err.message)
  process.exit(err instanceof UsageError || err.code?.startsWith('ERR_PARSE_ARGS') ? 2 : 1)
}
