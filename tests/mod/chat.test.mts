// Runs with `node --test tests/`, as the CLI's: what a message becomes on its way in, and what the chat makes room for.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleaned, colorOf, farthestBack, quoted, rowsOf } from '../../hooks/chat.ts'

test('a message loses what could redraw the terminal or hide text, and keeps its tabs and lines', () => {
  const hidden = ['\u0000', '\u0008', '\u000B', '\u001B', '\u007F', '\u009F', '؜', '​', '‎', '‏']
  const more = [' ', ' ', '‪', '‮', '⁠', '⁦', '⁩', '﻿', '\u{E0000}', '\u{E007F}']
  for (const mark of [...hidden, ...more]) {
    assert.equal(cleaned(`a${mark}b${mark}`), 'ab', `U+${mark.codePointAt(0)?.toString(16)}`)
  }
  assert.equal(cleaned('a\tb\nc ñ 😀 ‍'), 'a\tb\nc ñ 😀 ‍', 'tabs, lines, letters and joiners stay')
})

test('a message goes to the model quoted line by line', () => {
  assert.equal(quoted('hola'), '> hola')
  assert.equal(quoted('uno\n\ndos'), '> uno\n> \n> dos')
})

test('each connection takes the color of its number, round again past the last; one with none, the theme’s', () => {
  const palette = ['#4E9BF5', '#E5A33B', '#4CB782', '#C678DD', '#E06C75', '#2BB5C2', '#D4B83A', '#9C8BF0']
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(colorOf), palette)
  assert.equal(colorOf(8), '#4E9BF5')
  assert.equal(colorOf(undefined), 'suggestion')
  assert.equal(colorOf(-1), 'suggestion', 'nor one no server gives')
})

test('a text takes a row per line, more where a line wraps, and never none', () => {
  assert.equal(rowsOf('', 10), 1)
  assert.equal(rowsOf('a'.repeat(10), 10), 1)
  assert.equal(rowsOf('a'.repeat(11), 10), 2)
  assert.equal(rowsOf('uno\ndos', 10), 2)
  assert.equal(rowsOf('abc', 0), 3, 'no columns: one a character')
})

test('the chat scrolls back only as far as the older messages still fill its rows', () => {
  // Oldest first, as the log keeps them: each box takes 3 rows and its text, and a row apart.
  const lines = [{ text: 'uno' }, { text: 'dos' }, { text: '', gap: true as const }, { text: 'tres' }]
  assert.equal(farthestBack(lines, 20, 100, 'hueco'), 0, 'they do not even fill it')
  assert.equal(farthestBack(lines, 20, 4, 'hueco'), 3, 'the oldest alone fills it: the other 3 may be passed')
  assert.equal(farthestBack(lines, 20, 5, 'hueco'), 2, 'the second, a row apart, fills it')
  assert.equal(farthestBack(lines, 20, 9, 'hueco'), 2)
  assert.equal(farthestBack(lines, 20, 10, 'hueco'), 1, 'and the gap, a row of its own and one apart')
  assert.equal(farthestBack(lines, 20, 11, 'hueco'), 1)
  assert.equal(farthestBack(lines, 20, 15, 'hueco'), 0, 'all of them fill it')
  assert.equal(farthestBack(lines, 4, 10, 'h'.repeat(9)), 2, 'a gap wrapped takes its rows')
  assert.equal(farthestBack([], 20, 1, 'hueco'), 0)
})
