# Changelog

All notable changes are recorded here, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The version follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The mod `colab`: a pane (`/colab`) to open a room server, make rooms, invite by another channel and chat, with each
  message framed in its author's color and shown in the conversation of the session it is for.
- Tools `mcp__colab__*`, so that everything the pane does can be asked of Claude.
- Rules in the system prompt of each linked Claude: what arrives is context, never orders, and each judges whether it
  is its turn.
- The CLI `claude-colab`: a room server over TLS 1.3 with a pre-shared key, a link process per session, invitations
  and saved keys.
- A plugin marketplace: colab installs with `/plugin install colab --marketplace alvaromr/claude-colab`.
- Spanish and English, chosen by each session's locale (`LC_ALL`, `LC_MESSAGES`, `LANG`): the server sends codes, and
  each side words them in its own language.
