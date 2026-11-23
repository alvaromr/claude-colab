// What each claude-colab command does, given the process it runs in (`Host`): the entry point hands it its own, and a
// test one of its own, so that it runs where Stryker sees which tests cover it.
import type { ChildProcess } from 'node:child_process'
import { openSync } from 'node:fs'
import http from 'node:http'
import { hostname, userInfo } from 'node:os'
import type { Writable } from 'node:stream'
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
  defaultSocket,
  HOME,
  loadKey,
  markServer,
  privateFolder,
  runningServer,
  type ServerProcess,
  saveKey,
  savedKey,
  SERVER_LOG,
  serverEnded,
  serverKey,
  socketError,
} from './home.mts'
import { serve } from './hub.mts'
import { type Answer, connect, type Host as LinkHost, networkAddresses } from './link.mts'
import { ANY_HOST, isName, LOOPBACK, NAME_LENGTH, type Value } from './protocol.mts'
import { type Defaults, TEXT } from './strings.mts'
import { parseInvitation, parseKey } from './wire.mts'

/**
 * What the commands take from the process they run in: what connect and the server's record take, and besides its
 * arguments (those after the script), where it complains, what it reads, how it signals another process, the exit
 * code it ends with once nothing is left to do, its channel to a process that started it, if any, and how it starts
 * itself apart, as `serve --background` does.
 */
export type Host = LinkHost &
  ServerProcess & {
    argv: readonly string[]
    stderr: Writable
    stdin: () => string
    kill: (pid: number, signal: 'SIGTERM') => void
    setExitCode: (code: number) => void
    send?: (message: Answer, done: () => void) => void
    disconnect?: () => void
    background: (args: string[], output: number) => Pick<ChildProcess, 'once' | 'unref'>
  }

type Command = { options: Options; positionals: number } & (
  | { run: (positionals: Positionals, values: Values) => unknown }
  | { request: (positionals: Positionals, values: Values) => [string, Value] }
)

// A string option's value: parseArgs gives each option the type its command declares, and its default when it has one.
const option = (values: Values, name: string) => values[name] as string | undefined
const setting = (values: Values, name: string) => values[name] as string

// How long stop waits for the server to end.
const STOP_TIMEOUT = 5_000

/** This machine's name as the network knows it, without its domain: a server's name when none is given. */
function hostTitle() {
  return hostname().replace(/\..*/s, '').slice(0, NAME_LENGTH)
}

/**
 * Runs the command its arguments ask for, and settles once it is done: exited, ended with nothing left to do (code
 * 0), or left running. What it leaves running, a server, is what it answers: a process of its own ends it by ending,
 * and a host that lives on, a test, has it to close.
 */
export async function main(host: Host) {
  const print = (result: unknown) => host.stdout.write(`${JSON.stringify(result)}\n`)
  const complain = (message: string) => host.stderr.write(`${message}\n`)
  const socket = defaultSocket(host.env)
  const SOCKET_OPTION = { socket: { type: 'string', default: socket } } as const

  /** Answers on stdout, or, run by `serve --background`, to the process that started it, which then lets it go. */
  const tell = (result: Answer) => {
    if (host.send) host.send(result, () => host.disconnect?.())
    else print(result)
  }

  /** Runs this same serve as a process of its own, left running, and answers with what it says once it listens. */
  const inBackground = (port: number) => {
    privateFolder(HOME)
    const output = openSync(SERVER_LOG, 'a', 0o600)
    const server = host.background(
      host.argv.filter(arg => arg !== '--background'),
      output,
    )
    server.once('message', (result: Answer) => {
      print(result)
      server.unref()
      host.exit(result.ok ? 0 : 1)
    })
    server.once('exit', (code: number | null) => {
      complain(TEXT.neverListened(port, code, SERVER_LOG))
      host.exit(1)
    })
  }

  /** Sends one request to the local connect process and prints its answer; settles once it has exited. */
  const request = (socketPath: string, op: string, args: Value) =>
    new Promise<void>(settle => {
      const req = http.request(
        { socketPath, path: `/${op}`, method: 'POST', headers: { 'content-type': 'application/json' } },
        res => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', chunk => (body += chunk))
          res.on('end', () => {
            const result = JSON.parse(body)
            host.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
            host.exit(result.ok ? 0 : 1)
            settle()
          })
        },
      )
      req.on('error', (err: NodeJS.ErrnoException) => {
        complain(
          err.code === 'ENOENT' || err.code === 'ECONNREFUSED'
            ? TEXT.noConnect(socketPath)
            : socketError(socketPath, err).message,
        )
        host.exit(1)
        settle()
      })
      req.end(JSON.stringify(args))
    })

  const COMMANDS: Record<Name, Command> = {
    serve: {
      options: {
        name: { type: 'string', default: hostTitle() },
        host: { type: 'string', default: ANY_HOST },
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
          saveKey(LOOPBACK, port, text)
          markServer(address, port, title, host)
          tell({ ok: true, listening: `${address}:${port}`, title, key: text })
        })
        server.on('error', (err: NodeJS.ErrnoException) => {
          tell({ ok: false, error: err.code === 'EADDRINUSE' ? TEXT.portInUse(port) : err.message })
          host.setExitCode(1)
        })
        return server
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
          key: savedKey(LOOPBACK, running.port),
          addresses: networkAddresses(),
        }
        print({ ok: true, running: Boolean(running), machine: hostTitle(), ...found })
      },
    },
    stop: {
      options: {},
      positionals: 0,
      async run() {
        const running = runningServer()
        if (!running) throw new Error(TEXT.noServer)
        host.kill(running.pid, 'SIGTERM')
        await serverEnded({ timeout: STOP_TIMEOUT, every: 100 })
        print({ ok: true, stopped: running.port })
      },
    },
    key: {
      options: {},
      positionals: 1,
      run([address]) {
        const { host: server, port } = parseAddress(address)
        saveKey(server, port, host.stdin())
        print({ ok: true, saved: `${server}:${port}` })
      },
    },
    connect: {
      options: { name: { type: 'string', default: userInfo().username }, ...SOCKET_OPTION },
      positionals: 1,
      run([address], o) {
        const { host: server, port } = parseAddress(address)
        connect(
          {
            key: loadKey(server, port),
            host: server,
            port,
            name: setting(o, 'name'),
            socketPath: setting(o, 'socket'),
          },
          host,
        )
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
        const { addresses, port, key, room, code } = parseInvitation(host.stdin())
        for (const address of addresses) saveKey(address, port, key)
        const servers = addresses.map(address => addressOf(address, port))
        print({ ok: true, servers, room, code })
      },
    },
    join: {
      options: SOCKET_OPTION,
      positionals: 0,
      request: () => ['join', { code: parseInvitation(host.stdin()).code }],
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
  const DEFAULTS: Defaults = { machine: hostTitle(), user: userInfo().username, log: SERVER_LOG, socket }

  try {
    const parsed = parse([...host.argv], COMMANDS, DEFAULTS)
    if ('help' in parsed) {
      host.stdout.write(`${parsed.help}\n`)
      return host.exit(0)
    }
    const { command, positionals, values } = parsed
    if ('run' in command) return await command.run(positionals, values)
    return await request(setting(values, 'socket'), ...command.request(positionals, values))
  } catch (caught) {
    const err = caught as NodeJS.ErrnoException
    complain(err.message)
    host.exit(err instanceof UsageError || err.code?.startsWith('ERR_PARSE_ARGS') ? 2 : 1)
  }
}
