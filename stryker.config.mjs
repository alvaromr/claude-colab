// Mutation testing of what Node tests (`pnpm mutation`), cli/ and the mod's pure modules: every surviving mutant is a
// missing test, or an equivalent one recorded in place with its reason.
export default {
  // Vitest, with its config, which picks the fast suite (MUTATION_TESTS): each mutant runs only the tests that cover
  // it, and one of a module's top level, which runs before any test, all of them.
  testRunner: 'vitest',
  // Named, since pnpm keeps it out of the folders where Stryker looks for its plugins by itself.
  plugins: ['@stryker-mutator/vitest-runner'],
  // As `pnpm test:node` runs them: each test file in a process of its own (forks, not the runner's default threads,
  // where a test's HOME never reaches os.homedir()), and every one of the suite for a mutant of a module's top level,
  // not those Vitest finds related to the module, which it finds none of when it imports them as Node does.
  vitest: { configFile: 'vitest.config.mts', pool: 'forks', related: false },
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
