// The repo is public: nothing it versions holds a secret of colab's, an address of a real network, a person's email or
// a path of someone's machine. Checks every file git tracks or would add; prints each finding and exits 1 on any.
// And the plugin ships the repo's licence word for word (docs/decisions/12).
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// Written by pnpm: its integrity hashes look like keys.
const SKIPPED = new Set(['pnpm-lock.yaml'])
// Loopback, any, and the ranges set aside for documentation (RFC 5737), which reach no one.
const KNOWN_ADDRESS = /^(127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/
// The licence an install copies: the plugin's folder is all it takes.
const PLUGIN_LICENSE = 'plugins/colab/LICENSE'

const RULES: [string, RegExp, (found: string) => boolean][] = [
  ['an invitation', /colab:[\w-]{40,}/g, () => true],
  ['a key', /(?<![\w-])[\w-]{43}(?![\w-])/g, found => /\d/.test(found) && /[A-Z]/.test(found) && /[a-z]/.test(found)],
  ['an IPv4 address', /\b\d{1,3}(\.\d{1,3}){3}\b/g, found => !KNOWN_ADDRESS.test(found)],
  [
    'an email address',
    /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}\b/gi,
    found => !found.endsWith('@users.noreply.github.com'),
  ],
  ['a path of someone’s machine', /\/(Users|home)\/[\w.-]+\//g, found => !/^\/home\/(ana|bob)\/$/.test(found)],
]

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT })
  .toString()
  .split('\0')
  // One deleted but not yet staged as such holds nothing any more to check.
  .filter(file => file !== '' && !SKIPPED.has(file) && existsSync(new URL(file, `file://${ROOT}`)))
const read = (file: string) => readFileSync(new URL(file, `file://${ROOT}`), 'utf8')
const findings = files.flatMap(file =>
  read(file)
    .split('\n')
    .flatMap((line, n) =>
      RULES.flatMap(([what, pattern, isFinding]) =>
        [...line.matchAll(pattern)].filter(([found]) => isFinding(found)).map(() => `${file}:${n + 1}: ${what}`),
      ),
    ),
)
// A link would not do: an install from a tag drops any that leads out of the plugin's folder.
const isOwnFile = (file: string) => lstatSync(new URL(file, `file://${ROOT}`), { throwIfNoEntry: false })?.isFile()
if (!isOwnFile(PLUGIN_LICENSE) || read(PLUGIN_LICENSE) !== read('LICENSE')) {
  findings.push(`${PLUGIN_LICENSE}: not a file of its own with the text of LICENSE`)
}

if (findings.length === 0) process.stdout.write(`guard: ${files.length} files clean\n`)
else {
  process.stderr.write(`${findings.join('\n')}\n`)
  process.exitCode = 1
}
