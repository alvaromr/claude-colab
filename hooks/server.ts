import { type Answer, complained, done, type Engine, failed, T, updateHosted } from './state.ts'

const CLI = 'cli/claude-colab.mts'

// The name this machine's server takes when opened with none, as the CLI says.
export let machine: string | undefined

export function cli($: Engine) {
  return `${$.plugin.root}/${CLI}`
}

/** Runs a CLI command that answers one JSON line, with `stdin` if given: that answer, or why it failed. */
export async function runCli($: Engine, args: string[], stdin?: string): Promise<Answer & Record<string, unknown>> {
  const ran = await $.process.run(['node', cli($), ...args], stdin === undefined ? {} : { stdin })

  try {
    const answer = JSON.parse(ran.stdout) as Answer & Record<string, unknown>

    if (ran.exitCode === 0 || answer.ok === false) return answer
  } catch {
    // Nothing on stdout: the reason is on stderr.
  }

  return failed(ran.stderr.trim() || T.cliFailed(String(args[0])))
}

/** Asks whether this machine's room server is open, and keeps what the pane shows of it. */
export async function checkServer($: Engine): Promise<Answer> {
  const status = await runCli($, ['status'])

  if (!status.ok) return status
  machine = status.machine as string
  await updateHosted($, () =>
    status.running
      ? { address: String(status.listening), title: String(status.title), addresses: status.addresses as string[] }
      : null,
  )

  return done(status.running ? T.serverHere(String(status.title), String(status.listening)) : T.noServerOpen)
}

/** Opens this machine's room server, in the background: it outlives this session, until it is closed. */
export async function openServer($: Engine, host: string, port: number, title: string): Promise<Answer> {
  const named = title ? ['--name', title] : []
  const opened = await runCli($, ['serve', '--background', '--host', host, '--port', String(port), ...named])

  await complained($, T.serverUnknown, checkServer($))
  if (!opened.ok) return opened
  const local = `127.0.0.1:${String(opened.listening).split(':').pop()}`

  return done(T.serverOpened(String(opened.title), String(opened.listening), local))
}

/** Closes this machine's room server: everyone linked to it is disconnected. */
export async function closeServer($: Engine): Promise<Answer> {
  const closed = await runCli($, ['stop'])

  await complained($, T.serverUnknown, checkServer($))

  return closed.ok ? done(T.serverClosed) : closed
}
