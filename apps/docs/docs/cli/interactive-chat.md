---
sidebar_position: 4
title: "Interactive Chat"
sidebar_label: "Interactive chat"
---

# Interactive chat

`fsdev chat` opens a persistent terminal session over your flows. Type a message, it routes to whichever flow is driving, and the reply streams back live. It's a REPL — a read-eval-print loop, the same shape as a Python or Node shell — except each turn runs a flow action and the conversation persists across turns.

Every other way to talk to a flow-state project is one-shot: `fsdev run` executes a single action, the DevTool drives one request at a time from the browser. `fsdev chat` is the one that holds a live session you can talk to.

## Starting a session

```bash
fsdev chat hello-chat chat
```

The two positional arguments are a flow kind and an action — the same pair `fsdev run` takes. That flow becomes the **default target**: the flow and action your typed messages route to. Runtime resolution is identical to `fsdev run` — an `fsdev.config.ts` in the cwd wins, otherwise flows are discovered from `src/flows/` and `flows/`. See [App Configuration](./configuration) for the config convention.

You don't have to name a target up front:

- **One flow, one action** in the project — `fsdev chat` binds it automatically.
- **Several available** — the session starts unbound. Run `/targets` to see them and `/use <flow>` to pick one.
- **A config default** — set `chat: { default: "hello-chat.chat" }` on `createFlowState` and bare `fsdev chat` binds it.
- **No flows at all** — that's a hard error, not an empty prompt.

## Sending messages

Anything that isn't a command is a message. It's sent to the default target as `{ message: "<your text>" }`, so the target's action needs to accept that shape (most chat-style flows do). Replies stream token by token as the model produces them.

If an action's input schema rejects `{ message }`, the turn fails with the validation error and a note that the target isn't chat-shaped. The session stays open — switch to another target with `/use` and keep going.

## Slash commands

A line beginning with `/` is a command. Six are built in:

| Command | What it does |
|---------|--------------|
| `/help` | List the commands. |
| `/targets` | List the available `flow · action` targets; the current default is marked. |
| `/use <flow> [action]` | Switch the default target. Omit the action when the flow has only one. |
| `/status` | Show the current target, session id, turn count, and runtime source. |
| `/session [new\|<id>]` | Print the current flow's session id, rotate it (`new`), or bind an existing one. |
| `/exit` | Leave the session (so do Ctrl-D and a double Ctrl-C). |

Anything after `/` that no built-in claims is sent to the flow unchanged. That's deliberate: a project's own skills are invoked as `/<skill-name> args`, and the harness passes those straight through so the flow's skill matcher can act on them. To send a literal message that starts with `/`, put a space in front of it.

## Sessions and state

Each flow kind gets its own session within a run, so conversation history and state don't bleed across a `/use` switch. Switch away and back, and the first flow's session resumes where it left off. History persists in the engine's stores — the same SQLite database (`.fsdev/data/fsdev.db`) the DevTool reads in the discovery path — so a conversation survives restarts of the session.

Turns and the engine identity that owns them default to `cli-user`. The DevTool defaults to `devuser`. If you want a chat session to show up in the DevTool's session list, or to resume a session across the two surfaces, align them — pass `--user devuser` to `fsdev chat`, or set the DevTool's user to `cli-user`.

`--session <id>` resumes a specific session for the initially bound flow. A session that belongs to a different flow is rejected rather than silently reused, since the engine routes state by the session's flow.

## chat vs run vs dev

- **`fsdev chat`** — a live, multi-turn conversation from the terminal. Reach for it to prod a flow interactively, test that history threads, or drive one flow then switch to another.
- **`fsdev run`** — one action, one result, NDJSON to stdout. Best for scripts and the edit → run → read loop.
- **`fsdev dev`** — the DevTool in a browser, with rich rendering and resource inspection. Best when you want to *see* the stream and state, not just read it.

## A session

```text
$ fsdev chat hello-chat chat
Chatting with hello-chat · chat (session sess_a1b2c3).
Type /help for commands, /exit to quit.
❯ My name is Ada.
Nice to meet you, Ada. How can I help?
❯ What is my name?
Your name is Ada.
❯ /status
Target:  hello-chat · chat
Session: sess_a1b2c3
Turns:   2
Source:  config (fsdev.config.ts)
Store:   app-configured stores
❯ /exit
```

## Next steps

- [Agent Dev Loop](./agent-dev-loop.md) — the non-interactive edit → `fsdev run` → read loop.
- [CLI API Reference](/docs/api/cli) — the full `fsdev chat` flag and command reference.
