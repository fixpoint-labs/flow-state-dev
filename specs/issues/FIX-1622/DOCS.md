# FIX-1622 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Drafted by the spec author, not by `docs-writer`: this session could not dispatch it. The
implementer runs `docs-writer` and then `docs-editor` over these drafts against what shipped,
before publishing. Headings are as they publish; quoted text is the proposed prose.

## UPDATE · `apps/docs/docs/workforce/ui.md` · the opening paragraph and its import

> `@flow-state-dev/react` ships the screens a workforce needs. Most of it is one component: a
> navigator that browses your flows. Beside it sit the roster and a board, drawn as columns or
> as a list. You import them; there is nothing to copy into your app.
>
> ```tsx
> import { FlowNavigator, Roster, BoardColumns, BoardList } from "@flow-state-dev/react";
> ```

The rest of the example is unchanged.

## UPDATE · `apps/docs/docs/workforce/ui.md` · "Showing the roster and the boards", a new subsection after "A board column is grouped by task status…"

> ### A board as a list
>
> `BoardList` draws the same board as one list, newest first, with each task's status beside
> it. Reach for it when people scan a board rather than work it, such as a queue of cases
> waiting for a person. It reads through the same `sessionId`, `boardRef` and `resourceClient`
> as `BoardColumns`, and adds `live`:
>
> ```tsx
> import { BoardList } from "@flow-state-dev/react";
>
> <BoardList
>   sessionId="support.help"
>   boardRef="support.help.escalations"
>   resourceClient={resourceClient}
>   live
> />
> ```
>
> With `live`, the list follows the session you pass and reads the board again whenever that
> session records a change to it. A task filed through a channel's `fileTask` is recorded in the
> channel's own session, so pass the channel's id, as above. Each new task then shows up within
> a couple of seconds, in every tab that has the list open. The channel's flow already declares
> its boards, so reading through the channel needs nothing extra in your shell's flow.
>
> A change recorded in a different session does not reach a live list until something makes it
> read again: a remount, a reload, or the next change in the session it follows. A seat that
> claims and finishes tasks from its own conversation is the usual example. So `live` suits a
> board that is filed through its channel and read by people. For a board your seats work, read
> it on mount, as `BoardColumns` does.
>
> A live list holds a connection open while it is mounted, the same one
> [`useSession`'s `live`](../client/react.md#hearing-requests-you-didnt-send) opens, and your
> server reads that session about once a second for it. It carries the same credential as the
> list's reads. If the server doesn't offer the stream, or refuses it, the list reads once, as
> if you hadn't asked, with no error.
>
> Each row shows the task's `title`, falling back to its `goal`, then its `id`, and its status
> word: `pending`, `in_progress`, and so on, the same words the columns are headed with. A task
> in a status the list doesn't recognise still shows, with its own word.

## UPDATE · `apps/docs/docs/workforce/ui.md` · "Where each component reads from", the standing-collection paragraph, replaced

> **A standing collection.** The roster, the board columns and the board list read a collection
> that lives outside any one session. Everyone in the organization sees the same rows. They read
> it when they mount. A `BoardList` with `live` also reads again when the session it follows
> records a change to the board ([A board as a list](#a-board-as-a-list)); the others don't
> watch. To read one of them again on demand, change the component's React `key`.

## UPDATE · `apps/docs/docs/workforce/ui.md` · "Styling it", the first bullet

> - **CSS custom properties** for colour, spacing and type: `--fsd-nav-*` for the navigator,
>   `--fsd-panel-*` for the roster, the board columns and the board list. Set them on any
>   ancestor.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Showing a board on screen", after the `BoardColumns` example

> To show the board as a list that picks up each new task as it is filed, read it through the
> channel's own session and add `live`:
>
> ```tsx
> import { BoardList } from "@flow-state-dev/react";
>
> <BoardList sessionId="engineering.incidents" boardRef="engineering.incidents.followups" live />
> ```
>
> `fileTask` runs in the channel's session, so the list hears every filing. A worker draining
> the board records its claims in its own session, so those show on the list's next read. See
> [A board as a list](./ui.md#a-board-as-a-list).

## UPDATE · `packages/react/README.md` · a new `### BoardList` after `### BoardColumns`

> ### BoardList
>
> `BoardList` draws one task board as a single list, newest first, with each task's status word.
>
> ```tsx
> import { BoardList } from "@flow-state-dev/react";
>
> <BoardList sessionId="support.help" boardRef="support.help.escalations" live />
> ```
>
> It reads the same rows `BoardColumns` does, through the same `sessionId`, `boardRef`,
> `resourceClient` and `limit`, and labels a row the same way. Nothing is hidden: a finished or
> cancelled task stays in the list, and a status the component does not recognise shows as its
> own word.
>
> `live` re-reads the board whenever the session named by `sessionId` records a change to it. A
> channel's `fileTask` records in the channel's session, so pass the channel's id to hear every
> filing. A change recorded in another session, such as a worker draining the board, shows on
> the next read. The list draws what its read returns, never the change's own payload. With
> `live` off, the default, it reads on mount like the other panels. A server that doesn't
> offer the session stream, or refuses it, leaves the list reading once, with no error.
>
> The list renders the `<li>` for every row and puts the task's id on it, so a `row` slot
> returns the body that goes inside one.

## UPDATE · `packages/react/README.md` · "Transport and theming for the panels"

Three sentences change:

> `Roster`, `BoardColumns` and `BoardList` read every page of their collection, following the
> list route's cursor rather than stopping at the first response.

> A failed read shows what failed and offers a retry. Nothing re-reads on a timer. A live
> `BoardList` re-reads only when its session records a change to its board, and its stream
> carries the same credential as its reads.

> Fill in your own affordances through `slots`: `rowTrailing` and `empty` on `Roster`; `card`,
> `columnHeader` and `empty` on `BoardColumns`; `row` and `empty` on `BoardList`.

The sentence naming how a host hands the stream its credential is written once the prop's shape
is settled (Plan S3).

## UPDATE · `apps/kitchen-sink/README.md` · two sentences

Line 3, *"…whose navigator, roster and board columns are imported…"* becomes *"…whose navigator,
roster and board list are imported…"*.

Under "When a case needs a person":

> The case shows in the team panel's `escalations` list as soon as it is filed, newest first,
> with its status, in every tab that has the page open. The list follows `support.help`'s own
> session, where `fileTask` runs.

## Publication ownership

FIX-1622 publishes all of the above in its implementation PR, after the goal check passes. No
new page, no sidebar change. The changeset for `@flow-state-dev/react` is a `minor` naming
`BoardList` and its `live` prop.
