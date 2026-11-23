// A process for code under test to run in, inside the test's own: what the code takes from a process (its output, its
// environment, its exit and the signals it is sent), so that it runs where Stryker sees which tests cover it.
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/**
 * A process of `pid` with `env`. `exits` holds each exit code asked for, `ended` resolves to the first, `kill` sends
 * it a signal, `output` is what it printed, and `complaint` what its exit listeners threw, which a real process prints.
 */
export function fakeProcess(env: Record<string, string | undefined> = {}, pid = process.ppid) {
  const listeners = new EventEmitter()
  const exits: number[] = []
  let complaint = ''
  let resolveEnded: (code: number) => void = () => undefined
  const ended = new Promise<number>(resolve => {
    resolveEnded = resolve
  })
  const stdout = new PassThrough()
  let output = ''
  stdout.setEncoding('utf8')
  stdout.on('data', chunk => {
    output += chunk
  })
  const host = {
    pid,
    env,
    stdout,
    on: (event: string, listener: () => void) => listeners.on(event, listener),
    exit: (code: number) => {
      exits.push(code)
      try {
        listeners.emit('exit', code)
      } catch (err) {
        complaint += String(err)
      }
      resolveEnded(code)
    },
  }
  return {
    host,
    exits,
    ended,
    kill: (signal: 'SIGINT' | 'SIGTERM' = 'SIGTERM') => listeners.emit(signal),
    output: () => output,
    complaint: () => complaint,
  }
}
