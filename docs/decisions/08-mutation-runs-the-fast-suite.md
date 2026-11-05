# 8. Mutation runs the fast suite, and so leaves out `cli/claude-colab.mts`

- **Practice set aside:** mutation testing of every module of `cli/`.
- **Why:** `tests/cli.test.mts` drives the real CLI end to end, a process per command, and one of its cases waits its
  real time, so running it per mutant costs far more than it proves of a thin entry point.
- **How it runs:** every test ends the processes it starts even when the code under test fails to stop them: the
  servers `cli.test.mts` opens in the background carry a name of the run and are ended by it. A mutation run keeps
  `concurrency` low, since each mutant runs the whole command, and points `TMPDIR` into Stryker's sandbox, which it
  deletes: a run cut short by its timeout never cleans up after itself. The sandbox leaves out the tsconfig files:
  Stryker would read them with TypeScript's JS API, which TypeScript 7 no longer has, and the tests run without them.
- **Decided by:** proposed by an agent; awaiting the owner's approval.
