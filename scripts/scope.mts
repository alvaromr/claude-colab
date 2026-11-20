// What a mutation run mutates (`mutation.mts`), pure: the modules a change touched since the last run that passed, or
// all of them when nothing passed yet or something every mutant depends on changed. Mutants a change did not touch
// give the result they gave last time, so running them again proves nothing new.

/**
 * What every mutant depends on: the mutation and test setup, the dependencies (any change to them changes the
 * lockfile), the Node they run on.
 */
export const SHARED = [
  'stryker.config.mjs',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.node-version',
  'tests/offline.mts',
]

/** The module a test file tests, by name: `tests/<x>.test.mts` tests `cli/<x>.mts`, `tests/mod/<x>.test.*` `hooks/<x>.*`. */
const testedBy = (test: string) => {
  const found = /^tests\/(mod\/)?([^/]+)\.test\.[^.]+$/.exec(test)
  return found && `${found[1] ? 'hooks' : 'cli'}/${found[2]}.`
}

/**
 * The files to mutate, of `mutated`, given the files `changed` since the last passing run (`undefined` if none passed);
 * or why the run is full.
 */
export function mutationScope(changed: readonly string[] | undefined, mutated: readonly string[]) {
  if (changed === undefined) return { full: 'no earlier result' }
  const shared = changed.find(file => SHARED.includes(file))
  if (shared !== undefined) return { full: `${shared} changed` }
  const stems = changed.map(testedBy).filter(stem => stem !== null)
  return {
    files: mutated.filter(file => changed.includes(file) || stems.some(stem => file.startsWith(stem))),
  }
}
