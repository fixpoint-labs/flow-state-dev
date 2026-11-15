---
title: Chat with a flow from the terminal
type: recipe
description: "`fsdev chat` opens a persistent terminal session over your flows."
---

# Chat with a flow from the terminal

`fsdev chat` opens a persistent terminal session over your flows. Your messages go to the flow you're talking to, and replies stream back live. Each turn runs a flow action, and the conversation carries across turns.

## Starting a session

```bash
pnpm fsdev chat hello-chat chat
```

The two arguments are a flow kind and an action, the same pair `fsdev run` takes. That flow becomes the **default target**: where your typed messages go. `fsdev chat` finds your flows the way `fsdev run` does: from `fsdev.config.ts` in the current directory if there is one, otherwise from `src/flows/` and `flows/`. See the [CLI reference](../reference/cli.md).

You can leave the target out:

- **One flow, one action** in the project: `fsdev chat` binds it automatically.
- **Several available**: the session starts unbound. `/targets` lists them and `/use <flow>` picks one.
- **A config default**: set `chat: { default: "hello-chat.chat" }` on `createFlowState` and a bare `fsdev chat` binds it.
- **No flows at all**: an error.

## Sending messages

Anything that isn't a command is a message. It's sent to the default target as `{ message: "<your text>" }`, so the target's action needs to accept that shape.

If the action's input schema rejects `{ message }`, the turn fails with the validation error and a note that the target isn't chat-shaped. The session stays open, so `/use` another target and keep going.

While a turn runs, a block's status, such as "Searching the knowledge base...", shows as one line that updates in place until the reply or a tool call arrives. Piped output doesn't show it.

## Slash commands

A line beginning with `/` is a command.

| Command | What it does |
|---------|--------------|
| `/help` | List the commands. |
| `/targets` | List the available `flow · action` targets; the current default is marked. |
| `/use <flow> [action]` | Switch the default target. Omit the action when the flow has only one. |
| `/status` | Show the current target, session id, turn count, who turns run as, and where the config and store came from. |
| `/session [new\|<id>]` | Print the current flow's session id, start a new one (`new`), or bind an existing one. |
| `/exit` | Leave the session. Ctrl-D and a double Ctrl-C do the same. |

A line like `/name args` (lowercase letters, digits and hyphens in the name) that no built-in claims goes to the flow as typed, so a flow can handle its own `/name args` commands. Any other line starting with `/`, such as `/etc/hosts` or `/Foo`, prints a hint and isn't sent. To send a literal message that starts with `/`, put a space in front of it.

## Sessions and state

Within one `fsdev chat` process, each flow kind gets its own session, so history and state don't bleed across a `/use` switch. Switch away and back and the first session resumes.

With no `fsdev.config.ts`, history is saved to `.fsdev/data/fsdev.db`, the database the DevTool reads. With a config, chat uses your app's own stores, and a conversation survives restarting `fsdev chat` only if those stores persist. With no `stores` option, state lives in memory.

When a turn stops for a user's answer, the session prints the question it is waiting on and that question's id. See [Human in the loop](./human-in-the-loop.md).

Turns run as the user your app's resolver returns. The resolver is the function in your config that says which user a request runs as. With none, turns run as `devuser`, the DevTool's default user, in the development organization (`__fsd_default_org__`). If the resolver refuses the request, that turn fails and the chat keeps going. Pass `--org <id>` to name the organization yourself; turns then run as `--user <id>`, or `devuser` if you give none. See [Auth and tenancy](../concepts/auth-and-tenancy.md).

### Resume yesterday's session

Copy the id from the opening line, `/status`, or the DevTool's session list, then start with it:

```bash
pnpm fsdev chat hello-chat chat --session sess_1760000000000_ab12cd
```

`--session <id>` resumes that session for the flow you start with, so it needs a flow bound at start. With several flows and no `chat.default`, a bare `fsdev chat --session <id>` is an error: name the flow, or start the chat and run `/use <flow>`, then `/session <id>`. An id from a different flow ends the command with an error naming its flow. An id that doesn't exist isn't an error: you get a new, empty session labelled "resumed". Resume as the same user and organization that created the session, or the turn is refused. With no config, run it from the same directory, since history lives in that directory's `.fsdev/data/`.

Inside a running chat, `/use <flow>` then `/session <id>` does the same. There, an id from another flow prints which flow it belongs to and keeps the current session. `/session new` starts over; the old session stays stored.

## A session

```text
$ pnpm fsdev chat hello-chat chat
Chatting with hello-chat · chat (session sess_1760000000000_ab12cd).
Type /help for commands, /exit to quit.
❯ My name is Ada.
Nice to meet you, Ada. How can I help?
❯ What is my name?
Your name is Ada.
❯ /status
Target:  hello-chat · chat
Session: sess_1760000000000_ab12cd
Turns:   2
Org:     __fsd_default_org__ (user devuser, development-default)
Source:  config (fsdev.config.ts)
Store:   app-configured stores
❯ /exit
```

## Next steps

- [Build with your coding agent](../start/build-with-your-coding-agent.md): the non-interactive edit → `fsdev run` → read loop.
- [CLI reference](../reference/cli.md): every `fsdev chat` flag and command, and how `chat` differs from `run` and `dev`.
