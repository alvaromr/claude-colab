// Runs with Vitest: what the CLI tells people, in each language.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { languageOf } from '../plugins/colab/cli/protocol.ts'
import { TEXT, TEXTS } from '../plugins/colab/cli/strings.mts'

// What any text's words may take: a refusal's fields, the help's defaults, or a value of its own.
const SAMPLE = { name: 'N', max: 9, label: 'L', to: 'T', op: 'O', machine: 'M', user: 'U', log: 'G', socket: 'S' }

/** Every text under `node`, by its path: a function's is what it gives with SAMPLE for each of its arguments. */
function texts(node: unknown, path = ''): [string, unknown][] {
  if (typeof node === 'string') return [[path, node]]
  if (typeof node === 'function') return [[path, (node as (...args: unknown[]) => unknown)(SAMPLE, SAMPLE, SAMPLE)]]
  return Object.entries(node as object).flatMap(([key, value]) => texts(value, `${path}.${key}`))
}

test('the CLI speaks the language its locale asks for', () => {
  assert.equal(TEXT, TEXTS[languageOf(process.env)])
})

test('every text is there in each language, worded in it', () => {
  const spanish = new Map(texts(TEXTS.es))
  const english = new Map(texts(TEXTS.en))

  assert.deepEqual([...english.keys()], [...spanish.keys()])
  for (const [path, words] of english) {
    for (const [language, text] of [
      ['en', words],
      ['es', spanish.get(path)],
    ]) {
      assert.equal(typeof text, 'string', `${language}${path}`)
      assert.notEqual(String(text).trim(), '', `${language}${path}`)
    }
    // A command's usage line is the same in both but for the names of its values, which some lack.
    if (!/usage$/.test(path)) assert.notEqual(words, spanish.get(path), `en${path} is not translated`)
  }
})

test('the help of each command that takes a key says why it never goes on the command line', () => {
  for (const [language, words] of Object.entries(TEXTS)) {
    for (const name of ['serve', 'key', 'accept'] as const) {
      assert.match(words.commands[name].help(SAMPLE), /command line|línea de comandos/, `${language} ${name}`)
    }
  }
})
