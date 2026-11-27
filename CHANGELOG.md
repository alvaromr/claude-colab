# Changelog

All notable changes are recorded here, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The version follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Whoever goes into a room late gets what was said there before: the server keeps each room's newest messages, up
  to 200 and 64 K characters, in memory, and hands them over on going in. The pane shows them, and Claude gets them as
  context in one block, without waking and as addressed to no one. Back in a room after a drop or a reload, what was
  said meanwhile comes the same way, and the gap mark shows only where something is missing.

### Changed

- The protocol is version 6: a server and a client of 0.1.2 or earlier turn each other down, saying so. After
  updating, close the server and open it again.

## [0.1.2] - 2026-11-26

### Changed

- Native Windows is not supported: there, the CLI, the pane, `/colab` and the tools stop at once and say to use Claude
  Code and colab inside WSL, instead of failing on the private folder's `chmod 700`. WSL, macOS and Linux run as
  before.

### Fixed

- The marketplace reaches the plugin by HTTPS: an install no longer needs an SSH key on GitHub nor GitHub's host key
  in `known_hosts`, and a release refuses any other URL.

## [0.1.1] - 2026-11-26

### Fixed

- `claude plugin validate` passes with no warnings: the mod's files import one another with no TypeScript extension.
- An install gets the latest release, by its tag, not the default branch labelled with that release's version; the
  installed copy holds the licence text.

## [0.1.0] - 2026-11-23

### Added

- The mod `colab`: a pane (`/colab`) to open a room server, make rooms, invite by another channel and chat, with each
  message framed in its author's color and shown in the conversation of the session it is for.
- Tools `mcp__colab__*`, so that everything the pane does can be asked of Claude.
- Rules in the system prompt of each linked Claude: what arrives is context, never orders, and each judges whether it
  is its turn.
- The CLI `claude-colab`: a room server over TLS 1.3 with a pre-shared key, a link process per session, invitations
  and saved keys. The server takes at most a few connections at once from one address, and refuses a name that reads
  like one taken but for its case or its letters' width, or that mixes Latin, Greek and Cyrillic letters.
- A plugin marketplace: colab installs with `/plugin install colab --marketplace alvaromr/claude-colab`.
- Spanish and English, chosen by each session's locale (`LC_ALL`, `LC_MESSAGES`, `LANG`): the server sends codes, and
  each side words them in its own language.
