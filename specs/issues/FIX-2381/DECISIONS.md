# FIX-2381 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic settled the package and the entry: orchestration's `./inbox`, beside
`createInboxClient`, and not a second constructor. What's left is the shape on that client, what
happens to the issue's `answer(id, answers)`, and what a re-file copies.

<a name="d1"></a>
## D1 · `inbox.board(at)` returns the board's actions

| | `inbox.board(at).cancel(id)` (chosen) | `inbox.cancel(at, id)` on every call | `createTaskActions(client, board)` (the issue's) |
|---|---|---|---|
| A second constructor | no | no | yes, which the epic's review folded out |
| The board named once per screen | yes | on every call | yes |
| Shares the answer path's send routine | yes | yes | only by importing it across |

- **Because:** a task screen works one board. Binding it once reads like the issue's
  `createTaskActions(client, board)` without a second thing to construct.
- **`at` names the session and flow, not only the board.** The board's actions run on the session
  that holds it, as the signed-in user, which is how the answer path already routes a row hold.
- **Locks in:** a method on `InboxClient`. Renaming it later is a one-file change for each app.

<a name="d2"></a>
## D2 · No second answer call

The issue lists `answer(id, answers)`. `answerOne(hold, answer)` already answers a row's question
or confirm through the same `updateTask`, typed by what the hold asks. A second call would be a
second answer path, which the epic refuses for FIX-2389's approvals for the same reason. A screen
that has a task and wants to answer its question reads the hold off the Inbox item, as both apps
already do.

<a name="d3"></a>
## D3 · A re-file copies what a browser's row carries

`refile(row, overrides)` sends `goal`, `title`, `context`, `assignee`, `labels` and `priority`
from the row, overrides winning. It doesn't copy `input`, `metadata` or `deps`: a browser's row
doesn't carry the first two (BP-015 keeps them on the server), and old `deps` may name finished
rows. An override can set any of them.

- **Re-file vs retry:** retry (FIX-2383) keeps the id, the history and the spend, and is the
  default after a failure. Re-file is for a task that should run again *changed*, which a started
  task's locked fields otherwise forbid ("cancel it and file it again", in the board's own words).
- **Debt:** the new row doesn't record what it was re-filed from. A link field is a board change,
  not a client one; file it if an app needs to show the lineage.

## Decided, not asked

- **E1 · Each action resolves on the board's `ok: true` and rejects with its error words** on
  `ok: false`, a failed request, or a 4xx, as the answer path does today.
- **E2 · `cancel` resolves to the ids it took along**, the `cancelled` list the board returns.
- **E3 · `taskToolSuffix` moves to a leaf module** and stays exported from where it is now, so
  `./inbox` stays browser-safe (its file header promises that) and no import breaks.
- **E4 · Two PRs.** The package slice on FIX-2383's branch now; Shift Manager's `reads.ts` after
  FIX-2379's slice merges, per the epic's build order (`2379 → 2381 → 2380`).
- **E5 · The Claude Code-style lab's copy goes in FIX-2382's lab stack**, which owns `adapter.ts`
  in that wave. This issue's PRs don't touch the lab.
- **E6 · No changeset unless the package PR adds a public export**, which it does: one `minor`
  fragment for `@flow-state-dev/orchestration`.

## How it got here

- Drafted 2026-10-31 from the issue, the epic's decisions and review record, and the code on
  `main` at `675f61441`.
