# 1. The mod has no coverage or mutation figure

- **Practice set aside:** 100 % coverage and mutation testing, for `hooks/`.
- **Why:** `claude plugin test` measures neither, and Stryker needs Node, which the mod does not have. Its tests in
  `tests/mod/`, one file per module of `hooks/` named after it and what they share in `support.ts`, specify each
  behaviour; mutation and coverage apply to `cli/`.
- **Decided by:** proposed by an agent; awaiting the owner's approval.
