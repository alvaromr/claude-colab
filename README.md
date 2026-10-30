# claude-colab

Connects the Claude Code sessions of different people, each on their own machine, so that they pass each other
messages (context, tasks, results) without copying and pasting by hand. Each person and their Claude write in a shared
room; what arrives shows in the others' conversations, and their Claude judges it as context, never as an order.

The machines connect directly, over a LAN or a VPN, encrypted with a key only those invited hold. Nothing goes through
a third-party service.

The pane, the CLI and what colab tells each Claude are in Spanish where the session's locale is Spanish, and in English
anywhere else. The locale is the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that is set, as for any command. To get
Spanish on a machine whose locale is English, set `LC_MESSAGES` to `es_ES.UTF-8` in the `env` of Claude Code's
settings. People in one room may use different languages.

## Requirements

- **Claude Code 2.1.224 or later:** colab delivers messages through the session's inbox, which arrived in that version.
- **Node.js 26 or later**, on the `PATH` as `node`.
- **macOS or Linux:** each session talks to its link process over a Unix socket. Windows is untested.
- **Network:** the machine that opens the server must be reachable over TCP from the others, on its port. A LAN works,
  or any VPN that does not isolate its clients from each other.

## Install

Clone the repo and start Claude Code with it as a plugin:

```sh
git clone <repo-url> claude-colab
claude --plugin-dir ./claude-colab
```

## Quick start

1. **The host** opens the pane with `/colab` and presses **Open server**. The server stays open in the background, even
   after the session ends.
2. Linked to their server, they press **New room** and then **Copy invitation**.
3. They pass the invitation to the guest **by another channel** (a private chat, in person): it carries the server's
   key.
4. **The guest** opens `/colab`, pastes the invitation into its field and presses Enter, which takes them straight into
   the room.

From then on, each writes in the pane, with `/colab <text>`, or by asking their Claude.

## Use

- **Pane (`/colab`):** the room's chat, who is in it and whose Claude is at work. Its 3 views go step by step: not
  linked, linked to a server, and in a room. The **i** button shows or hides each part's help.
- **Writing:** in the pane's field, with `/colab <text>`, or by asking Claude to say it in the room.
- **What arrives:** a message for you (addressed to you, or any in a room of 2) shows in your conversation, framed in
  its author's color, and wakes your Claude to judge it. The rest stays in the pane, as context for your Claude.
- **Anything can be asked of Claude:** opening or closing the server, linking, making a room, joining with an
  invitation, giving the invitation or leaving. It does so with its `mcp__colab__*` tools.
- **Reloads and drops:** colab remembers your server and your room, and goes back by itself.

## Concepts

- **Server:** one per machine, with a name (by default, the machine's). One person opens it and the others link to it.
  It encrypts with a key of its own, which is saved and reused when it opens again.
- **Room:** a conversation on a server. A secret code identifies it; its number is only for reading. Each session is
  in one room at a time and sees only its own. A room lasts as long as the server, even empty.
- **Invitation:** a text that starts with `colab:` and joins the server's addresses, its port, its key and the room's
  code. Whoever has it gets in.
- **Name:** how the others see you; by default, your system user. Your Claude signs as your name's Claude ("Bob's Claude", "Claude de Bob"). It is
  declared, not verified: anyone with the invitation can pick any name that is free.

## Security

What colab protects, whom it trusts, and how to report a vulnerability: `SECURITY.md`. What is up to you:

- **The invitation is the key:** pass it only by another trusted channel, never through the room itself.
- **Keys:** saved in `~/.claude-colab/keys`.
- **What arrives:** your Claude may read its own project to answer; changing anything, reading outside the project or
  reading credentials waits until you ask for it or approve it. A message's links show as in any answer of Claude's.

## CLI

The pane and the tools use the CLI `cli/claude-colab.mts`, which can also be used by hand. Its help is its
documentation:

```sh
node cli/claude-colab.mts --help
node cli/claude-colab.mts <command> --help
```

## Troubleshooting

- **«That machine cannot be reached»:** the machines do not reach each other. Check with `ping`, and that the server's
  port is open; some VPNs isolate their clients. With the macOS firewall on, it must allow incoming connections to
  `node`.
- **«No server is listening there»:** the server is closed, or on another port.
- **«The key does not match the server’s»:** the server was opened with another key (`--new-key`). Ask for a new
  invitation.
- **«… is a server of another version of claude-colab»:** the server runs older code. Whoever opened it closes and
  opens it from the pane, or with `node cli/claude-colab.mts stop` and `serve --background`.
- **«Someone on that server already uses your name»:** change **Your name** in the pane and link again.
- **«This session has no message inbox»:** update Claude Code.
- **«Port … is in use by another program»:** pick another in the pane's **Port** field.

## Contributing

How to work on it, its commands and its design are in `AGENTS.md`.

## License

MIT: see `LICENSE`.
