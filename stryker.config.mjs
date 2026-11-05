// Mutation testing of what Node tests (`pnpm mutation`), cli/ and the mod's pure modules: every surviving mutant is a
// missing test, or an equivalent one recorded in place with its reason.
export default {
  testRunner: 'command',
  commandRunner: {
    // The fast suite: tests/cli.test.mts drives the real CLI end to end, a process per command, so running it per
    // mutant would cost far more than it proves. TMPDIR points into Stryker's sandbox, which it deletes: a run cut
    // short by its timeout never cleans up after itself.
    command:
      'mkdir -p .t && TMPDIR="$PWD/.t" LC_ALL=es_ES.UTF-8 NODE_OPTIONS=--import=./tests/offline.mts node --test ' +
      'tests/args.test.mts tests/hub.test.mts ' +
      'tests/link.test.mts tests/home.test.mts tests/wire.test.mts tests/protocol.test.mts tests/strings.test.mts ' +
      'tests/mod/addresses.test.mts tests/mod/chat.test.mts',
  },
  // The entry point only wires the commands to the modules that act: its end-to-end tests cover it.
  mutate: ['cli/**/*.mts', '!cli/claude-colab.mts', 'hooks/addresses.ts', 'hooks/chat.ts'],
  // Stryker would read them with TypeScript's JS API, which TypeScript 7 no longer has; the tests run without them.
  ignorePatterns: ['tsconfig.json', 'tsconfig.cli.json'],
  // Off, and with it incremental mode: a command is one test to Stryker, which could then tell neither which tests
  // cover a mutant nor which changed, and would reuse a result a changed test no longer earns.
  coverageAnalysis: 'off',
  // Low: each mutant runs the whole command.
  concurrency: 3,
  timeoutMS: 5000,
  reporters: ['clear-text', 'progress'],
  thresholds: { high: 100, low: 100, break: 100 },
}
