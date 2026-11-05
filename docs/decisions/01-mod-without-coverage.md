# 1. The mod's engine code has no coverage or mutation figure

- **Practice set aside:** 100 % coverage and mutation testing, for the files of `hooks/` that run on the engine.
- **Why:** `claude plugin test` measures neither, and Stryker needs Node, which the engine does not give the mod. What
  needs no engine lives apart, in `hooks/addresses.ts` and `hooks/chat.ts`, which Node tests with both. The rest,
  tested in `tests/mod/`, one file per module of `hooks/` named after it and what they share in `support.ts`, is the
  engine's glue: its state, its rows, its pane and its processes.
- **Decided by:** proposed by an agent; awaiting the owner's approval.
