# 12. The licence is in two files

- **Practice set aside:** stating each fact once, in one place.
- **Why:** GitHub reads the root's `LICENSE`, and an install copies only the plugin's folder, from the tag its
  marketplace pins, dropping any link that leads out of it: so `plugins/colab/LICENSE` is a file of its own. The repo
  guard (`pnpm guard`) fails if it is not one, or if its text is not the root's.
- **Decided by:** proposed by an agent; approved by the owner.
