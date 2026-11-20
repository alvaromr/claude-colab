// Runs with `node --test tests/`, as the CLI's: what a message becomes on its way in, and what the chat makes room for.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appended,
  cleaned,
  colorOf,
  farthestBack,
  isForMe,
  lineOf,
  membersIn,
  quoted,
  rowsOf,
  shownTo,
  withGap,
} from '../../hooks/chat.ts'

const HERE = { code: 'c'.repeat(24), label: '1' }
const ON = { status: 'on', name: 'Ana' }
// A line of the chat, as the log keeps it.
const said = (n: number, more: Record<string, unknown> = {}) => ({
  ...HERE,
  n,
  from: 'Bob',
  by: 'person',
  text: 'eh',
  own: false,
  ...more,
})

test('a line joins the log last, numbered after the one before it, and the log keeps its newest alone', () => {
  assert.deepEqual(appended([], said(0), 3), [said(1)])
  assert.deepEqual(appended([said(1), said(2), said(3)], said(0), 3), [said(2), said(3), said(4)])
})

test('back in a room it was in, the log marks a gap once, until the room says something again', () => {
  const gap = said(3, { from: '', text: '', gap: true })
  assert.deepEqual(withGap([said(1), said(2)], HERE, 10), [said(1), said(2), gap])
  assert.deepEqual(withGap([said(1), said(2), gap], HERE, 10), [said(1), said(2), gap], 'one is there already')
  assert.deepEqual(withGap([said(1)], { ...HERE, code: 'd'.repeat(24) }, 10), [said(1)], 'a room never seen: none')
  const other = said(2, { code: 'd'.repeat(24) })
  assert.deepEqual(withGap([said(1), other], HERE, 2), [other, { ...gap, n: 3 }], 'kept to the newest too')
})

test('a room counts the members the server last listed for it; one it did not list, none', () => {
  const rooms = [{ ...HERE, members: ['Ana', 'Bob'], busy: [] }]
  assert.equal(membersIn(rooms, HERE.code), 2)
  assert.equal(membersIn(rooms, 'd'.repeat(24)), 0)
  assert.equal(membersIn(rooms, undefined), 0)
})

test('a message is for this session when addressed to its name, or to no one in a room of two', () => {
  assert.equal(isForMe({ own: false, to: 'Ana' }, ON, 5), true)
  assert.equal(isForMe({ own: false }, ON, 2), true)
  assert.equal(isForMe({ own: false }, ON, 3), false, 'to no one, among more')
  assert.equal(isForMe({ own: false, to: 'Eva' }, ON, 2), false, 'to someone else')
  assert.equal(isForMe({ own: true, to: 'Ana' }, ON, 2), false, 'its own')
  assert.equal(isForMe({ own: false }, { status: 'off' }, 2), false, 'not linked: no name to be addressed by')
})

test('a recipient shows only in a room of more than two, the one case where naming it tells anything', () => {
  assert.equal(shownTo('Eva', 3), 'Eva')
  assert.equal(shownTo('Eva', 2), undefined)
  for (const to of ['', undefined, 7]) assert.equal(shownTo(to, 3), undefined, String(to))
})

test('a message received becomes a line of the chat: cleaned, by its person unless it says otherwise', () => {
  const message = { ...HERE, from: 'Bob', text: 'ho​la', own: false, to: 'Eva' }
  assert.deepEqual(lineOf(message, 3), { ...said(0, { text: 'hola' }), to: 'Eva' })
  assert.deepEqual(lineOf({ ...message, by: 'claude' }, 2), said(0, { text: 'hola', by: 'claude' }))
  const hidden = { ...message, from: 'B‮ob', label: '1​', to: 'E\u0007va' }
  assert.deepEqual(lineOf(hidden, 3), lineOf(message, 3), 'who, where and to whom lose them too')
  const { to, ...toNoOne } = message
  assert.deepEqual(lineOf(toNoOne, 3), said(0, { text: 'hola' }), `to no one, not to ${to}`)
})

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
