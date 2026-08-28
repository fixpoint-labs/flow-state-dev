---
sidebar_position: 5
title: "Conductor"
sidebar_label: "Conductor"
description: "Drive a background task board from the terminal, with a live TUI or scripted seed/wake/status/answer verbs."
---

# Conductor

`fsdev conductor` is an operator surface for a flow that runs work in the background and occasionally needs a person: a table of rows, each one pending, running, waiting on a question, or done. Open it as a fullscreen board that polls live, or drive it with scripted verbs from a shell or a CI job.

It is not a chat REPL — that's [`fsdev chat`](./interactive-chat.md). A conductor row isn't a conversation; it's a unit of work with a status, and the only thing you type into it is an answer to a question the work asked.

## What a conductor flow looks like

`fsdev conductor` needs a registered flow whose `kind` is `"conductor"`, with four actions: `seed`, `wake`, `status`, and `answer`. If none is found, it exits with a discovery error; if the flow is missing one of the four actions, it exits with a config error naming which one. Every other flow in the project is ignored.

The four actions are yours to write. The board is whatever `status` returns.

```ts title="src/flows/reviewer/flow.ts"
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const runSchema = z.object({
  attempt: z.number().nullable(),
  taskId: z.string().nullable(),
  workspacePath: z.string().nullable(),
  branch: z.string().nullable(),
  outcome: z.enum(["running", "succeeded", "failed"]).nullable(),
  reason: z.string().nullable(),
  sessionId: z.string().nullable(),
  finalMessage: z.string().nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  costUsd: z.number().nullable(),
  childSessionId: z.string().nullable(),
  requestId: z.string().nullable(),
  updatedAt: z.number().nullable(),
});

const questionSchema = z.object({
  question: z.string(),
  text: z.string(),
  attempt: z.number(),
  askedAt: z.number().nullable(),
});

const rowSchema = z.object({
  taskId: z.string(),
  issue: z.string().nullable(),
  phase: z.string().nullable(),
  status: z.string(),
  attempts: z.number(),
  feedback: z.string().nullable(),
  run: runSchema.nullable(),
  questions: z.array(questionSchema),
});

const boardState = z.object({ rows: z.array(rowSchema).default([]) });

const seed = handler({
  name: "reviewer-seed",
  inputSchema: z.object({ issue: z.string(), phase: z.string() }),
  outputSchema: z.object({ taskId: z.string() }),
  sessionStateSchema: boardState,
  execute: async (input, ctx) => {
    const taskId = `${input.issue}--${input.phase}`;
    if (!ctx.session.state.rows.some((row) => row.taskId === taskId)) {
      await ctx.session.patchState({
        rows: [
          ...ctx.session.state.rows,
          {
            taskId,
            issue: input.issue,
            phase: input.phase,
            status: "pending",
            attempts: 0,
            feedback: null,
            run: null,
            questions: [],
          },
        ],
      });
    }
    return { taskId };
  },
});

const wake = handler({
  name: "reviewer-wake",
  inputSchema: z.unknown(),
  outputSchema: z.object({ drained: z.number() }),
  sessionStateSchema: boardState,
  execute: async (_input, ctx) => {
    const rows = ctx.session.state.rows.map((row) => {
      if (row.status !== "pending") return row;
      return {
        ...row,
        status: "awaiting_review",
        attempts: row.attempts + 1,
        questions: [
          {
            question: `${row.issue}/${row.phase}/1/q`,
            text: "Which branch should this target?",
            attempt: 1,
            askedAt: Date.now(),
          },
        ],
      };
    });
    await ctx.session.patchState({ rows });
    return { drained: rows.length };
  },
});

const status = handler({
  name: "reviewer-status",
  inputSchema: z.object({ issue: z.string().optional() }),
  outputSchema: z.object({ rows: z.array(rowSchema) }),
  sessionStateSchema: boardState,
  execute: (input, ctx) => ({
    rows: ctx.session.state.rows.filter((row) => input.issue === undefined || row.issue === input.issue),
  }),
});

const answer = handler({
  name: "reviewer-answer",
  inputSchema: z.object({ question: z.string(), answer: z.string() }),
  outputSchema: z.object({
    result: z.enum(["answered", "recovered", "declined"]),
    reason: z.string().nullable(),
    question: z.string(),
    taskStatus: z.string().nullable(),
    questionStatus: z.string().nullable(),
    drained: z.boolean(),
  }),
  sessionStateSchema: boardState,
  execute: async (input, ctx) => {
    const hit = ctx.session.state.rows.some((row) => row.questions.some((q) => q.question === input.question));
    if (!hit) {
      return {
        result: "declined" as const,
        reason: "unknown-question",
        question: input.question,
        taskStatus: null,
        questionStatus: null,
        drained: false,
      };
    }
    await ctx.session.patchState({
      rows: ctx.session.state.rows.map((row) =>
        row.questions.some((q) => q.question === input.question)
          ? { ...row, status: "completed", questions: [], feedback: input.answer }
          : row,
      ),
    });
    return {
      result: "answered" as const,
      reason: null,
      question: input.question,
      taskStatus: "completed",
      questionStatus: "answered",
      drained: true,
    };
  },
});

const reviewer = defineFlow({
  kind: "conductor",
  requireUser: true,
  session: { stateSchema: boardState },
  actions: {
    seed: { block: seed },
    wake: { block: wake },
    status: { block: status },
    answer: { block: answer },
  },
});

export default reviewer({ id: "pr-reviewer" });
```

`seed` must return `{ taskId }`. `answer` must return the shape above: `answered` wrote the reply, `recovered` found the question already answered and started the job again, `declined` wrote nothing (`reason` says why). `wake` is reported only if it errors. The plain-text board prints issue, phase, status, attempts, outcome, and open questions; `--json` prints the full `status` payload.

## The board

```bash
fsdev conductor
```

With no verb, or `tui [issue]`, `fsdev conductor` opens a fullscreen board: a row per task, live-polled, with a detail pane for whichever row is selected. It needs a TTY. Piped in or run from a script, it prints a message and exits `1` instead:

```
fsdev conductor: the interactive surface needs a TTY. Use a headless verb (status, seed, wake, answer, watch).
```

`fsdev conductor tui PR-482` opens the same board with that row selected, if it exists.

### Keys

| Key | Does |
|---|---|
| `j` / `k` or `↓` / `↑` | Move the selected row (click a row) |
| `PgUp` / `PgDn` | Scroll the transcript (mouse wheel and `Ctrl-U` / `Ctrl-D` too) |
| `[` / `]` | Move between open questions on the selected row |
| `a` | Answer the selected question |
| `s` | Seed a new row (prompts for an issue id) |
| `w` | Wake — process pending rows |
| `r` | Refresh now |
| `/` | Type a slash command (any of the headless verbs) |
| `?` | Toggle help |
| `q` | Quit |

Typing on a row that has an open question starts an answer for you — you don't have to press `a` first. `Enter` sends it; `Esc` cancels. While a command is running, `Ctrl-C` aborts it instead of quitting; press it again once nothing is running to quit.

## Headless verbs

`--json` switches the board and action results to JSON.

| Verb | Does |
|---|---|
| `status [issue]` | Print the board, optionally filtered to one issue |
| `seed <issue> [--phase implement]` | File a row for `issue` (a no-op if that `issue`/`phase` pair already has one), then print it |
| `wake` | Process pending rows, then print the board |
| `answer <question-id> <reply…>` | Resolve one open question |
| `watch [issue]` | Poll `status` until it's no longer "still running" |
| `start <issue>` | Seed, then open the TUI on a TTY, or seed-and-watch on a pipe |
| `help` | Print the built-in help text |

Without `--json`, `seed` prints the taskId it created plus the plain-text board; with `--json` it prints only the `seed` action's own `{ taskId }` result, not the board. Every other verb prints the board (plain text or JSON) either way.

```bash
$ fsdev conductor seed PR-482
seeded PR-482 → PR-482--implement
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   pending           0       —           ·

$ fsdev conductor wake
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   awaiting_review   1       succeeded   1
  ? PR-482/implement/1/q
    Which branch should this target?

$ fsdev conductor answer PR-482/implement/1/q "target the release branch"
answered · drain ran

$ fsdev conductor status PR-482 --json
{
  "rows": [
    {
      "taskId": "PR-482--implement",
      "issue": "PR-482",
      "phase": "implement",
      "status": "completed",
      "attempts": 1,
      "feedback": "target the release branch",
      "run": {
        "attempt": 1,
        "taskId": null,
        "workspacePath": null,
        "branch": null,
        "outcome": "succeeded",
        "reason": null,
        "sessionId": null,
        "finalMessage": null,
        "usage": null,
        "costUsd": null,
        "childSessionId": null,
        "requestId": null,
        "updatedAt": 1732650000000
      },
      "questions": []
    }
  ]
}
```

A decline prints `declined · <reason>` (or the same shape as JSON) and exits `1`:

```bash
$ fsdev conductor answer no-such-question "whatever"
declined · unknown-question
```

### Exit codes

Startup failures — an unknown verb, a missing conductor flow, a flow missing one of the four actions — use the CLI's usual codes (`2` invalid args, `3` config error, `4` discovery error). Once the command is running, `status`, `wake`, `watch`, and non-interactive `start` share a second scheme describing the board, not the process:

| Code | Meaning |
|---|---|
| `0` | Every named row is `completed` |
| `1` | The board is empty, a row `errored` or was `cancelled`, or the action call itself failed |
| `2` | At least one row has an open question |
| `3` | Still running or pending, with no question yet |

`seed` always exits `0` — it's a write, not a read on the board's outcome. `answer` exits `0` on `"answered"` or `"recovered"`, `1` on `"declined"`.

`watch [issue]` polls `status` every couple of seconds and reprints the board whenever it changes, stopping as soon as the code above isn't `3`.

### `start`

```bash
fsdev conductor start PR-482
```

`start` seeds the row, then hands off: on a TTY it opens the board focused on that row; on a pipe it seeds and then behaves like `watch <issue>`, same polling and exit codes.

## Flags

| Flag | Description |
|---|---|
| `-s, --session <id>` | Session id used for every `wake` (default: `conductor-operator`). Not a per-row session. |
| `-u, --user <id>` | Engine identity (default: `cli-user`) |
| `-m, --model <model>` | Override model for generator blocks run in this process |
| `--json` | Headless verbs print JSON |
| `--flow-dir <path>` | Override flow discovery root (repeatable) |
| `--dotenv <path>` | Load a specific `.env` file (repeatable, resolved from cwd) |
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd |
| `--no-config` | Ignore any config and force directory discovery |
| `--quiet` | Suppress runtime logs on stderr |
| `--log-level <level>` | Stderr log level: `debug` \| `info` \| `warn` \| `error` (default: `warn`) |

Runtime resolution matches `fsdev run` and [`fsdev chat`](./interactive-chat.md): an `fsdev.config.ts` in the cwd wins over directory discovery, and `--session` names the session every `wake` runs under, not a per-row session.

## What it won't do

- It's not a chat REPL. Nothing you type reaches the flow as a free-text message — only an answer to a question the flow itself asked.
- The board shows exactly what `status` returns.
- The interactive surface needs a TTY. There's no web UI for it — use the headless verbs from a script, or [`fsdev dev`](./overview.md#when-to-use-it) if you want a browser.

## Related pages

- [Interactive chat](./interactive-chat.md) — the live-conversation REPL, for a different kind of flow.
- [CLI API](/docs/api/cli) — the full flag and command reference.
- [Actions](/docs/fundamentals/actions) — how a flow's actions are wired to `runAction`.
- [State operations](/docs/fundamentals/state-operations) — `patchState` and friends, used to author a board like the one above.
