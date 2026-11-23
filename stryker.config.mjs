// Mutation testing of what Node tests (`pnpm mutation`), cli/ and the mod's pure modules: every surviving mutant is a
// missing test, or an equivalent one recorded in place with its reason.
export default {
  // Vitest, as `pnpm test:node` runs it, with its config: each mutant runs only the tests that cover it.
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mts' },
  // The fast suite: tests/cli.test.mts drives the real CLI end to end, a process per command, so running it per
  // mutant would cost far more than it proves; those of the scripts run no mutated code.
  testFiles: [
    'tests/args.test.mts',
    'tests/rooms.test.mts',
    'tests/hub.test.mts',
    'tests/link.test.mts',
    'tests/home.test.mts',
    'tests/wire.test.mts',
    'tests/protocol.test.mts',
    'tests/strings.test.mts',
    'tests/mod/addresses.test.mts',
    'tests/mod/chat.test.mts',
    'tests/mod/linking.test.mts',
  ],
  // The entry point only wires the commands to the modules that act: its end-to-end tests cover it.
  mutate: [
    'plugins/colab/cli/**/*.mts',
    '!plugins/colab/cli/claude-colab.mts',
    'plugins/colab/hooks/addresses.ts',
    'plugins/colab/hooks/chat.ts',
    'plugins/colab/hooks/linking.ts',
  ],
  // Stryker would read them with TypeScript's JS API, which TypeScript 7 no longer has; the tests run without them.
  ignorePatterns: ['tsconfig.json', 'tsconfig.cli.json'],
  // Low, well under half the cores: the tests start servers and processes of their own.
  concurrency: 3,
  reporters: ['clear-text', 'progress'],
  thresholds: { high: 100, low: 100, break: 100 },
}
