// Runs with `node --test tests/`, as the CLI's: which addresses reach which server.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isOwn, isSameRoom, isSameServer, remembered, withLeft, without } from '../../hooks/addresses.ts'

const OWN = { address: '0.0.0.0:4747', addresses: ['192.0.2.5', '2001:db8::5'] }

test('this machine is reached by loopback, or by one of its own addresses, at any port', () => {
  for (const server of ['127.0.0.1:4747', '127.0.0.2:5000', 'localhost:4747', 'localhost', '[::1]:4747', '::1']) {
    assert.equal(isOwn(server, null), true, server)
  }
  for (const server of ['192.0.2.5:4747', '192.0.2.5:4800', '2001:db8::5:4747']) {
    assert.equal(isOwn(server, OWN), true, server)
    assert.equal(isOwn(server, null), false, `${server}, with no server of its own`)
  }
  for (const server of [
    '192.0.2.9:4747',
    'localhostess:4747',
    '203.0.113.127:4747',
    'x127.0.0.1:4747',
    '::12:4747',
    '192.0.2.50:4747',
  ]) {
    assert.equal(isOwn(server, OWN), false, server)
  }
})

test('two addresses reach one server when they are the same, or both reach this machine’s own at its port', () => {
  assert.equal(isSameServer('192.0.2.9:4747', '192.0.2.9:4747', null), true)
  assert.equal(isSameServer('192.0.2.9:4747', '192.0.2.9:4800', OWN), false)
  assert.equal(isSameServer('127.0.0.1:4747', '192.0.2.5:4747', OWN), true)
  assert.equal(isSameServer('127.0.0.1:4747', '192.0.2.5:4747', null), false, 'with no server of its own')
  assert.equal(isSameServer('127.0.0.1:4800', '192.0.2.5:4800', OWN), false, 'at another port than its own')
  assert.equal(isSameServer('127.0.0.1:4747', '192.0.2.9:4747', OWN), false, 'one of them another machine')
})

test('two rooms left are one when they have one code on one server', () => {
  const left = { code: 'a'.repeat(24), server: '127.0.0.1:4747' }
  assert.equal(isSameRoom(left, { ...left, server: '192.0.2.5:4747' }, OWN), true)
  assert.equal(isSameRoom(left, { ...left, code: 'b'.repeat(24) }, OWN), false)
  assert.equal(isSameRoom(left, { ...left, server: '192.0.2.9:4747' }, OWN), false)
})

test('a server linked to goes first among those known, once, under the name it gives now', () => {
  const known = [
    { address: '192.0.2.8:4747', title: 'A' },
    { address: '192.0.2.9:4747', title: 'B' },
  ]
  assert.deepEqual(remembered(known, { address: '192.0.2.9:4747', title: 'B2' }), [
    { address: '192.0.2.9:4747', title: 'B2' },
    { address: '192.0.2.8:4747', title: 'A' },
  ])
})

test('a room left goes first among those to go back to, once, and only the newest are kept', () => {
  const room = (code: string, server = '192.0.2.9:4747') => ({ code: code.repeat(24), label: '1', server })
  const recent = [room('a'), room('b', '127.0.0.1:4747'), room('c')]
  const again = room('b', '192.0.2.5:4747')
  assert.deepEqual(withLeft(recent, again, OWN, 5), [again, room('a'), room('c')], 'the same room, at its own address')
  assert.deepEqual(withLeft(recent, room('d'), OWN, 2), [room('d'), room('a')])
  assert.deepEqual(without(recent, again, OWN), [room('a'), room('c')])
})
