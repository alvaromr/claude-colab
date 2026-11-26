import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { linkedAna, session, standOn } from './support.ts'

test('the say tool refuses while nothing is linked', async $ => {
  const ran = await $.tool.call({ tool: 'mcp__colab__say', text: 'hola' })

  expect(ran.deny).toBeDefined()
  expect(ran.text ?? ran.deny).toMatch(/You are in no room/)
})

test('every action of the pane is a tool too, refused while nothing is linked', async $ => {
  for (const tool of ['connect', 'disconnect', 'rooms', 'create', 'join', 'invite', 'stop_serving']) {
    // Deferred until the model loads them, these tools are missing from the names the engine types know.
    const ran = await $.tool.call({ tool: `mcp__colab__${tool}` } as never)

    expect(ran.deny, tool).toBeDefined()
  }
  const left = await $.tool.call({ tool: 'mcp__colab__leave' })

  expect(left.result).toMatch(/You were in no room/)
})

// A tool as the start registers it, its words known by a piece of them.
const spec = (name: string, about: string, isDeferred: boolean, properties = {}, required: string[] = []) => ({
  name,
  description: expect.stringContaining(about),
  inputSchema: { type: 'object', properties, required },
  isDeferred,
})
const field = (type: string, about: string) => ({ type, description: expect.stringContaining(about) })

/** The tools a fresh session registers as it starts, as the engine receives them. */
async function registeredTools($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const { clock } = session(on)
  const registered: { name: string }[] = []
  standOn(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => {
    registered.push(e)

    return { value: { tool: e.name } }
  })
  await $.session.start({ cwd: '/home/ana/project', surface: 'terminal', isInteractive: true })
  await clock.settle()

  return registered
}

test('the start registers every tool with its words and schema; only say is in front, the rest deferred', async ($, on) => {
  expect(await registeredTools($, on)).toEqual([
    spec(
      'say',
      'Writes a message in the colab room',
      false,
      {
        text: field('string', 'The message'),
        to: field('string', 'Name of someone in the room'),
      },
      ['text'],
    ),
    spec('serve', 'Opens this machine’s colab room server', true, {
      name: field('string', 'How those who connect see it'),
      host: field('string', 'Interface it listens on'),
      port: field('number', 'TCP port'),
    }),
    spec('stop_serving', 'Closes this machine’s room server', true),
    spec(
      'connect',
      'Connects this session to a colab room server',
      true,
      {
        server: field('string', 'ip or ip:port of the server'),
        name: field('string', 'Name the others see you by; by default, the system user'),
      },
      ['server'],
    ),
    spec('disconnect', 'Disconnects this session from the room server', true),
    spec('rooms', 'Says which room you are in', true),
    spec('create', 'Makes a room on the server', true, { room: field('string', 'The room’s name') }),
    spec(
      'join',
      'Goes into a room with the invitation',
      true,
      {
        invitation: field('string', 'The whole invitation'),
        name: field('string', 'Name the others see you by; by default, the pane’s'),
      },
      ['invitation'],
    ),
    spec('invite', 'Gives the invitation to the room you are in', true),
    spec('leave', 'Leaves the room you are in', true),
  ])
})

// A hook can only name a tool the mod describes, which the types check; this checks the other way round.
test('every tool registered is answered by a hook of its own, and only those are', async ($, on) => {
  on('tool.call', () => ({ result: 'left to the engine' })) // beneath the mod's hooks, reached only past them
  const names = (await registeredTools($, on)).map(one => `mcp__colab__${one.name}`)

  for (const name of names) {
    const ran = await $.tool.call({ tool: name } as never)

    expect(ran.result ?? ran.deny, name).not.toBe('left to the engine')
  }
  expect((await $.tool.call({ tool: 'mcp__colab__nothing' } as never)).result).toBe('left to the engine')
})

test('a tool that breaks is turned down, naming it', async ($, on) => {
  on('process.run', () => {
    throw new Error('the CLI is gone')
  })

  expect((await $.tool.call({ tool: 'mcp__colab__serve' } as never)).deny).toBe('colab failed in mcp__colab__serve')
})

test('the serve tool opens the server with what it is given, trimmed, and on 0.0.0.0:4747 by default', async ($, on) => {
  const served: string[][] = []
  on('process.run', (_, e) => {
    if (e.argv.includes('serve')) served.push(e.argv.slice(e.argv.indexOf('serve')))
    const stdout = e.argv.includes('serve')
      ? '{"ok":true,"title":"Oficina","listening":"0.0.0.0:4747"}'
      : '{"ok":true,"running":false,"machine":"equipo"}'

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  expect((await $.tool.call({ tool: 'mcp__colab__serve' } as never)).result).toMatch(
    /Server «Oficina» open in the background on 0\.0\.0\.0:4747: .* connect to 127\.0\.0\.1:4747/,
  )
  await $.tool.call({ tool: 'mcp__colab__serve', host: ' 127.0.0.1 ', port: 5000, name: ' Oficina ' } as never)
  expect(served).toEqual([
    ['serve', '--background', '--host', '0.0.0.0', '--port', '4747'],
    ['serve', '--background', '--host', '127.0.0.1', '--port', '5000', '--name', 'Oficina'],
  ])
})

test('say, create and invite hand connect what the model gave them, trimmed; invite answers the invitation alone', async ($, on) => {
  const invitation = 'colab:invitación'
  const { connect } = await linkedAna($, on, ['Ana', 'Bob', 'Carol'], { invite: { ok: true, invitation } })

  await $.tool.call({ tool: 'mcp__colab__say', text: ' hola ', to: ' Bob ' })
  await $.tool.call({ tool: 'mcp__colab__say', text: 'a todos', to: ' ' })
  await $.tool.call({ tool: 'mcp__colab__create', room: ' sala ' } as never)
  expect((await $.tool.call({ tool: 'mcp__colab__invite' } as never)).result).toBe(invitation)
  expect(connect.asked.filter(one => ['say', 'create'].includes(one.op))).toEqual([
    { op: 'create', body: {} },
    { op: 'say', body: { text: 'hola', to: 'Bob', by: 'claude' } },
    { op: 'say', body: { text: 'a todos', by: 'claude' } },
    { op: 'create', body: { name: 'sala' } },
  ])
})
