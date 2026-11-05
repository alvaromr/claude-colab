// Runs with `node --test tests/`: what serve and connect share, without a link.
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import type { PeerCertificate, TLSSocket } from 'node:tls'
import { MAX_LINE } from '../cli/protocol.mts'
import { clientOptions, invitation, newKey, parseInvitation, parseKey, readLines, serverOptions } from '../cli/wire.mts'
import type { Value } from '../cli/protocol.mts'

const key = parseKey(newKey())
const encoded = (value: unknown) => `colab:${Buffer.from(JSON.stringify(value)).toString('base64url')}`

test('a client turns down a server that shows a certificate: only the key proves the server', () => {
  const { checkServerIdentity } = clientOptions(key)
  const shown = (cert: object) => checkServerIdentity?.('192.0.2.5', cert as PeerCertificate)

  assert.match(String(shown({ raw: Buffer.from('cert') })?.message), /presenta un certificado/)
  assert.equal(shown({}), undefined, 'a PSK handshake shows none')
})

test('the server hands its key only to a client that names the identity both share', () => {
  const { pskCallback } = serverOptions(key)
  const asked = (identity: string) => pskCallback?.({} as TLSSocket, identity)

  assert.equal(asked('claude-colab'), key)
  assert.equal(asked('otra'), null)
})

test('an invitation carries what it was given, and nothing else passes for one', () => {
  const given = { addresses: ['192.0.2.5', '198.51.100.3'], port: 4747, key: newKey(), room: '1', code: 'a'.repeat(24) }

  assert.match(invitation(given), /^colab:[\w-]+$/)
  assert.deepEqual(parseInvitation(invitation(given)), given)
  assert.deepEqual(parseInvitation(`  ${invitation(given)}\n`), given, 'pasted with blanks around it')
  const longest = { ...given, addresses: ['x'.repeat(64)] }
  assert.deepEqual(parseInvitation(invitation(longest)), longest)
  for (const text of [
    undefined,
    '',
    'colab:',
    'colab:e30',
    encoded(null),
    `otras:${invitation(given).slice('colab:'.length)}`,
    invitation({ ...given, code: 'corto' }),
    invitation({ ...given, addresses: [] }),
    invitation({ ...given, addresses: ['x'.repeat(65)] }),
    invitation({ ...given, addresses: ['192.0.2.5', 'x'.repeat(65)] }),
    encoded({ ...given, addresses: [{ length: 3 }] }),
    invitation({ ...given, port: 0 }),
    invitation({ ...given, port: 65536 }),
    invitation({ ...given, room: '' }),
    encoded({ ...given, port: '4747' }),
    encoded({ ...given, key: 5 }),
  ]) {
    assert.throws(() => parseInvitation(text), /La invitación no es válida/, String(text))
  }
  assert.throws(() => parseInvitation(invitation({ ...given, key: 'corta' })), /La clave no es válida/)
})

/** What `readLines` gives from `chunks` sent in turn, and whether it cut the stream. */
function linesFrom(chunks: (string | Buffer)[]) {
  const stream = new PassThrough()
  const values: Value[] = []
  readLines(stream, value => values.push(value))
  for (const chunk of chunks) stream.write(chunk)
  return { values, isCut: stream.destroyed }
}

test('each JSON object on a line of its own reaches the reader, however the chunks split it', () => {
  const ñ = Buffer.from('ñ')
  assert.deepEqual(
    linesFrom(['{"a":1}\n{"b"', ':2}\n{"c":', Buffer.from('"'), ñ.subarray(0, 1), ñ.subarray(1), Buffer.from('"}\n')]),
    { values: [{ a: 1 }, { b: 2 }, { c: 'ñ' }], isCut: false },
  )
  assert.deepEqual(linesFrom(['{"a":1}']), { values: [], isCut: false }, 'a line waits for its end')
})

test('a line that is not a JSON object, or longer than a line may be, cuts the stream there', () => {
  for (const line of ['no es json', 'null', '5', '"texto"', '[1]']) {
    assert.deepEqual(linesFrom([`{"a":1}\n${line}\n{"b":2}\n`]), { values: [{ a: 1 }], isCut: true }, line)
  }
  assert.deepEqual(linesFrom(['x'.repeat(MAX_LINE)]), { values: [], isCut: false }, 'as long as a line may be')
  assert.deepEqual(linesFrom(['x'.repeat(MAX_LINE + 1)]), { values: [], isCut: true }, 'longer')
})

test('a key is 32 bytes, nothing shorter or missing', () => {
  assert.equal(parseKey(newKey()).length, 32)
  for (const text of [undefined, '', 'corta', Buffer.alloc(31).toString('base64url')]) {
    assert.throws(() => parseKey(text), /La clave no es válida/, String(text))
  }
})
