#!/usr/bin/env node
// claude-colab: connects Claude Code sessions of different people over a LAN or a VPN.
// Run with --help for the commands. What they do is in commands.mts; what it tells people is in strings.mts, in the
// language of their locale. This file only hands them this process.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { main } from './commands.mts'

await main({
  pid: process.pid,
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: () => readFileSync(0, 'utf8'),
  exit: code => process.exit(code),
  setExitCode: code => {
    process.exitCode = code
  },
  on: (event, listener) => process.on(event, listener),
  kill: (pid, signal) => process.kill(pid, signal),
  ...(process.send && {
    send: (message, done) => process.send?.(message, done),
    disconnect: () => process.disconnect?.(),
  }),
  background: (args, output) =>
    spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      detached: true,
      stdio: ['ignore', output, output, 'ipc'],
    }),
})
