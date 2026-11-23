// What a mutation run mutates (`mutation.mts`), pure: of the modules mutated, those whose mutants a change since the
// last run that passed can give another result, and all of them when nothing passed yet, Stryker changed, or its
// config changed how the tests run. Any other mutant gives the result it gave last time, so running it again proves
// nothing new.
import { matchesGlob, posix } from 'node:path'

/**
 * What Stryker is told: what to mutate, the test files it runs and Vitest's config, which names what every test
 * loads first; besides keys that change neither.
 */
export interface Config {
  mutate: readonly string[]
  testFiles: readonly string[]
  vitest: { configFile: string }
  [key: string]: unknown
}

/** A mutation setup: its config, the files it mutates, and the tools that make its mutants (`toolsOf`). */
export interface Setup {
  config: Config
  mutated: readonly string[]
  tools: readonly string[]
}

/** The files each file imports, by path from the repository's root. */
export type Imports = Readonly<Record<string, readonly string[]>>

// Config keys that change neither which mutants exist nor how their tests run; `mutate` counts by the files it takes.
const UNSEEN = new Set(['mutate', 'concurrency', 'reporters', 'thresholds'])
// Stryker makes the mutants, from what Babel parses: another version of either may make others.
const TOOLS = /^ {2}'?((?:@stryker-mutator|@babel)\/[^@'(]+@[^'(:]+)/gm
const SPECIFIERS = [/\bfrom\s+'([^']+)'/g, /^import\s+'([^']+)'/gm, /\bimport\('([^']+)'\)/g, /\bnew URL\('([^']+)'/g]

/** The files, of `files`, that a pattern of `patterns` takes and no negated one (`!…`) gives back. */
export const matching = (patterns: readonly string[], files: readonly string[]) =>
  files.filter(
    file =>
      patterns.some(pattern => !pattern.startsWith('!') && matchesGlob(file, pattern)) &&
      !patterns.some(pattern => pattern.startsWith('!') && matchesGlob(file, pattern.slice(1))),
  )

/** The Stryker and Babel packages a lockfile's text resolves, by name and version, each once. */
export const toolsOf = (lock: string) => [...new Set(Array.from(lock.matchAll(TOOLS), found => String(found[1])))]

/** The files that `file`, of text `text`, imports by a relative specifier: static, dynamic, or as a URL. */
export const importsOf = (file: string, text: string) =>
  SPECIFIERS.flatMap(pattern => Array.from(text.matchAll(pattern), found => String(found[1])))
    .filter(specifier => specifier.startsWith('.'))
    .map(specifier => posix.join(posix.dirname(file), specifier))

/** `files` and every file they import, however deep. */
function closure(files: readonly string[], imports: Imports) {
  const reached = new Set<string>()
  const visit = (file: string) => {
    if (reached.has(file)) return
    reached.add(file)
    for (const imported of imports[file] ?? []) visit(imported)
  }
  for (const file of files) visit(file)
  return reached
}

/**
 * The files to mutate, of `now.mutated`, given the files `changed` since the last passing run and its setup (`last`,
 * `undefined` if none passed); or why every one is.
 */
export function mutationScope(
  now: Setup,
  imports: Imports,
  last: { changed: readonly string[]; setup: Setup } | undefined,
) {
  if (last === undefined) return { full: 'no earlier result' }
  if (String(now.tools) !== String(last.setup.tools)) return { full: 'Stryker or its parser changed' }
  const seen = (config: Config) => JSON.stringify(Object.entries(config).filter(([key]) => !UNSEEN.has(key)))
  if (seen(now.config) !== seen(last.setup.config)) return { full: 'stryker.config.mjs changes how the tests run' }

  const tests = matching(now.config.testFiles, Object.keys(imports))
  const changed = new Set(last.changed)
  // A mutant runs its module, what it imports, Vitest's config with what it loads before every test, and every test
  // file that reaches it, with what that imports.
  const reaches = (file: string) => {
    const reach = closure([file, now.config.vitest.configFile], imports)
    for (const test of tests) {
      const ran = closure([test], imports)
      if (ran.has(file)) for (const reached of ran) reach.add(reached)
    }
    return [...reach].some(reached => changed.has(reached))
  }
  return { files: now.mutated.filter(file => !last.setup.mutated.includes(file) || reaches(file)) }
}
