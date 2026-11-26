// Runs with Vitest: what a release changes in the files that hold its version and its changes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import {
  bumpManifest,
  nextVersion,
  pinMarketplace,
  releaseChangelog,
  sourceMarketplace,
  tagOf,
} from '../scripts/bump.mts'

// The manifest's own version, while no tag holds it, is the one being prepared: the tag's check turns it down after.
test('the next version is a plain x.y.z, not below the current one', () => {
  for (const [current, wanted] of [
    ['0.1.0', '0.1.0'],
    ['0.1.0', '0.1.1'],
    ['0.1.0', '0.2.0'],
    ['0.9.9', '1.0.0'],
    ['1.2.3', '1.10.0'],
  ] as const) {
    assert.equal(nextVersion(current, wanted), wanted)
  }
  for (const wanted of ['0.0.9', '0.0.10', '0.1', '0.2.0-rc.1', 'v0.2.0', '01.0.0', '']) {
    assert.throws(() => nextVersion('0.1.0', wanted), /x\.y\.z, not below 0\.1\.0/, wanted)
  }
})

test('the manifest changes only in its version, wherever the field sits', () => {
  const manifest = '{\n  "name": "colab",\n  "version": "0.1.0",\n  "author": { "name": "A" }\n}\n'
  assert.equal(
    bumpManifest(manifest, '0.2.0'),
    '{\n  "name": "colab",\n  "version": "0.2.0",\n  "author": { "name": "A" }\n}\n',
  )
  assert.throws(() => bumpManifest('{ "name": "colab" }', '0.2.0'), /no version/)
})

test('the marketplace changes only in the tag or the repository its plugin comes from', () => {
  const source = (ref: string, url: string) =>
    `{\n  "plugins": [\n    {\n      "name": "colab",\n      "source": { "source": "git-subdir", "url": "${url}", "path": "plugins/colab", "ref": "${ref}" }\n    }\n  ]\n}\n`
  const repository = 'https://github.com/alvaromr/claude-colab.git'
  const marketplace = source('colab--v0.1.0', repository)
  assert.equal(pinMarketplace(marketplace, 'colab--v0.2.0'), source('colab--v0.2.0', repository))
  assert.equal(sourceMarketplace(marketplace, 'file:///tmp/clone'), source('colab--v0.1.0', 'file:///tmp/clone'))
  assert.throws(() => pinMarketplace(`{ "url": "${repository}" }`, 'colab--v0.2.0'), /marketplace\.json has no ref/)
  assert.throws(() => sourceMarketplace('{ "plugins": [] }', 'file:///tmp/clone'), /marketplace\.json has no url/)
})

// Claude Code clones a `git-subdir` plugin by its URL as written, and turns `owner/repo` into an SSH URL: the clone
// fails for anyone without an SSH key on GitHub or GitHub's host key in known_hosts.
test('the marketplace reaches its plugin by HTTPS, which anyone can clone, and a release keeps it so', () => {
  const source = (url: string) => `{ "plugins": [{ "source": { "url": "${url}", "ref": "colab--v0.1.0" } }] }`
  for (const url of [
    'alvaromr/claude-colab',
    'ssh://github.com/alvaromr/claude-colab.git',
    'https://github.com/alvaromr/claude-colab',
    'http://github.com/alvaromr/claude-colab.git',
  ]) {
    assert.throws(
      () => pinMarketplace(source(url), 'colab--v0.2.0'),
      /https:\/\/github\.com\/<owner>\/<repo>\.git/,
      url,
    )
  }
  assert.throws(() => pinMarketplace('{ "plugins": [{ "ref": "colab--v0.1.0" }] }', 'colab--v0.2.0'), /no url/)
  const ours = readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8')
  assert.doesNotThrow(() => pinMarketplace(ours, 'colab--v0.2.0'))
})

test('the changelog’s Unreleased becomes the version, dated, under an empty Unreleased', () => {
  const head = '# Changelog\n\nIntro.\n\n'
  assert.equal(
    releaseChangelog(
      `${head}## [Unreleased]\n\n### Added\n\n- A.\n\n## [0.1.0] - 2026-01-01\n\n- B.\n`,
      '0.2.0',
      '2026-10-30',
    ),
    `${head}## [Unreleased]\n\n## [0.2.0] - 2026-10-30\n\n### Added\n\n- A.\n\n## [0.1.0] - 2026-01-01\n\n- B.\n`,
  )
  assert.equal(
    releaseChangelog(`${head}## [Unreleased]\n\n- A.\n`, '0.1.0', '2026-10-30'),
    `${head}## [Unreleased]\n\n## [0.1.0] - 2026-10-30\n\n- A.\n`,
  )
  assert.throws(
    () => releaseChangelog(`${head}## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n`, '0.2.0', '2026-10-30'),
    /empty/,
  )
  assert.throws(() => releaseChangelog(`${head}## [Unreleased]\n`, '0.2.0', '2026-10-30'), /empty/)
  assert.throws(() => releaseChangelog(head, '0.2.0', '2026-10-30'), /no \[Unreleased\]/)
})

test('a release’s tag is the plugin’s name and its version, as `claude plugin tag` makes it', () => {
  assert.equal(tagOf('colab', '0.2.0'), 'colab--v0.2.0')
})
