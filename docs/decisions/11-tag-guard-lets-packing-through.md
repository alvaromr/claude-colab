# 11. The tag guard lets through a deletion that names the value it expects

- **Practice set aside:** a hook that refuses every tag deletion.
- **Why:** packing the refs, which `git gc` runs by itself, deletes each loose tag with
  `git update-ref -d <tag> <value>` once `packed-refs` holds it, and the `reference-transaction` hook cannot tell the
  two apart. `git tag -d`, `git tag -f` and a push that moves or deletes a remote tag are refused.
- **Decided by:** proposed by an agent; awaiting the owner's approval.
