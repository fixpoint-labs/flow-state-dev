---
sidebar_position: 5
title: "Conductor"
sidebar_label: "Conductor"
description: "Drive a background task board from the terminal, with a live TUI or scripted seed/wake/status/answer/abort verbs."
---

# Conductor

`fsdev conductor` is an operator surface for a flow that runs work in the background and occasionally needs a person: a table of rows, each one pending, running, waiting on a question, or done. Open it as a fullscreen board that polls live, or drive it with scripted verbs from a shell or a CI job.

It is not a chat REPL — that's [`fsdev chat`](./interactive-chat.md). A conductor row isn't a conversation; it's a unit of work with a status. Typed input is an answer to a question the work asked, a slash command, or a stop on a running row.

## What a conductor flow looks like

`fsdev conductor` needs a registered flow whose `kind` is `"conductor"`, with four actions: `seed`, `wake`, `status`, and `answer`. If none is found, it exits with a discovery error; if the flow is missing one of the four actions, it exits with a config error naming which one. Every other flow in the project is ignored.

The four actions are yours to write. The board is whatever `status` returns. Use `abort` or `stop` to stop a running request.

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

`seed` must return `{ taskId }`. `answer` must return the shape above: `answered` wrote the reply, `recovered` found the question already answered and started the job again, `declined` wrote nothing (`reason` says why). The CLI prints `answered`, `recovered`, or `declined · <reason>` from `result` and `reason`. It prints `drain ran` when `drained` is true. A successful `wake` prints the board. If `wake` fails, the command prints the error and exits `1`. The plain-text board prints issue, phase, status, attempts, outcome, and open questions. A failed row with no open question also prints a `! failed` line and the reason under the row. `--json` prints the full `status` payload.

## The board

```bash
fsdev conductor
```

With no verb, or `tui [issue]`, `fsdev conductor` opens a fullscreen board: a row per task, live-polled, and a TRANSCRIPT pane. The ASK column is the question text, truncated. The header includes `N running` when any row is in progress, and `N failed` when any row's last attempt failed.

When the selected row has an open question, an ASK band sits between the table and the TRANSCRIPT pane. It shows the question text and the question id. When that row's `run.usage` is present, token counts show under the band as `10→4` (input→output).

When the selected row has no open question and the last attempt failed, a FAIL band sits in that same slot. A last attempt failed when `status` is `errored` or `cancelled`, or when `run.outcome` is `"failed"`, including a row whose status is `pending`. The band shows the reason (`run.reason`, else `feedback`, else `run.finalMessage`) and that `w` retries. If the selected row also has an open question, the ASK band is what shows. Answer the question first.

When the selected row is running and has no open question and no failed last attempt, a RUN band sits in that same slot. The label is the word `RUN` on its own line. It shows the full branch, the full checkout path, the request id, and that `x` stops. When that row's `run.usage` is present, the band shows token counts as `12.0k→400` (input→output).

When the run writes a todo list, the latest list shows on that band. Completed items show `[x]`, the current item `[·]`, the rest `[ ]`.

```text
 [x] Add the failing test
 [·] Implement the fix
 [ ] Open the pull request
 [ ] Update the changelog
 … 1 more
```

The band shows up to 4 items. A longer list ends with `… N more`. Selecting another row shows that row's latest list, or none if that row has not written one. A later list replaces the previous one. The ASK and FAIL bands do not show the list.

If the running row has no `run.requestId` yet, the band says `no request id yet` and `x` prints `nothing running to stop`.

It needs a TTY. Piped in or run from a script, it prints a message and exits `1` instead:

```
fsdev conductor: the interactive surface needs a TTY. Use a headless verb (status, seed, wake, answer, watch, abort).
```

`fsdev conductor tui PR-482` opens the same board with that row selected, if it exists. Moving to another row (`j`/`k`, arrows, click) keeps that row selected. A live poll leaves the selection where you put it.

### Keys

| Key | Does |
|---|---|
| `j` / `k` or `↓` / `↑` | Move the selected row (click a row) |
| `PgUp` / `PgDn` | Scroll the transcript (mouse wheel and `Ctrl-U` / `Ctrl-D` too) |
| `[` / `]` | Move between open questions on the selected row |
| `a` | Answer the selected question |
| `s` | Seed a new row (prompts for an issue id) |
| `w` | Wake. On a failed selected row with no question, the footer labels this `w retry` |
| `x` | Stop the selected running row's request |
| `r` | Refresh now |
| `/` | Type a slash command (any of the headless verbs) |
| `?` | Toggle help |
| `q` | Quit |

Typing on a row that has an open question starts an answer for you — you don't have to press `a` first. `Enter` sends it; `Esc` cancels. On a failed selected row with no question, the footer offers `w retry`. On a selected running row, the footer offers `x stop`; `x` or `Ctrl-C` stops that row's request. `/abort` with no issue does the same. While a seed, wake, answer, or status is in flight, `Ctrl-C` aborts that operator action. `Ctrl-C` with nothing running quits.

### Transcript

The TRANSCRIPT pane follows the selected row.

When that row has a `run.requestId`, the pane shows that request's stream. Events already written appear first, then new ones as they arrive: status lines (`status · claiming`), streaming assistant text (`message · opened the pull request`), and coding tools named with the file or command they touched (`tool · Write src/conductor/render.ts`, `tool · Bash pnpm test`, `tool · Read package.json`). When a tool fails, a second line prints: `tool · Bash pnpm test · failed`. Board and operator lines appear in the same pane: the `seed` / `wake` / `status` / `answer` you just ran, and the row changes `status` reports.

When the selected row has no `run.requestId`, the pane shows only those board and operator lines. Another row's coding stream is not shown until that row is selected.

Changing the selected row (`j`/`k`, arrows, click) jumps the transcript back to the tail.

When a Write or Edit includes the new file text, a hunk prints under the tool line. A Write prints each new line as `+ <line>`. An Edit prints only the changed span: `-` lines, then `+` lines.

```text
tool · Write src/conductor/render.ts
+ export function renderFrame() {}

tool · Edit src/foo.ts
- const m = 2;
+ const m = 4;
```

A hunk longer than 10 lines ends with `… N more`. If that Write or Edit fails, the transcript reprints `tool · Write src/conductor/render.ts · failed` (or `tool · Edit src/foo.ts · failed`) and does not reprint the hunk. Read, Bash, and a Write or Edit that only names the path have no hunk. The transcript does not read the checkout.

When the run writes a todo list, a checklist prints under the tool line. Completed items show `[x]`, the current item `[·]`, the rest `[ ]`.

```text
tool · TodoWrite
  [x] Add the failing test
  [·] Implement the fix
  [ ] Open the pull request
```

A checklist longer than 10 items ends with `… N more`. If that tool fails, the transcript reprints `tool · TodoWrite · failed` and does not reprint the checklist. The RUN band shows the latest list for the selected running row, up to 4 items.

When a Read finishes, the first lines of the file print indented under the tool line.

```text
tool · Read src/foo.ts
  export function foo() {
    return 1;
  }
```

A long file keeps the first 6 lines and ends with `… N more`. Write and Edit do not print the file under the tool line.

When a Bash, Grep, or Glob call finishes, the last lines of its result print indented under the tool line.

```text
tool · Bash pnpm test
  Test Files  1 passed (1)

tool · Grep renderFrame
  src/conductor/render.ts:48:export function renderFrame()
```

A successful result does not reprint the tool line. A failed Bash reprints `tool · Bash pnpm test · failed`, then the result:

```text
tool · Bash pnpm test · failed
  FAIL  test/foo.test.ts
  AssertionError: expected 1 to be 2
```

A long successful result keeps the last 6 lines and starts with `… N above`.

A sub-agent prints `sub · Sub-agent: Explore` when it opens, and `sub · Sub-agent: Explore · failed` only if it fails.

Reasoning and thinking text are not printed.

Headless `watch` writes those same lines to stderr. Tool, hunk, checklist, result, and sub-agent lines are written once, each on its own line, not as a live overwrite. Watching a running row does not start work or send an answer.

After that request ends, further board changes show as the lines `status` reports.

While a line is in flight, the last line updates: a status or streaming assistant text. When a new status arrives, the previous one stays as its own line. Streaming text grows on that last line and remains a single line when it finishes.

`status` also writes here when a row actually moved: a new row (`PR-482 · pending`), a status change (`PR-482 · pending → in_progress`), a newly opened question (`PR-482 · asked Which branch should this target?`), a run outcome (`PR-482 · run failed · no pull request`), or a new run `finalMessage` (`PR-482 · stopped after the turn budget`). A poll that changed nothing adds no line.

At the tail the heading says `follow` (or `live` while a line is in flight) and new lines appear as they arrive. Scroll back and the live line hides until you return to the tail.

## Headless verbs

`--json` switches the board and action results to JSON.

| Verb | Does |
|---|---|
| `status [issue]` | Print the board, optionally filtered to one issue |
| `seed <issue> [--phase implement]` | File a row for `issue` (a no-op if that `issue`/`phase` pair already has one), then print it |
| `wake` | Process pending rows, then print the board |
| `answer <question-id> <reply…>` | Resolve one open question |
| `abort [issue]` / `stop [issue]` | Stop running requests, optionally filtered to one issue. Omit `issue` to stop every running row on the board |
| `watch [issue]` | Poll `status` until the board is not code `3`. An open question is code `2` and `watch` stops there; a failed last attempt is code `1` |
| `start <issue>` | Seed, then open the TUI on a TTY, or seed-and-watch on a pipe |
| `help` | Print the built-in help text |

Without `--json`, `seed` prints the taskId it created plus the plain-text board; with `--json` it prints only the `seed` action's own `{ taskId }` result, not the board. `abort` prints a stop line, then the board; `--json` prints the stop line as text and the board as JSON. When no running row has a request id, `abort` prints `nothing running to stop` and exits `1`, with no board. Every other verb prints the board (plain text or JSON) either way. Stream lines (`status · …`, `message · …`, `tool · …`, `+` / `-` hunks, checklist lines, result lines, `sub · …`) from a verb you ran, and from a running row's request when `watch` tails it, go to stderr; `--json` omits them. `--quiet` suppresses `[flow-state]` runtime logs, not those stream lines.

```bash
$ fsdev conductor seed PR-482
seeded PR-482 → PR-482--implement
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   pending           0       —           ·

$ fsdev conductor wake
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   awaiting_review   1       succeeded   Which branch sh…
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

A failed last attempt with no open question prints under the row:

```bash
$ fsdev conductor status PR-482
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   pending           2       failed      ·
  ! failed
    no pull request
```

`abort` (alias `stop`) stops the running request on matching rows, then reprints the board. Each request prints its own line: `stop · <requestId>` when the request was stopped, or `stop · <requestId> was not running` when that request is not in progress. After a stop the exit code is the board-outcome code below.

```bash
$ fsdev conductor abort PR-482
stop · req-pr-482
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   in_progress       1       running     ·

$ fsdev conductor stop PR-482
stop · req-pr-482 was not running
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   in_progress       1       running     ·

$ fsdev conductor abort
nothing running to stop
```

### Exit codes

Startup failures — an unknown verb, a missing conductor flow, a flow missing one of the four actions — use the CLI's usual codes (`2` invalid args, `3` config error, `4` discovery error). Once past startup, `status`, `wake`, `watch`, `abort`, and non-interactive `start` use the codes below for the board:

| Code | Meaning |
|---|---|
| `0` | Every named row is `completed` |
| `1` | The board is empty, the last attempt failed, or the action call itself failed |
| `2` | At least one row has an open question |
| `3` | Running or pending, with no open question and no failed attempt |

A last attempt failed when a row's `status` is `errored` or `cancelled`, or when `run.outcome` is `"failed"`, including a row whose status is `pending`. An open question is code `2` and wins over a failed attempt.

`seed` always exits `0`, even when the board still has pending, failed, or open-question rows. `answer` exits `0` on `"answered"` or `"recovered"`, `1` on `"declined"`. `abort` with no running request id exits `1` and prints `nothing running to stop`. After a stop, or when the printed id was not running, it reprints the board and uses the codes above.

`watch [issue]` polls `status` every couple of seconds and reprints the board whenever it changes. It stops when the code is not `3`. An open question is code `2`. A failed last attempt is code `1`.

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
| `--phase <name>` | Phase for `seed` and `start` (default: `implement`) |
| `--flow-dir <path>` | Override flow discovery root (repeatable) |
| `--dotenv <path>` | Load a specific `.env` file (repeatable, resolved from cwd) |
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd |
| `--no-config` | Ignore any config and force directory discovery |
| `--quiet` | Suppress runtime logs on stderr |
| `--log-level <level>` | Stderr log level: `debug` \| `info` \| `warn` \| `error` (default: `warn`) |

Runtime resolution matches `fsdev run` and [`fsdev chat`](./interactive-chat.md): an `fsdev.config.ts` in the cwd wins over directory discovery, and `--session` names the session every `wake` runs under, not a per-row session.

## What it won't do

- It's not a chat REPL. Nothing you type reaches the flow as a free-text message — only an answer to a question the flow itself asked, a slash command, or a stop on a running row.
- The board table is exactly what `status` returns.
- Watching or aborting a running row does not start work or send an answer. Abort does not resume a session.
- The transcript does not print reasoning or thinking text.
- The transcript does not read the checkout. A Write or Edit that only names the path has no hunk.
- There is no combined transcript of every running row.
- There is no combined todo list of every running row.
- Headless verbs (`status`, `watch`, and the rest) have no RUN band.
- The interactive surface needs a TTY. There's no web UI for it — use the headless verbs from a script, or [`fsdev dev`](./overview.md#when-to-use-it) if you want a browser.

## Related pages

- [Interactive chat](./interactive-chat.md) — the live-conversation REPL, for a different kind of flow.
- [CLI API](/docs/api/cli) — the full flag and command reference.
- [Actions](/docs/fundamentals/actions) — how a flow's actions are wired to `runAction`.
- [State operations](/docs/fundamentals/state-operations) — `patchState` and friends, used to author a board like the one above.
