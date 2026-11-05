# 5. `serve` listens on every interface by default

- **Practice set aside:** binding a server to loopback.
- **Why:** others have to reach it. The key guards it: without it nobody gets past the handshake, and connections
  waiting on it are capped and cut.
- **Decided by:** proposed by an agent; awaiting the owner's approval.
