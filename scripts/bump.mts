// What a release changes in the files that hold its version and its changes, as pure text: `release.mts` reads and
// writes them.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const UNRELEASED = '## [Unreleased]\n'

/** `wanted`, once it is a plain x.y.z not below `current`, the manifest's own while no tag holds it; throws otherwise. */
export function nextVersion(current: string, wanted: string) {
  // Numeric collation compares each run of digits as a number: 1.10.0 is above 1.2.3.
  const below = new Intl.Collator('en', { numeric: true }).compare(wanted, current) < 0
  if (!VERSION.test(wanted) || below) throw new Error(`the version must be x.y.z, not below ${current}: “${wanted}”`)
  return wanted
}

/** The JSON `text` of `file` with its first string `field` set to `value`, and nothing else changed. */
function withField(text: string, file: string, field: string, value: string) {
  const pattern = new RegExp(`"${field}": "[^"]*"`)
  if (!pattern.test(text)) throw new Error(`${file} has no ${field}`)
  return text.replace(pattern, `"${field}": "${value}"`)
}

/** plugin.json's text with `version` as its version. */
export const bumpManifest = (manifest: string, version: string) =>
  withField(manifest, 'plugin.json', 'version', version)

/** marketplace.json's text with its plugin from the release's `tag`: what an install gets. */
export const pinMarketplace = (marketplace: string, tag: string) =>
  withField(marketplace, 'marketplace.json', 'ref', tag)

/** marketplace.json's text with its plugin from the repository at `url`: the release's clone, for its smoke. */
export const sourceMarketplace = (marketplace: string, url: string) =>
  withField(marketplace, 'marketplace.json', 'url', url)

/** CHANGELOG.md's text with what Unreleased holds moved under `version`, dated, and Unreleased left empty. */
export function releaseChangelog(changelog: string, version: string, date: string) {
  const start = changelog.indexOf(UNRELEASED)
  if (start === -1) throw new Error('CHANGELOG.md has no [Unreleased] section')
  const body = changelog.slice(start + UNRELEASED.length)
  const end = body.search(/^## /m)
  const changes = (end === -1 ? body : body.slice(0, end)).trim()
  if (changes === '') throw new Error('CHANGELOG.md’s [Unreleased] section is empty: there is nothing to release')
  return `${changelog.slice(0, start)}${UNRELEASED}\n## [${version}] - ${date}\n\n${body.trimStart()}`
}

/** The tag of a release, as `claude plugin tag` names it. */
export function tagOf(plugin: string, version: string) {
  return `${plugin}--v${version}`
}
