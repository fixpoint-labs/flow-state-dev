---
sidebar_position: 5
title: "Conductor"
sidebar_label: "Conductor"
description: "Drive a background task board from the terminal: talk to the coordinator, or script seed/wake/status/answer/steer/abort."
---

# Conductor

`fsdev conductor` is an operator board for a flow whose `kind` is `"conductor"`: a table of rows, each one pending, running, waiting on a question, or done. Open it as a fullscreen board that polls live, or drive it with scripted verbs from a shell or a CI job.

Typed input that is not a slash verb is a talk turn (`steer`). The coordinator sees the current board and may file a row, wake pending work, or answer a question. Talking can start work. It does not implement or edit product code. Workers do that after a row is filed or woken.

A conductor row is a unit of work with a status. Talking is one coordinator turn, not a conversation REPL. For a live conversation, use [`fsdev chat`](./interactive-chat.md). On a row with an open question, typing starts an answer to that question. Slash verbs run the named action.

## What a conductor flow looks like

`fsdev conductor` needs a registered flow whose `kind` is `"conductor"`, with `seed`, `wake`, `status`, `answer`, and `steer`. If none is found, the error tells you to `cd` into the app that defines one, or pass `--config` / `--flow-dir`, or set `CONDUCTOR_CONFIG`. Missing one of those actions is a config error that names it. Every other flow in the project is ignored.

Those actions are yours to write. The board is whatever `status` returns. `status` is the only board read. Use `abort` or `stop` (or `x` on the board) to stop a running request. Opening the fullscreen board needs a TTY and does not need a model.

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
  prUrl: z.string().nullable(),
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
  inputSchema: z.object({
    issue: z.string(),
    phase: z.string(),
    brief: z.string().optional(),
  }),
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

const steer = handler({
  name: "reviewer-steer",
  inputSchema: z.object({ message: z.string().min(1) }),
  outputSchema: z.string(),
  sessionStateSchema: boardState,
  execute: async (_input, ctx) => {
    const rows = ctx.session.state.rows;
    const said =
      rows.length === 0
        ? "No rows yet. Seed an issue when you want work started."
        : `Board has ${rows.length} row(s).`;
    ctx.emit.message(said);
    return said;
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
    steer: { block: steer, userMessage: (input: { message: string }) => input.message },
  },
});

export default reviewer({ id: "pr-reviewer" });
```

`seed` takes `{ issue, phase, brief? }` and must return `{ taskId }`. Extra words after the issue id are `brief`. `--` starts a literal brief. In the TUI, the first seed line is the issue id. Words after the id on that line, and later lines, are the brief attempt 1 reads. `answer` must return the shape above: `answered` wrote the reply, `recovered` found the question already answered and started the job again, `declined` wrote nothing (`reason` says why). The CLI prints `answered`, `recovered`, or `declined · <reason>` from `result` and `reason`. It prints `drain ran` when `drained` is true. A successful `wake` prints the board. If `wake` fails, the command prints the error and exits `1`. `steer` takes `{ message }` and returns a string. The CLI prints that string, or `coordinator turn finished` if the action returned nothing, then the board. `--json` on `steer` prints `{ "message": "<reply>" }` and omits the board. A failed `steer` prints the error and exits `1`. The plain-text board prints issue, phase, status, attempts, outcome, and open questions. A row may include `brief: string | null`: the text filed with the issue on `seed`, `start`, TUI `s`, or `/seed` (words after the issue id, or later lines). The fullscreen board paints it on the selected row: on the compact strip under ASK, FAIL, or RUN, or on that row's detail when those bands are closed. On a short board the strip shortens or drops. Headless `status` and `watch` print a `brief  <text>` line under the row. `--json` includes `brief` on the row when the `status` action returned it. A row that omits the field, returns `null`, or carries empty text prints no brief line. A failed row with no open question also prints a `! failed` line and the reason under the row. `--json` on `status` prints the board as `{ "epic": "<flow.id>", "rows": [...] }`, plus `"repo"` when `CONDUCTOR_REPO` is set. `rows` is what the `status` action returned.

## The board

```bash
fsdev conductor
```

With no verb, or `tui [issue]`, `fsdev conductor` opens a fullscreen board: a row per task, live-polled, and a TRANSCRIPT pane. The PATH `conductor` command opens that same board. When there are more than eight rows, the table shows eight around the selection so the compose prompt and `/quit` stay on screen, including when the ASK, FAIL, or RUN band is expanded. The ASK column is the question, truncated; else a running row's live line or last tool; else a `brief` when `status` returned one, truncated; else `·`. Headless plain `status` uses the same rule on that column. When `status` has token counts on that row, the OUTCOME column shows them (`12.0k→400`). A running row shows `running` when `status` has no token counts. `}` / `{` jump to the next or previous row that is waiting on you, whose last attempt failed, or that is running and has been silent for 30 seconds. They do not steal a typed answer. The header includes the flow's `id` (`pr-reviewer` for the example above), `N rows`, the visible range (`1–8`) when more than eight rows are on the board, `N running` when any row is in progress, `N waiting` when any row has an open question, `N failed` when any row's last attempt failed, and `working` when a seed, wake, answer, or steer is in flight. When `CONDUCTOR_REPO` is set, including `.`, the header and the terminal tab title include the basename of that checkout (`fsd-product` for `/tmp/fsd-product`, or for `CONDUCTOR_REPO=.` while standing in that directory). When it is unset or blank, the header and title do not add a checkout name. After `/quit`, the terminal shows one leftover line: the flow's `id` (`pr-reviewer` for the example above). When `CONDUCTOR_REPO` is set, that line is `id ·` the checkout basename (`pr-reviewer · fsd-product`). A headless dump's first line is that same `id` line. While the board is open, the terminal tab title is `conductor ·` plus the flow's `id` (`conductor · pr-reviewer` for the example above), then that checkout name when `CONDUCTOR_REPO` is set (`conductor · pr-reviewer · fsd-product`), then `N running`, `N waiting`, and `N failed` when those are non-zero, and `working` when a seed, wake, answer, or steer is in flight. `/quit` or leaving the board leaves the tab title empty. Headless verbs do not set a tab title.

When the selected row has an open question, an ASK band sits between the table and the TRANSCRIPT pane. It shows the question text and the question id. The question wraps. The band keeps at least two wrapped lines of the question, and at most eight. TRANSCRIPT is under the band on an 18-line board and on a 24-line board. When the question does not fit, the title shows `… N more`. The TRANSCRIPT pane shows the full question as an `asked` line (`PR-482 · asked Which branch should this target?`). The empty compose line (`❯`) says `type to answer`. The band shows the branch when `status` carried one (`run.branch`). A long branch keeps the issue--phase suffix (`PR-482--implement`). It shows the pull-request URL when `status` carried one (`run.prUrl`). Under the question it keeps a compact strip of that attempt: the last tool or `think ·` line, the files that run wrote, edited, or read, the last hunk, and the current todo. On a short board the strip shortens or drops. Those lines are on TRANSCRIPT. When `status` returned a `brief`, that text is on the strip too. It is not a TRANSCRIPT line. When that row's `run.usage` is present, token counts show on the band as `10→4` (input→output). The counts stay on the band while a wake or seed is in flight. A new question rings the terminal bell, including when you open a waiting board, and selects that row when the prompt is empty and you are not answering, seeding, or finding. A row that finishes rings the terminal bell. When the prompt is empty and you are not answering, seeding, or finding, the board selects that row so its attempt is on screen. If a question and a finish happen together, the bell rings once. When the prompt is empty and you are not answering, seeding, or finding, the waiting row is selected. Opening a board whose rows are already finished does not ring and does not move the selection for those finishes. Typing, answering, seeding, or finding leaves the selection where it is. The bell rings whether that row is selected or not. The same open question does not ring again, and headless `status` / `watch` do not ring or select a row.

When the selected row has no open question and the last attempt failed, a FAIL band sits in that same slot. A last attempt failed when `status` is `errored` or `cancelled`, or when `run.outcome` is `"failed"`, including a row whose status is `pending`. The band shows the reason (`run.reason`, else `feedback`, else `run.finalMessage`). The reason wraps. The band keeps at least two wrapped lines of the reason, and at most eight. TRANSCRIPT is under the band on an 18-line board and on a 24-line board. When the reason does not fit, the title shows `… N more`. The TRANSCRIPT pane shows the full reason on that `run failed` (or `run <outcome>`) line (`PR-482 · run failed · no pull request`). The hint is `/wake` when the row is pending, or `spent` when `status` is `errored` or `cancelled`. `/wake` will not take a spent row. Talk, or `/wake` if the row is pending. The band shows the branch when `status` carried one. A long branch keeps the issue--phase suffix (`PR-482--implement`). It shows the pull-request URL when `status` carried one, the request id, and token counts when `status` carried them. Under the reason it keeps the same compact attempt strip ASK does: last tool or `think ·` line, files, last hunk, and current todo. On a short board the strip shortens or drops. Those lines are on TRANSCRIPT. When `status` returned a `brief`, that text is on the strip too. It is not a TRANSCRIPT line. If the selected row also has an open question, the ASK band is what shows. Answer the question first.

When the selected row is running and has no open question and no failed last attempt, a RUN band sits in that same slot. The label is the word `RUN` on its own line. It shows the branch, the checkout path, the request id, the pull-request URL when `status` carried one, and a hint that `x` stops the run. When `status` returned a `brief`, that text is the last line of the compact strip. On a short board the strip shortens or drops. A path that will not fit keeps the filename. When that row's `run.usage` is present, the band shows token counts as `12.0k→400` (input→output). Last-write age shows as `8s` or `3m` on the band and next to `in_progress` on the table. After 30 seconds the age turns rust. The clock is last write, not elapsed since start. You can move to another row, start an answer, and type while a wake or seed is in flight. Enter queues that next action.

The band shows what the run is doing: a status or message (`claiming`), or a tool (`Bash pnpm test`). If neither is on screen, it shows the last tool that row ran (`Write src/a.ts`). Another row's tool is not shown on the band. The table ASK column follows the same rule: current action when the row has one.

The band lists the files that run has written, edited, or read. Last touch is last. Up to 3 paths; more starts with `… N more`. `f` expands the list (up to 12). Press again to collapse.

The band also shows the last Write or Edit hunk — the changed span, not the whole file. Last 3 lines; more starts with `… N more`. `h` expands that hunk (up to 16 lines). Press again to collapse. When the run has written more than one file, the band labels the current hunk `src/b.ts  2/2`. `H` steps to an older file's hunk. A later write to the same file replaces that entry and moves it last. The transcript caps a long Write.

When the last tool is a Read, the band shows the first 3 lines of that file. When the last tool is Bash, Grep, Glob, or LS, the band shows the last 3 lines of that result. A later Write, Edit, or Read drops the peek or tail.

```text
 … 2 more
 package.json
 src/review.ts
 src/foo.ts
```

Another row's files are not shown. A Bash (or other non-file tool) does not add a path. The ASK band lists those files the same way.

When the run writes a todo list, the band shows one current item and a `done/total` count. The current item is the one in progress (`[·]`), else the first pending (`[ ]`), else the last completed (`[x]`). The full list is not on the band until you expand it.

```text
 [·] Implement the fix  1/5
```

`Ctrl-T` expands the list (up to 4 items, then `… N more`). Press again to collapse.

```text
 [x] Add the failing test
 [·] Implement the fix
 [ ] Open the pull request
 [ ] Update the changelog
 … 1 more
```

The list comes from that run's plan tools. `TodoWrite` with a `todos` array replaces the list. `TaskCreate` adds a pending item (the create text, like `Add hello.js`). `TaskUpdate` changes that item's mark or text when it succeeds. A failed `TaskCreate` is not on the list.

Selecting another row shows that row's current item, or none if that row has not written a list.

When the selected row is not running and has no open question, the board shows that attempt's request id, session id, child session id, pull-request URL when `status` carried one, last tool, files written, edited, or read, the last hunk, the current todo with its count, and the row's `brief` when `status` returned one. `Ctrl-T` expands the list. `h` expands the hunk. A terminal that understands OSC-8 can open that URL, and can open a Write / Edit / Read path the same way.

```text
 request  req-fail-1
 last     TaskCreate Add hello.js
 src/hello.js
 [ ] Open the pull request  1/2
```

When that row has an open question, the ASK band shows the current todo and the last hunk. Letters are the answer. `Ctrl-T` expands the todo list.

If the running row has no `run.requestId` yet, the band says `no request id yet` and `x` prints `nothing running to stop`.

It needs a TTY. Piped in or run from a script, it prints a message and exits `1` instead:

```
fsdev conductor: the interactive surface needs a TTY. Use a headless verb (status, seed, wake, answer, steer, watch, abort).
```

`fsdev conductor tui PR-482` opens the same board with that row selected, if it exists, even if another row is waiting.

On an open board, filing a row with `s`, `/seed`, or `/start` selects that issue. The table caret (`▸`) is on it. TRANSCRIPT follows it. A talk turn (`/steer …` or unslashed talk) that starts an issue selects that issue unless a row newly has an open question in that same refresh. That waiting row is selected. Answer it first. A talk turn that only reads the board leaves the selected row.

`/quit` remembers the selected row's issue, or that row's task id when it has no issue. Opening the board without `tui <issue>` selects that row when it is on the board, unless a row is waiting on a question. A waiting row wins. The remembered row is per `--session` and per epic (the flow's `id`). Opening an epic that has not remembered a row yet uses the last row this `--session` remembered. Headless verbs do not restore or change it. Without a loaded config, the board does not remember a row.

After `/quit`, reopening the board recalls prior compose lines for that `--session` and that epic. Talk (`steer`) and answer walk their earlier sends. The seed prompt walks earlier seed sends. Empty lines and slash commands other than talk are not recalled. Without a loaded config, the board does not remember compose lines after `/quit`.

### Keys

| Key | Does |
|---|---|
| `↓` / `↑` | Move the selected row when the prompt is empty. On a long board, the table shows eight rows around the selection. While the slash list is open, choose a verb or board id. While composing, move between lines, then prior sends |
| `PgUp` / `PgDn` | Scroll the transcript (`Ctrl-U` / `Ctrl-D` too) |
| `[` / `]` | Move between open questions on the selected row |
| `←` / `→` | Move the caret one character while you are typing, answering, or seeding. When the prompt is empty and you are not answering or seeding, move between open questions on the selected row |
| `Alt-←` / `Alt-→` or `Ctrl-←` / `Ctrl-→` | Jump to the previous or next word while composing |
| `Ctrl-W` / `Alt-Backspace` | Delete the previous word while composing |
| `Home` / `End` or `Ctrl-A` / `Ctrl-E` | Start or end of the current compose line |
| `Ctrl-J` / `Alt-Enter` / `Shift-Enter` | New line while composing |
| `s` | Seed. First line is the issue id. Words after the id, or later lines, are the brief attempt 1 reads |
| `x` | Stop the selected running request. On a row that is not running, `x` is a letter (talk) |
| `Ctrl-T` | Expand or collapse the todo list |
| `f` | Expand or collapse the selected row's file list, when the row has no open question |
| `h` | Expand or collapse the selected row's last Write / Edit hunk, when the row has no open question |
| `H` | Show an older Write / Edit hunk from the same run, when the row has no open question |
| `e` | Expand or collapse the last Read peek or command tail, when the row has no open question |
| `{` / `}` | Previous / next row that is waiting, failed, or stalled |
| `r` | Refresh now |
| `/` | Type a slash command. Matching verbs, then board ids, list above the prompt. A line that is not a slash verb is a talk turn |
| `Tab` | Fill the selected slash verb or board id |
| `/wake` | Process pending rows |
| `/status [issue]` | Select that row (if it is on the board) and refresh |
| `/find [text]` | Search the selected row's transcript |
| `n` / `N` | Older / newer match while find is on |
| `?` | Toggle board-key help. The overlay lists the board keys. Any key returns to the board. `fsdev conductor --help` and `fsdev conductor help` print the long CLI form (headless verbs, flags). |
| `/quit` | Leave the board. Stops every running row. A row waiting on a question stays. The shell prompt returns without waiting for a stopped run to finish. The leftover line (flow `id`, then checkout basename when `CONDUCTOR_REPO` is set) is on the screen you return to. Remembers the selected row. Reopening recalls compose lines for that `--session` and epic. |
| `Ctrl-C` | Cancel compose (talk text, a slash line, seed, answer, or find) and stay, including an empty seed, answer, or find prompt. Seed, answer, and find return to the talk prompt. Same as `Esc`. When the prompt is empty and you are not answering, seeding, or finding, stop the selected running row and stay. When another row is running, stay and show `a run is still going — stay, or select it and press x`. When no row is running, leave, even if a row is waiting on a question. While a seed, wake, answer, or steer is in flight, cancel it and stay. |

You can drag-select text on the board and copy it with the terminal's usual copy command. Clicking a row does not change the selection. The mouse wheel does not scroll the transcript.

On an empty board, or a selected row with no open question, the empty compose line (`❯`) says `talk to the coordinator, or /seed /wake /answer`. On a spent row that line is `talk to the coordinator — this row is spent`. Typing that is not a slash verb is a talk turn (`steer`). Letters talk. `j`, `k`, `a`, `w`, `q`, and `t` are letters. On a row with an open question, that empty line says `type to answer`. Typing starts an answer. Letters are the answer, not board keys, including `f`, `h`, `e`, and `H`. `?` opens help. `/` starts a slash command, including `/steer` to talk. `Ctrl-T` expands the todo list. The footer says `type to answer`. `Enter` sends. `Esc` cancels. Slash verbs run the named action either way.

`Enter` sends every compose line. `Ctrl-J`, `Alt-Enter`, or `Shift-Enter` inserts a new line. A paste inserts at the caret, including newlines, and does not send. On an idle board, a paste starts a talk turn, or an answer on a waiting row. `←`/`→` move the caret one character. `Alt-←`/`Alt-→` and `Ctrl-←`/`Ctrl-→` jump to the previous or next word. `Ctrl-W` or `Alt-Backspace` deletes the previous word. If the caret sits after a space, that space is deleted with it. Word jump and word delete apply while composing. They do not move table rows or questions. `s` opens seed compose: first line is the issue id. Words after the id, and later lines (`Ctrl-J`), are the brief attempt 1 reads. `FIX-1049 Rename getSession` files `FIX-1049` with brief `Rename getSession`. While composing, `↑`/`↓` move between lines. On the first line, `↑` steps through earlier sends. On the last line, `↓` steps toward newer ones. The first `↑` keeps the draft you were typing. `↓` past the newest recall puts that draft back. Empty lines, `/find` queries, and slash commands other than talk are not recalled. After `/quit`, reopening the board recalls those lines for that `--session` and that epic (the flow's `id`). Without a loaded config, the board does not remember compose lines after `/quit`. The footer is `↑ prior  ·  Ctrl-J line  ·  Enter send  ·  Esc` when `↑` can walk an earlier send, otherwise `Ctrl-J line  ·  Enter send  ·  Esc`. On the seed prompt, `↑ prior` shows when there is an earlier seed send. While find is on, `n` and `N` step matches instead of starting an answer, `↑`/`↓` do not walk stored lines, and `Esc` clears find.

On a failed selected row that is pending, talk, or `/wake`. The FAIL band and footer show `/wake`. On a spent row (`errored` or `cancelled`), the footer and FAIL band say `spent`. The empty compose line says `talk to the coordinator — this row is spent`. `/wake` will not take that row. On a selected running row, the footer offers `x stop`. On a row that is not running, `x` is a letter. `Ctrl-T` expands or collapses the todo list. `f files` and `h hunk` appear when those lists have more than three entries. `/abort` with no issue stops running requests the same way `x` does on a running row. While a seed, wake, answer, or steer is in flight, the board stays usable: you can change rows, expand lists, start an answer, and type. Enter queues that next action and runs it when the current one finishes. `Ctrl-C` cancels that in-flight action.

A line that is only `/` plus a verb prefix lists matching verbs above the prompt, each with a short hint, in this order: status, seed, wake, answer, steer, watch, start, abort, find, help, quit, refresh. `/s` lists status, seed, steer, start. `/sta` lists status, start. `/ste` lists steer. A space starts the first argument. `/q` and `stop` parse as `quit` and `abort`; they are not in the verb list.

After `/status `, `/watch `, `/abort `, or `/answer `, the list shows ids already on the board. `/status`, `/watch`, and `/abort` offer each row's issue, or that row's id when it has no issue (the same id `seed` prints). The hint is the row's status. The selected row is first, except `/abort`, which lists running rows first. Type a prefix to filter (`/status FI`); matching is case-insensitive. `/answer` lists open question ids: the selected row's questions first, then other rows. The hint is the question text, or the other row's issue (or that row's id when it has no issue). A second argument closes the list (`/status FIX-1 extra`, `/answer Q hello`). `/seed ` and `/start ` do not list board ids; they file a new issue. `/steer ` does not list board ids. `/find` does not complete a query.

`Tab` fills the selected verb or board id. `seed`, `start`, `answer`, and `steer` keep a trailing space so you can type the rest. Completing a question fills `/answer <id> `. The others fill `/name` or `/name <id>` with no trailing space. `Enter` runs when the line is complete (`/status FIX-1` jumps to that row and refreshes). It does not send `/answer` until there is a reply. `Enter` on a matching prefix that still needs an argument fills `/name ` and stays in the prompt. `Enter` on a bare `/` clears the line and does not run the first verb. While the list is open, the footer is `Tab complete  ·  ↑/↓ choose  ·  Enter  ·  Esc`. Help (`?`) says `Tab complete the selected slash verb or board id`.

`/status PR-482` selects that row, if it is on the board, and refreshes. `/status` with no issue refreshes and leaves the selection. If the issue is not on the board, the notice is `no row for <issue>` and it refreshes. Headless `status [issue]` filters the printed board; the slash command does not.

`/find src/foo.ts` searches immediately. `/find` with no query opens `❯ find `, prints `type to search the transcript`, and updates the query as you type; Enter keeps it, Esc clears. Typing and backspace change one character at a time. A paste into find turns newlines into spaces. Bare `find` is the same command. A miss prints `no matches for <query>`. A new query starts on the newest match. The footer offers `n older · N newer · Esc clear`.

### Transcript

The TRANSCRIPT pane follows the selected row.

When that row has a `run.requestId`, the pane shows that request's stream. Events already written appear first, then new ones as they arrive: status lines (`status · claiming`), streaming assistant text (`message · opened the pull request`), thinking as a compact `think ·` line, and coding tools named with the file or command they touched (`tool · Write src/review.ts`, `tool · Bash pnpm test`, `tool · Read package.json`). When a tool fails, a second line prints: `tool · Bash pnpm test · failed`. Tools that run while a sub-agent is open are indented under that `sub ·` line. Board and operator lines appear in the same pane: the `seed` / `wake` / `status` / `answer` / `steer` you just ran, and the row changes `status` reports. A talk turn shows the operator line as `you ·` and the coordinator reply as a `message ·` line, streamed on the live line while it is in flight.

When the selected row has no `run.requestId`, the pane shows only those board and operator lines. Another row's coding stream is not shown until that row is selected.

`/find` searches those lines case-insensitively. The pane is not filtered to hits; matches are highlighted in place and the current hit is pinned in the window. The heading reads `find · "src/foo.ts"  2/5` or `find · "src/foo.ts"  no matches`. Find does not hide the ASK, FAIL, or RUN band.

Changing the selected row jumps the transcript to the tail.

When a Write or Edit includes the new file text, a hunk prints under the tool line. A Write prints each new line as `+ <line>`. An Edit prints only the changed span: `-` lines, then `+` lines.

```text
tool · Write src/review.ts
+ export function review() {}

tool · Edit src/foo.ts
- const m = 2;
+ const m = 4;
```

A hunk longer than 10 lines ends with `… N more`. If that Write or Edit fails, the transcript reprints `tool · Write src/review.ts · failed` (or `tool · Edit src/foo.ts · failed`) and does not reprint the hunk. Read, Bash, and a Write or Edit that only names the path have no hunk. The transcript does not read the checkout.

When `TodoWrite` writes a `todos` array, a checklist prints under the tool line. Completed items show `[x]`, the current item `[·]`, the rest `[ ]`.

```text
tool · TodoWrite
  [x] Add the failing test
  [·] Implement the fix
  [ ] Open the pull request
```

A checklist longer than 10 items ends with `… N more`. If that tool fails, the transcript reprints `tool · TodoWrite · failed` and does not reprint the checklist.

`TaskCreate` prints `tool · TaskCreate Add hello.js`. `TaskUpdate` prints `tool · TaskUpdate`. A failed `TaskCreate` reprints `tool · TaskCreate Add hello.js · failed`.

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

tool · Grep review
  src/review.ts:48:export function review()
```

A successful result does not reprint the tool line. A failed Bash reprints `tool · Bash pnpm test · failed`, then the result:

```text
tool · Bash pnpm test · failed
  FAIL  test/foo.test.ts
  AssertionError: expected 1 to be 2
```

A long successful result keeps the last 6 lines and starts with `… N above`.

A sub-agent prints `sub · Sub-agent: Explore` when it opens, and `sub · Sub-agent: Explore · failed` only if it fails.

Thinking prints as a compact `think ·` line. A long think stays on that one line. An empty think is omitted.

Headless `watch` writes those same lines to stderr. Each tool, hunk, checklist, result, and sub-agent line is written once. Watching a running row does not start work or send an answer.

After that request ends, further board changes show as the lines `status` reports.

While a line is in flight, the last line updates. A status or streaming assistant text lives there: when a new status arrives, the previous one stays as its own line. Streaming text grows on that last line and remains a single line when it finishes. An open coding tool sits on that last line (`tool · Bash pnpm test`) and stays as that one line when it finishes.

`status` also writes here when a row actually moved: a new row (`PR-482 · pending`), a status change (`PR-482 · pending → in_progress`), a newly opened question (`PR-482 · asked Which branch should this target?`), a run outcome (`PR-482 · run failed · no pull request`), or a new run `finalMessage` (`PR-482 · stopped after the turn budget`). A poll that changed nothing adds no line.

At the tail the heading says `follow` (or `live` while a line is in flight) and new lines appear as they arrive. Scroll back and the live line hides until you return to the tail.

## Headless verbs

`--json` switches the board and action results to JSON.

A plain-text board dump starts with the flow's `id` (`pr-reviewer` for the example above). When `CONDUCTOR_REPO` is set, that first line is `id ·` the checkout basename (`pr-reviewer · fsd-product`). An empty board prints that line, then `no rows`:

```text
pr-reviewer
no rows
```

`--json` board output is `{ "epic": "<flow.id>", "rows": [...] }`. `repo` is the checkout basename when `CONDUCTOR_REPO` is set, and omitted when it is unset. Empty JSON is `{ "epic": "pr-reviewer", "rows": [] }`, plus `repo` when set.

`status`, `wake`, `abort` (when it prints a board), a successful `seed` / `steer` without `--json`, and `watch --json` dump the board this way. Watch's compact poll line (issue + status) does not include the flow `id` or `repo`. When watch stops on a question or a failed attempt and prints the full board, that dump includes the flow `id` line.

| Verb | Does |
|---|---|
| `status [issue]` | Print the board, optionally filtered to one issue. A named issue also reprints that row's last attempt on stderr, and prints last tool, files, hunk, and current todo on stdout. A running row also prints last-write age (`8s`, `3m`) |
| `seed <issue> [--phase implement] [brief…]` | File a row for `issue` (a no-op if that `issue`/`phase` pair already has one), then print it. Extra words after the issue id are the brief attempt 1 reads. `--` starts a literal brief |
| `wake` | Process pending rows, then print the board |
| `answer <question-id> <reply…>` | Resolve one open question |
| `steer <message…>` | Talk to the coordinator. An unslashed line that is not a known verb is the same command (`fsdev conductor please start FIX-99`) |
| `abort [issue]` / `stop [issue]` | Stop running requests, optionally filtered to one issue. Omit `issue` to stop every running row on the board |
| `watch [issue]` | Poll `status` until the board is not code `3`. An open question is code `2` and `watch` stops there; a failed last attempt is code `1`. A stop on a named issue reprints that last attempt on stderr, and prints last tool, files, hunk, and current todo on stdout |
| `start <issue> [brief…]` | On a TTY, open the board, then file the row focused on that issue. On a pipe, seed then watch that issue. Extra words after the issue id are the brief |
| `help` | Print the long CLI help (headless verbs, flags). On the board, `?` lists the board keys. |

`find` is TUI-only. `fsdev conductor find` prints `that verb is TUI-only — run \`fsdev conductor\` with no verb` and exits `1`. It does not print a hit list.

On `answer`, the reply is the text you typed, including apostrophes (`don't change the path`); quote it (`answer Q1 "leave the symlink"`), and write a reply of `--json` as `answer <id> -- --json` or `/answer <id> -- --json` (`--json` on its own prints JSON).

`steer` needs a message. `fsdev conductor steer` prints `steer needs a message` and exits `2`. An unslashed line that is not a known verb is the same command. Talking can start work. The coordinator may file a row.

```bash
fsdev conductor steer "retry the failed rows"
fsdev conductor please start FIX-99
fsdev conductor steer "start PR-482: Rename getSession in the docs"
```

Without `--json`, `seed` prints the taskId it created plus the plain-text board; with `--json` it prints only the `seed` action's own `{ taskId }` result, not the board. `steer` prints the coordinator reply plus the plain-text board; with `--json` it prints only `{ "message": "<reply>" }`. Those action-result objects do not include `epic` or `repo`. `abort` prints a stop line, then the board; `--json` prints the stop line as text and the board as JSON. When no running row has a request id, `abort` prints `nothing running to stop` and exits `1`, with no board. Every other verb prints the board (plain text or JSON) either way. Under each row, plain `status` and `watch` print last-write age when the row is still running, then the pull-request URL, `@ request-id`, branch, checkout, token counts, spend, and last message when that run has them. A row with a `brief` also prints `brief  <text>`. A named issue also prints that attempt's last tool, files, last hunk, Read peek or Bash tail when those apply, and current todo — raw paths, no OSC-8. Stream lines (`status · …`, `message · …`, `tool · …`, `+` / `-` hunks, checklist lines, result lines, `sub · …`) go to stderr. They come from a verb you ran, and from a running row's request when `watch` tails it. `--json` omits them. `--quiet` suppresses `[flow-state]` runtime logs, not those stream lines.

`fsdev conductor status PR-482` reprints that issue's last attempt on stderr. Those are the same `status · …`, `message · …`, and `tool · …` lines the TRANSCRIPT pane shows when you select that row. Then it prints the board on stdout. `fsdev conductor status` with no issue prints the board, plus stream lines from the `status` action itself if any. It does not reprint every row's last attempt.

`fsdev conductor status PR-482 --json` prints the JSON board and omits those last-attempt stream lines. Each row that has a last attempt includes `now`, `files`, `hunk`, and `todo` — a named issue always, or running rows only on a full-board print. A row that returned `brief` includes it. A row that omitted the field has no `brief` key.

When `watch PR-482` stops, it prints that attempt on stderr, then the board. While the row is running, `watch` tails it.

If there is nothing to print for that attempt, the board prints and the command exits.

```bash
$ fsdev conductor seed PR-482 Rename getSession in the docs
seeded PR-482 → PR-482--implement
pr-reviewer
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   pending           0       —           ·

$ fsdev conductor seed PR-482 -- --phase is the ticket
seeded PR-482 → PR-482--implement

$ fsdev conductor wake
pr-reviewer
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   awaiting_review   1       succeeded   Which branch sh…
  ? PR-482/implement/1/q
    Which branch should this target?

$ fsdev conductor answer PR-482/implement/1/q "target the release branch"
answered · drain ran

$ fsdev conductor steer "what's on the board?"
Board has 1 row(s).
pr-reviewer
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   completed         1       succeeded   ·

$ fsdev conductor status PR-482 --json
{
  "epic": "pr-reviewer",
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

The example flow's `status` rows omit `brief`, so the dump has no `brief` key.

A decline prints `declined · <reason>` (or the same shape as JSON) and exits `1`:

```bash
$ fsdev conductor answer no-such-question "whatever"
declined · unknown-question
```

A failed last attempt with no open question prints under the row:

```bash
$ fsdev conductor status PR-482
status · claiming
tool · Bash pnpm test
pr-reviewer
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   pending           2       failed      ·
  ! failed
    no pull request
```

`abort` (alias `stop`) stops the running request on matching rows, then reprints the board. Each request prints its own line: `stop · <requestId>` when the request was stopped, or `stop · <requestId> was not running` when that request is not in progress. After a stop the exit code is the board-outcome code below.

```bash
$ fsdev conductor abort PR-482
stop · req-pr-482
pr-reviewer
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   in_progress       1       running     ·

$ fsdev conductor stop PR-482
stop · req-pr-482 was not running
pr-reviewer
ISSUE           PHASE       STATUS            ATTEMPT OUTCOME     ASK
PR-482          implement   in_progress       1       running     ·

$ fsdev conductor abort
nothing running to stop
```

### Exit codes

Startup failures — a missing argument, a slashed unknown name, a missing conductor flow, a flow missing one of the required actions — use the CLI's usual codes (`2` invalid args, `3` config error, `4` discovery error). An unslashed line that is not a known verb is talk, not an unknown verb. `fsdev conductor steer` with no message prints `steer needs a message` and exits `2`. Once past startup, `status`, `wake`, `watch`, `abort`, and non-interactive `start` use the codes below for the board:

| Code | Meaning |
|---|---|
| `0` | Every named row is `completed` |
| `1` | The board is empty, the last attempt failed, or the action call itself failed |
| `2` | At least one row has an open question |
| `3` | Running or pending, with no open question and no failed attempt |

A last attempt failed when a row's `status` is `errored` or `cancelled`, or when `run.outcome` is `"failed"`, including a row whose status is `pending`. An open question is code `2` and wins over a failed attempt.

`seed` always exits `0`, even when the board has pending, failed, or open-question rows. `steer` exits `0` when the talk succeeds, even when the board then has a pending, running, failed, or open-question row. When the action returns an error, `steer` prints it and exits `1`. `answer` exits `0` on `"answered"` or `"recovered"`, `1` on `"declined"`. `abort` with no running request id exits `1` and prints `nothing running to stop`. After a stop, or when the printed id was not running, it reprints the board and uses the codes above.

`watch [issue]` polls `status` every couple of seconds and reprints a compact line (issue + status) whenever that line changes. That poll line does not include the flow `id` or `repo`. It stops when the code is not `3`. An open question is code `2`. A failed last attempt is code `1`. `watch --json` reprints the JSON board (with `epic`, and `repo` when set) whenever it changes. When watch stops on a question or a failed attempt, the full plain-text dump includes the flow `id` line.

### `start`

```bash
fsdev conductor start PR-482
fsdev conductor start PR-482 Rename getSession in the docs
conductor start PR-482
```

`start` files a row through `seed`. `--phase` applies. Extra words after the issue id are `brief`. Without an issue id, the command prints `start needs an issue id` and exits `2`.

On a TTY it opens the fullscreen board, then files the row. The line left on the main screen before the board is the flow `id`, then ` · ` and the checkout basename when `CONDUCTOR_REPO` is set. There is no ISSUE/PHASE table on that screen. After the board is open, the seeded issue is the selected row. When seed succeeds, activity includes `seeded PR-482 → PR-482--implement`. Interactive `start` uses the same silent log default as `tui`. If that issue/phase pair already has a row, seed writes no new row and the board opens focused on that row.

On a pipe it seeds, then watches that issue the same way `watch <issue>` does. It prints the seed line and the watch dump (issue id, pending, and the rest of that print) and uses the watch exit codes.

On an open board, `/start <issue>` files a row the same way `/seed <issue>` does, and selects that issue.

Filing a row does not implement or edit product code. Workers do that after the row is filed. On a TTY, `start` does not exit when a coding run finishes.

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
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd. Used even when `CONDUCTOR_CONFIG` is set. |
| `--no-config` | Ignore config files and `CONDUCTOR_CONFIG`, and discover from the cwd |
| `CONDUCTOR_CONFIG` | Config path when `--config` and `--no-config` are omitted. A blank value is treated as unset. A missing path errors with `Config file not found: …`. |
| `CONDUCTOR_REPO` | When set, the fullscreen header, tab title, leftover line after `/quit`, and headless board dumps include the basename of that checkout. A blank value is treated as unset. |
| `--quiet` | Suppress runtime logs on stderr |
| `--log-level <level>` | Stderr log level: `debug` \| `info` \| `warn` \| `error` (board and interactive `start`: silent; other headless: `warn`) |

Runtime resolution matches `fsdev run` and [`fsdev chat`](./interactive-chat.md): an `fsdev.config.ts` in the cwd wins over directory discovery, and `--session` names the session every `wake` runs under, not a per-row session.

## The lab bin

The conductor lab ships `labs/conductor/bin/conductor.mjs`.

```bash
node labs/conductor/bin/conductor.mjs install
```

From this repo root, `pnpm conductor install` runs that same file. `install` writes a symlink at `$HOME/.local/bin/conductor` pointing at the bin, then prints `installed $HOME/.local/bin/conductor`. Running it again replaces an existing symlink.

If `$HOME/.local/bin` is not on `PATH`, stderr also prints:

```
conductor: add $HOME/.local/bin to PATH
```

If `$HOME/.local/bin/conductor` exists and is not a symlink, install prints `conductor: $HOME/.local/bin/conductor exists and is not a symlink` and exits `1`. If `HOME` is unset, it prints `conductor: HOME is unset; cannot install to ~/.local/bin` and exits `1`.

Once the symlink is on `PATH`, `conductor install` is the same command. Stand in the app directory you want the board to operate on and run `conductor`. When `CONDUCTOR_CONFIG` is unset or blank, the bin sets it to the lab's `fsdev.config.ts`. When `CONDUCTOR_REPO` is unset or blank, the bin sets it to `.` (the directory you are standing in). An explicit `CONDUCTOR_CONFIG` is left as you set it.

When `CONDUCTOR_REPO` names a git checkout and you are standing in a different git checkout, the bin prints this on stderr and exits `1`. It does not open the board.

```
conductor: CONDUCTOR_REPO is /tmp/other-checkout but you are standing in /tmp/fsd-product.
cd there, or unset CONDUCTOR_REPO, CONDUCTOR_EPIC, and CONDUCTOR_CHECKOUTS together to use this checkout.
```

`CONDUCTOR_EPIC` and `CONDUCTOR_CHECKOUTS` are the other names that keep the bin on the checkout `CONDUCTOR_REPO` names. Unset those two with `CONDUCTOR_REPO` to use the directory you are standing in. `cd` to the named `CONDUCTOR_REPO` to use that checkout.

A third line appears only when other non-blank `CONDUCTOR_*` values remain. It names them and says they will still apply. `CONDUCTOR_CONFIG` is omitted, even when it is set. The three names from the second line are not repeated. Blank or whitespace-only values are omitted. When other `CONDUCTOR_*` values are set, that line looks like this:

```
CONDUCTOR_AGENT_MODEL, CONDUCTOR_BASE_REF, CONDUCTOR_MAX_ATTEMPTS, CONDUCTOR_RUN_TIMEOUT_MS are still set and will apply after that.
```

The refuse does not print when you are not standing in a git checkout, or when `CONDUCTOR_REPO` is this same checkout, including `.`. Standing in the repository that contains `labs/conductor` does not print this message, even when `CONDUCTOR_REPO` names another checkout.

Running `fsdev conductor` directly does not apply this check.

The lab config refuses when `CONDUCTOR_REPO` names the repository that contains `labs/conductor`. From this repo root, `pnpm conductor` with `CONDUCTOR_REPO` unset fills `.`, which is that repository.

## What it won't do

- Talking is a coordinator turn, not a coding session. The coordinator does not implement or edit product code. Workers do that after a row is filed or woken.
- `start` files a row. It does not implement or edit product code. On a TTY it does not exit when a coding run finishes.
- Talking needs a configured model resolver. Opening the board does not.
- A coding worker needs whatever auth that worker uses.
- For a conversation REPL, use [`fsdev chat`](./interactive-chat.md).
- The board table is exactly what `status` returns.
- A long fullscreen board shows eight rows around the selection. Headless `status` prints every row.
- Watching or aborting a running row does not start work or send an answer. Abort does not resume a session. Reprinting a last attempt does not continue that coding session.
- The transcript does not print a reasoning essay. Thinking is one compact `think ·` line. An empty think is omitted.
- The transcript does not read the checkout. A Write or Edit that only names the path has no hunk.
- `/find` searches only the selected row's transcript. It does not search another row's stream, the checkout, or the filesystem. The find prompt types and backspaces one character at a time. An unselected request keeps the newest two thousand lines. The selected attempt is kept in full.
- Word jump and word delete apply while composing. They do not move table rows or questions.
- Slash completion does not invent ids that are not on the board. It does not complete `/seed`, `/start`, `/steer`, or `/find`.
- `brief` is not a row id. `/status`, `/watch`, `/abort`, and the headless verbs take the issue id, or the row's task id when it has no issue.
- A flow whose `status` rows omit `brief` will not show one.
- Headless verbs take the id on the argv. There is no list on that path. They do not restore or change the selected row.
- A talk turn that only reads the board does not change the selected row.
- Headless `seed` and `steer` do not open the board.
- Without a loaded config, the board does not remember the selected row or compose lines after `/quit`.
- There is no combined transcript of every running row.
- There is no combined todo list of every running row.
- Headless `status` and `watch` have no RUN band. They print last-write age on a running row, plus checkout, token counts, spend, and last message when the row has them. A named issue also prints last tool, files, last hunk, and current todo on stdout. A row with a `brief` prints `brief  <text>`. A full-board print does not reprint last tool, files, hunk, or todo on a settled row.
- Clicking a row does not change the selection.
- The mouse wheel does not scroll the TRANSCRIPT pane.
- The interactive surface needs a TTY. There's no web UI for it — use the headless verbs from a script, or [`fsdev dev`](./overview.md#when-to-use-it) if you want a browser.
- `CONDUCTOR_CONFIG` is read only by `fsdev conductor`. `fsdev run`, `fsdev chat`, and the other commands do not use it.
- `install` is a lab-bin command. It is not an `fsdev conductor` verb.
- There is no verb that switches flow ids. Run a second `fsdev conductor` for the other flow.
- Your `status` action returns `rows`. The printed JSON board also has `epic`, and `repo` when `CONDUCTOR_REPO` is set.
- `CONDUCTOR_REPO` names the checkout in the fullscreen header, the tab title, the leftover line after `/quit`, and headless board dumps. It does not pick the flow or the config.
- The PATH `conductor` bin prints on stderr and exits `1` when you stand in one git checkout and `CONDUCTOR_REPO` names another. Standing in the repository that contains `labs/conductor` does not print this message, even when `CONDUCTOR_REPO` names another checkout. Unset `CONDUCTOR_REPO` with `CONDUCTOR_EPIC` and `CONDUCTOR_CHECKOUTS` to use the directory you are standing in, or `cd` to the named `CONDUCTOR_REPO`. A third line appears only when other non-blank `CONDUCTOR_*` values remain; it names them and says they will still apply. `CONDUCTOR_CONFIG` is omitted, and the three names from the second line are not repeated. Running `fsdev conductor` directly does not print that refuse.
- The lab config refuses when `CONDUCTOR_REPO` names the repository that contains `labs/conductor`.

## Related pages

- [Interactive chat](./interactive-chat.md) — the live-conversation REPL, for a different kind of flow.
- [CLI API](/docs/api/cli) — the full flag and command reference.
- [Actions](/docs/fundamentals/actions) — how a flow's actions are wired to `runAction`.
- [State operations](/docs/fundamentals/state-operations) — `patchState` and friends, used to author a board like the one above.
