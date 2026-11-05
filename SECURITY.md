# Security

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting on `alvaromr/claude-colab` (its **Security** tab,
**Report a vulnerability**: <https://github.com/alvaromr/claude-colab/security/advisories/new>), never in a public
issue. Say what an attacker needs (a key, a place on the network, a room's code),
what they get, and how to reproduce it.

## What colab protects

- **The link:** TLS 1.3 with a pre-shared key. Without the key nobody gets past the handshake, and a server that shows
  a certificate instead of using the key is refused. No address may hold more than a few connections at once, so a
  flood from one machine cannot keep the others out.
- **A room:** only who holds its code gets in, and each connection sees only its room.
- **The keys:** saved readable by their owner alone, refused when they are not, and never passed on the command line.
- **The session:** what arrives from a room reaches the model as quoted context from a third party, cleaned of
  characters that hide or reorder text, never as instructions.

Whoever holds an invitation is trusted with the room and the server: names are declared, not verified. The risks
accepted on purpose, with their reasons, are in `docs/decisions/`.
