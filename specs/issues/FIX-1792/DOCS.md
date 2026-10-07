# FIX-1792 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The pages that teach the `MAILBOX.md` convention change with the code (Jake, 2026-10-03).
There is no upgrade page: nobody has a `MAILBOX.md` or mailbox data to upgrade yet, and nothing
supports either ([D2](DECISIONS.md#d2), product owner, 2026-10-07). `coordinators.md` is
FIX-1791's and the conversation board's page is FIX-1794's; links here assume both are published.
Where a worker hands out tasks, the page that teaches the task tools is FIX-1802's; nothing here
writes a `filing:` line. The glossary and the overview's rewrite are FIX-1796's; the word
"mailbox" outside the parts removed here is FIX-1796's sweep.

Voice traps for this material: no "what it used to do" anywhere; introduce *coordinator* and
*delegate* in one plain clause on first use; no em-dash chains.

## REMOVE · `apps/docs/docs/workforce/mailboxes.md`, `mailbox-parts.svg`, `seat-mailbox-records.svg`

Remove the page, its two figures and its sidebar entry. Every link to it moves to
`coordinators.md`: in `workers-on-disk.md` (the routed-mailbox sentence and the "See also"
line), `overview.md` (the page list and the task paragraph), `task-board.md`, `projects.md`.

## UPDATE · `apps/docs/docs/workforce/code-on-disk.md`

In "Where the files go", remove the `mailboxes/` lines from the tree. In the export table, remove
the `mailboxKinds` row. In "What it checks, and when", remove the "one basename in both" bullet.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "A board a mailbox holds"

Remove the section and its "See also" line. Add to "See also":

> - [Coordinators](../workforce/coordinators.md) — the board each conversation with a coordinator
>   keeps, and filing a task on it.

## UPDATE · `apps/docs/docs/workforce/projects.md`

Remove "Mailboxes on a project" (FIX-1793's deprecated section), the `workstreams` row of the
row's field table, `setWorkstreams` from the blocks list and the actions example, the mailbox
inventory paragraph and its `projectWritesMailboxInventory` example, and the claims paragraphs.
In "Coding work in a project", the example's board is the workstream's, not `mailboxBoard(...)`.
Add one line where the list was:

> A project's work is its workstreams.

## UPDATE · `apps/docs/docs/workforce/inventory.md`

The inventory keeps one collection, seats. Remove the Mailboxes and Memberships rows, the
`MAILBOX.md` clause in the opening, and the template removal paragraph. Replace "which mailboxes
a given seat belongs to" with nothing; a coordinator's delegates are read from the coordinator
([Coordinators](./coordinators.md)).

## UPDATE · `apps/docs/docs/workforce/chief-of-staff.md`

Remove `post-to-mailbox` from the tools line, the `mailboxPostCapability` and
`mailbox-inventory` lines from the example, and the "Posting" bullet. In the opening, "who is in
a mailbox" becomes "who a coordinator hands work to".

## UPDATE · smaller pages

| Page | Change |
|---|---|
| `workforce/built-in-worker.md` | The `taskLists` option row and its example go |
| `workforce/durable-hire.md` | The `mailboxBoards` option row and its warning go |
| `workforce/ui.md` | The Mailboxes rail group and the `mailboxBoard` example go |
| `workforce/overview.md` | The `MAILBOX.md` sentence and the mailbox bullet go; FIX-1796 rewrites the page |
| `workforce/workforce-overview.svg` | The `MAILBOX.md` file in the tree goes |
| `shift-manager/overview.md` | A workstream is a project's workstream, not a mailbox |
| `devtool/overview.md` | The registered-mailboxes row goes |
| `orchestration/discovery.md` | The inventory's `mailboxes` key leaves the example; the `discover: [seats, mailboxes]` example and the domain list drop `mailboxes` |
| `client/react.md` | The example's `flowKind: "mailbox"` becomes `"coordinator"` |

## UPDATE · package READMEs

`packages/workforce/README.md`: the mailbox floor's section and exports go, `mailboxBoardTaskTools`
among them; the loader section names `WORKER.md` as the only declaration. `packages/cli/README.md`: `fsdev gen`'s `flows/mailboxes/` slot goes.
`packages/harness-manager/README.md`, `packages/react/README.md`: the mailbox examples follow the
pages above. `packages/shift-manager/README.md`: the DevTeam's coordinators and its two Storefront
workstreams, led by the EM. `apps/kitchen-sink/README.md`: the help desk's coordinator, and the
escalation feature's sections removed. A `minor` changeset for `@flow-state-dev/workforce` names the
removed exports.

## Publication ownership

This issue publishes every operation above in P4, after its checks pass, reconciled against what
ships. Nothing here edits `coordinators.md`, the glossary or the overview's opening.
