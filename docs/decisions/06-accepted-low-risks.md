# 6. Accepted low risks

- `privateFolder` checks only the folder itself, not those above: it matters only with `--socket` in someone else's
  folder.
- `CLAUDE_COLAB_KEY` reaches every child of the session: only if the person exports it, and any process of theirs can
  read the key files anyway.
- Two `connect` started at once on one socket race.
- Names with homoglyphs pass for others' names.

**Decided by:** proposed by an agent; awaiting the owner's approval.
