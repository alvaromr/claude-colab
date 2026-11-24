// Runs with Vitest: what the server, connect and the mod agree on.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  ANY_HOST,
  INVITATION_PREFIX,
  isCode,
  isLoopback,
  isName,
  isPort,
  LOOPBACK,
  languageOf,
  NAME_LENGTH,
  NAME_RULE,
} from '../plugins/colab/cli/protocol.ts'

test('a server listens on every interface unless told, is reached here by loopback, and invites with colab:', () => {
  assert.deepEqual([ANY_HOST, LOOPBACK, INVITATION_PREFIX], ['0.0.0.0', '127.0.0.1', 'colab:'])
})

test('this machine, as a host, is any 127 address, localhost or ::1, bracketed or not', () => {
  for (const host of ['127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]']) assert.equal(isLoopback(host), true, host)
  for (const host of [
    '192.0.2.9',
    'equipo127.lan',
    'localhost.lan',
    'localhostess',
    'x127.0.0.1',
    '::10',
    '::12',
    '[::1]:4747',
  ]) {
    assert.equal(isLoopback(host), false, host)
  }
})

test('a port is a whole number from 1 to 65535', () => {
  for (const port of [1, 4747, 65535]) assert.equal(isPort(port), true, String(port))
  for (const port of [0, 65536, 1.5, -1, Number.NaN]) assert.equal(isPort(port), false, String(port))
})

test('a name is letters, digits, spaces and . _ -, starting with a letter or digit, up to its length', () => {
  for (const name of ['Ana', 'Ñandú 2', 'a', 'x'.repeat(NAME_LENGTH), 'b.o_b-1']) assert.equal(isName(name), true, name)
  for (const name of ['', ' Ana', '-Ana', 'x'.repeat(NAME_LENGTH + 1), 'Ana!', 'Ana\n', 5, null, ['Ana']]) {
    assert.equal(isName(name), false, String(name))
  }
  assert.deepEqual(NAME_RULE, {
    es: `letras, números, espacios y . _ -, hasta ${NAME_LENGTH}, sin mezclar los alfabetos latino, griego y cirílico`,
    en: `letters, digits, spaces and . _ -, up to ${NAME_LENGTH}, without mixing the Latin, Greek and Cyrillic scripts`,
  })
})

test('a name in one script stands; one that mixes scripts whose letters look alike would pass for another', () => {
  for (const name of ['Анна', 'Ελένη', 'Ana 2', 'Jürgen', 'Анна 2', '李娜', 'Ana 李'])
    assert.equal(isName(name), true, name)
  // A Cyrillic А, a Greek ο, a Cyrillic а in a Greek name.
  for (const name of ['Аna', 'Bοb', 'Ελа']) assert.equal(isName(name), false, name)
})

test('a room’s code is 24 letters, digits, _ or -, and nothing else', () => {
  assert.equal(isCode('a'.repeat(24)), true)
  assert.equal(isCode('aZ09_-'.repeat(4)), true)
  for (const code of ['a'.repeat(23), 'a'.repeat(25), `${'a'.repeat(23)}!`, ['a'.repeat(24)], 24, undefined]) {
    assert.equal(isCode(code), false, String(code))
  }
})

test('the language is Spanish where the first locale variable set is Spanish, English anywhere else', () => {
  for (const locale of [
    { LANG: 'es_ES.UTF-8' },
    { LANG: 'es' },
    { LANG: 'ES_mx' },
    { LANG: 'es.UTF-8' },
    { LANG: 'es@euro' },
    { LC_MESSAGES: 'es_AR.UTF-8', LANG: 'en_US.UTF-8' },
    { LC_ALL: 'es_ES.UTF-8', LC_MESSAGES: 'en_US.UTF-8', LANG: 'en_US.UTF-8' },
    { LC_ALL: '', LANG: 'es_ES.UTF-8' }, // an empty one counts as unset
  ]) {
    assert.equal(languageOf(locale), 'es', JSON.stringify(locale))
  }
  for (const locale of [
    {},
    { LANG: 'en_US.UTF-8' },
    { LANG: 'C' },
    { LANG: 'POSIX' },
    { LANG: 'est_EE' },
    { LANG: 'xes_ES' },
    { LC_MESSAGES: 'en_GB', LANG: 'es_ES.UTF-8' },
    { LC_ALL: 'C', LANG: 'es_ES.UTF-8' },
  ]) {
    assert.equal(languageOf(locale), 'en', JSON.stringify(locale))
  }
})
