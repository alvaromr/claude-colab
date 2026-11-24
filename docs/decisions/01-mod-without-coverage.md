# 1. The mod's engine code has no coverage figure

- **Practice set aside:** 100 % coverage, for the files of `hooks/` that run on the engine.
- **Why:** `claude plugin test` does not measure it. What needs no engine, every decision the mod takes, lives apart,
  in its pure modules (`AGENTS.md`, Architecture), which Node tests with coverage. The rest, tested in `tests/mod/`,
  one file per module of `hooks/` named after it and what they share in `support.ts`, is the engine's glue: the order
  of its steps, its state, its rows, its pane and its processes.
- **Decided by:** proposed by an agent; approved by the owner.
