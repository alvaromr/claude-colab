// Runs with Vitest, as the CLI's: what connect and the CLI say, and what the mod makes of it.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  answerOf,
  done,
  failed,
  failureOf,
  hostedOf,
  isLetGo,
  isOthersMove,
  nextWait,
  RETRY_FIRST,
  splitLines,
} from '../../plugins/colab/hooks/linking.ts'

const ON = { status: 'on', server: '192.0.2.5:4747', title: 'T', name: 'Ana', color: 0, socket: '/s' } as const
const HERE = { code: 'c'.repeat(24), label: '1' }

test('an answer is done with what it says, or failed with why', () => {
  assert.deepEqual(done('hecho'), { ok: true, text: 'hecho' })
  assert.deepEqual(failed('no'), { ok: false, error: 'no' })
})

test('what connect prints is taken a whole line at a time, however its chunks split it', () => {
  assert.deepEqual(splitLines('', 'uno\ndos\ntr'), { lines: ['uno', 'dos'], rest: 'tr' })
  assert.deepEqual(splitLines('tr', 'es\n'), { lines: ['tres'], rest: '' })
  assert.deepEqual(splitLines('a', 'b'), { lines: [], rest: 'ab' }, 'no line ended yet')
})

test('a failure of connect or TLS is told by its kind, where its code would not say it to a person', () => {
  for (const code of ['DECRYPT_ERROR', 'x BINDER y']) assert.equal(failureOf(code), 'keyMismatch', code)
  assert.equal(failureOf('ECONNREFUSED'), 'nobodyThere')
  assert.equal(failureOf('ECONNREFUSED 1'), undefined, 'refused, as a whole code only')
  for (const code of ['ETIMEDOUT', 'EHOSTUNREACH', 'a ENETUNREACH']) assert.equal(failureOf(code), 'unreachable', code)
  assert.equal(failureOf('EPIPE'), undefined)
})

test('a link that dropped is tried again, each wait twice the last, up to half a minute', () => {
  assert.equal(RETRY_FIRST, 1_000)
  const waits = [RETRY_FIRST]
  for (let i = 0; i < 6; i++) waits.push(nextWait(Number(waits.at(-1))))
  assert.deepEqual(waits, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
})

test('a refused name lets the link go; a taken one only once it cannot be this session’s own old link', () => {
  // A server that pings every 100 ms and drops a link after 2 unheard: past 3 pings, the name is someone else's.
  const pings = { every: 100, deadAfter: 2 }
  assert.equal(isLetGo(undefined, 0, 10, pings), false, 'not refused: tried again')
  for (const reason of ['bad-name', 'claude-name'] as const) assert.equal(isLetGo(reason, 0, 1, pings), true, reason)
  assert.equal(isLetGo('name-taken', undefined, 5, pings), true, 'taken with no drop before it: someone else’s')
  assert.equal(isLetGo('name-taken', 1_000, 1_300, pings), false, 'within the wait: maybe its own')
  assert.equal(isLetGo('name-taken', 1_000, 1_301, pings), true, 'past it: someone else’s')
})

test('the conversation is told of someone else coming into or leaving this session’s room alone', () => {
  const move = { ...HERE, name: 'Bob' }
  assert.equal(isOthersMove(move, HERE, ON), true)
  assert.equal(isOthersMove({ ...move, name: 'Ana' }, HERE, ON), false, 'its own')
  assert.equal(isOthersMove({ ...move, code: 'd'.repeat(24) }, HERE, ON), false, 'another room')
  assert.equal(isOthersMove(move, null, ON), false, 'in no room')
  assert.equal(isOthersMove(move, HERE, { status: 'connecting' }), false, 'not linked')
})

test('a CLI command answers its JSON line; failing with none, its complaint, if it made one', () => {
  const ran = (stdout: string, exitCode: number, stderr = '') => answerOf({ stdout, stderr, exitCode })
  assert.deepEqual(ran('{"ok":true,"x":1}', 0), { ok: true, x: 1 })
  assert.deepEqual(ran('{"ok":false,"error":"no"}', 1), { ok: false, error: 'no' }, 'a refusal it explains')
  assert.deepEqual(ran('{"ok":true}', 1, ' roto \n'), { ok: false, error: 'roto' }, 'an exit it does not explain')
  assert.deepEqual(ran('', 2, 'uso\n'), { ok: false, error: 'uso' })
  assert.deepEqual(ran('null', 1, 'x'), { ok: false, error: 'x' }, 'a line that is no answer')
  assert.equal(ran('', 1, ' \n'), undefined, 'nothing said: the caller says what failed')
})

test('this machine’s server is where its status says it listens, while it runs', () => {
  const status = { ok: true, running: true, listening: '0.0.0.0:4747', title: 'T', addresses: ['192.0.2.5'] }
  assert.deepEqual(hostedOf(status), { address: '0.0.0.0:4747', title: 'T', addresses: ['192.0.2.5'] })
  assert.equal(hostedOf({ ...status, running: false }), null)
})
