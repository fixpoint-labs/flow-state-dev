# FIX-1792 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The pages that teach the `MAILBOX.md` convention change with the code (Jake, 2026-10-03). The
upgrade page is the epic's draft ([epic DOCS](../../epics/FIX-1786/DOCS.md)), corrected for
FIX-1791's routing keys. `coordinators.md` is FIX-1791's and the conversation board's page is
FIX-1794's; links here assume both are published. The glossary and the overview's rewrite are
FIX-1796's; the word "mailbox" outside the parts removed here is FIX-1796's sweep.

Voice traps for this material: no "what it used to do" outside the upgrade page; introduce
*coordinator* and *delegate* in one plain clause on first use; no em-dash chains.

## CREATE · `apps/docs/docs/workforce/upgrading.md` · "From `MAILBOX.md` to `WORKER.md`"

Front matter: `title: From MAILBOX.md to WORKER.md`, `sidebar_label: Upgrading`. Sidebar: last in
the Workforce category of `sidebars.ts`, after `workforce/ui`, replacing `workforce/mailboxes`.

> # From `MAILBOX.md` to `WORKER.md`
>
> A coordinator is a worker that hands each post to other workers, its delegates. You declare one
> in a `WORKER.md`, like any worker. A file named `MAILBOX.md` isn't read: the app stops at load,
> names every one it found, and says where each belongs and what to change.
>
> ## Converting a file
>
> Move `teams/<team>/mailboxes/<name>/MAILBOX.md` to `teams/<team>/workers/<name>/WORKER.md`. The
> coordinator keeps the id `<team>.<name>`, so anything that addressed it by id still does.
>
> | In `MAILBOX.md` | In `WORKER.md` |
> |---|---|
> | `description:` and the body | Unchanged. The body is the coordinator's instructions |
> | (nothing) | `flow: coordinator` |
> | `members:` | `delegates:`, in the same order |
> | `routing:` with a `fallback:` | `routing: best-fit` and `fallback:` on its own line |
> | no `routing:` | `routing: everyone` |
> | `boards:`, `boardActions:` | Removed. To keep a board, add `filing: true`. See [where the board goes](#where-the-board-goes) |
> | `flow:` naming a kind of your own | No conversion. See [a kind of your own](#a-kind-of-your-own) |
>
> ```diff
> - # teams/support/mailboxes/help/MAILBOX.md
> - members: [support.devices, support.accounts]
> - boards: [escalations]
> - routing:
> -   fallback: support.accounts
> + # teams/support/workers/help/WORKER.md
> + flow: coordinator
> + delegates: [support.devices, support.accounts]
> + routing: best-fit
> + fallback: support.accounts
> + filing: true
>   description: Ask the support team anything.
> ```
>
> Write `routing: everyone` when the old file had no `routing:` line. Left out, a coordinator
> routes by its default policy, which calls a model on every post.
>
> Leave out `filing: true` if no one files tasks on the coordinator.
>
> Renaming the file isn't enough. A `WORKER.md` that still declares `members:`, `boards:` or
> `boardActions:` is refused, and the message names each line and what replaced it.
>
> **Delegates in a file are your installation's workers.** A coordinator your files declare can
> name only workers your files declare. A name that isn't one stops the load, naming it. A user
> adds their own workers to a conversation at runtime ([Coordinators](./coordinators.md)).
>
> ## Where the board goes
>
> No file declares a board. A worker keeps a board, and files tasks on it, when its `WORKER.md`
> says `filing: true`. That goes for coordinators too. Its turn then has `fileTask`, `listTasks`,
> `reassignTask` and `cancelTask`. The board belongs to the session the worker runs in: for a
> coordinator, each conversation with it, owned by the person in that conversation
> ([Coordinators](./coordinators.md)). A coordinator files for its delegates. Any other worker
> lists the workers it files for in `delegates:`.
>
> The built-in `agent` and coordinator flows can file as they are. A worker on a flow of your own
> app also needs that flow to add `createTaskFilingCapability()`. It gives you two things: a
> capability for the `uses` of the worker's generator block, and entries the flow spreads into its
> own `actions`, `internal` and `task` maps.
>
> Work that people track across conversations belongs to a workstream on a
> [project](./projects.md), led by one of your workers. The lead's workstream session keeps the
> board, so the lead needs `filing: true` too.
>
> ## A kind of your own
>
> A `flows/mailboxes/` folder isn't read. `fsdev gen` stops on it, and so does the app when it
> loads, whether or not you regenerated. If the flow should run
> workers, move it to `flows/workers/` and register it as a
> [worker flow](./built-in-worker.md#custom-worker-flows). Otherwise it's an ordinary flow of your
> app.
>
> ## What your store keeps
>
> Sessions and board rows a mailbox kept stay in your store, and nothing reads them. A request to
> one of those sessions gets `Unknown flow "mailbox"`.
>
> **Tasks waiting on a mailbox's board don't move.** A mailbox board belonged to your whole
> organization and a conversation belongs to one person, so there is no one to give them to.
> Finish or cancel them before you upgrade, or file them again on the coordinator's conversation.
>
> A project no longer lists mailboxes. For each one you still need, open a workstream led by one
> of your workers.

## REMOVE · `apps/docs/docs/workforce/mailboxes.md`, `mailbox-parts.svg`, `seat-mailbox-records.svg`

Remove the page, its two figures and its sidebar entry. Every link to it moves to `upgrading.md`
or `coordinators.md`: in `workers-on-disk.md` (the routed-mailbox sentence and the "See also"
line), `overview.md` (the page list and the task paragraph), `task-board.md`, `projects.md`.

## UPDATE · `apps/docs/docs/workforce/code-on-disk.md`

In "Where the files go", remove the `mailboxes/` lines from the tree. In the export table, remove
the `mailboxKinds` row. In "What it checks, and when", replace the "one basename in both" bullet
with:

> - A `flows/mailboxes/` folder. A flow that runs workers goes in `flows/workers/`; see
>   [From `MAILBOX.md` to `WORKER.md`](./upgrading.md#a-kind-of-your-own).

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

> A project's work is its workstreams. A create or update that carries a `workstreams` list is
> refused; open a workstream instead.

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

`packages/workforce/README.md`: the mailbox floor's section and exports go; the loader section
names the refusal. `packages/cli/README.md`: `fsdev gen`'s `flows/mailboxes/` slot goes.
`packages/harness-manager/README.md`, `packages/react/README.md`: the mailbox examples follow the
pages above. `packages/shift-manager/README.md`: the DevTeam's coordinators and its two Storefront
workstreams, led by the EM. `apps/kitchen-sink/README.md`: the help desk's coordinator, and the
escalation feature's sections removed. A `minor` changeset for `@flow-state-dev/workforce` names the
removed exports and links the upgrade page.

## Publication ownership

This issue publishes the upgrade page in P4a, with the refusal that links it, and every other
operation above in P4b, after its checks pass, reconciled against the shipped refusal wording. The upgrade page is the epic's draft, published here because this issue
ships what it describes. Nothing here edits `coordinators.md`, the glossary or the overview's
opening.
