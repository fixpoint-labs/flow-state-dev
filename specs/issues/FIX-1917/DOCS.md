# FIX-1917 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic's shared story is in [its draft](../../epics/FIX-1907/DOCS.md), and "The run's plan" on
the coding agents page is FIX-1915's. This issue publishes the Cursor specifics and Kitchen Sink's
Cursor section. PR-A publishes the first three; PR-B the last.

## UPDATE · `apps/docs/docs/tools/cursor.md` · "What it emits", a row after "Tool call"

> | A change to Cursor's to-do list | `tool_output`, like any tool call. With `recordPlan`, also rows in the run's plan record ([Recording the run's plan](#recording-the-runs-plan)) |

## CREATE · `apps/docs/docs/tools/cursor.md` · section "Recording the run's plan", after "What it emits"

> ## Recording the run's plan
>
> Cursor keeps a to-do list while it works, and updates it as it goes. Turn on `recordPlan` and
> the block records that list in the run's plan record, the `observed-plan` collection every
> harness writes in the same shape ([the run's plan](./coding-agents.md#the-runs-plan)):
>
> ```ts
> cursorAgent({
>   cwd, resume, onSession,
>   recordPlan: true,
> });
> ```
>
> Each row is one to-do item: its wording (`title`) and Cursor's own word for its status
> (`status`): `pending`, `inProgress`, `completed` or `cancelled`. Read the status as text. A
> later Cursor may add a word.
>
> The record always holds the whole list as Cursor last confirmed it. An update Cursor sends can
> change only part of the list, so the block writes nothing until Cursor answers with the list as
> it now stands. An update Cursor rejects changes nothing. You still see every update as a tool
> call in the stream. The block writes through core's `replacePlanList`, the same helper every
> harness whose plan arrives as a whole list uses, so the run's list marker
> (`observed-plan-list`) says whether that list was saved in full.
>
> Cursor doesn't tell the SDK which item is which, so a row is an item's place in the list. If
> Cursor changes an item's status, its row keeps the old one as `previousStatus`. If Cursor
> rewords the item at a place, the row takes the new wording and `previousStatus` is cleared. If
> the list gets shorter, the rows past its end are removed. If Cursor reorders its list, rows after
> that point describe different items, so don't follow one item across a reorder.
>
> A run that never updates its list records nothing: no rows and no marker, which a plan panel
> shows as "no plan recorded for this turn". A list Cursor empties is different: the marker says
> the list is complete with nothing in it. If a write fails partway, the marker says the list is
> incomplete, with the error, so a reader never shows a half-written list as the plan. Cursor's
> plan-mode document, the one `mode: "plan"` produces, is not recorded.
>
> `recordPlan` is off by default. Off, the block declares no session state, exactly as before,
> which is what lets a task board hand it off without any further option.

## UPDATE · `packages/cursor/README.md` · "Option groups", after the table

> `recordPlan: true` records Cursor's to-do list in the run's plan record, `observed-plan`, the
> shape every harness shares and `@flow-state-dev/core` defines. The record holds the whole list
> Cursor last confirmed, one row per place in the list, with Cursor's own status words. Off by
> default; off, the block declares no session state. Guide:
> [Recording the run's plan](https://flow-state.dev/docs/tools/cursor#recording-the-runs-plan).
>
> `env` is the environment Cursor's runtime sees. Set it and the block runs the runtime in a
> separate process with exactly those variables, so commands Cursor runs start without the rest of
> your server's environment. It is not a security boundary: the process runs as your server's user,
> and on Linux a command can still read the server's environment through `/proc`. Leave it out and the runtime runs in your process, as before.

## UPDATE · `apps/kitchen-sink/README.md` · new section "Cursor mode", after FIX-1915's "Claude Code mode"

> ## Cursor mode
>
> Pick **Cursor** to work a Cursor session the way you would on its own. Each turn continues the
> same Cursor agent, its steps show while it works, and its to-do list sits beside it.
>
> It runs on your machine through the Cursor SDK, which brings its own runtime, so the Cursor
> editor isn't needed. Sign in the way the SDK does: set `CURSOR_API_KEY`, or log in once with the
> SDK's login. The mode uses Cursor's `composer-2.5` model. A host without the SDK, or without a
> key or a login, shows the mode as unavailable, with the reason.
>
> **Where it works.** Like every harness mode, each session gets its own git worktree and branch
> of the repository `KITCHEN_SINK_HARNESS_WORKSPACE` names, on `kitchen-sink/cursor-session/<session>`,
> and every turn of that session works there. Cursor runs with its sandbox on, which lets it edit
> files in that worktree and nowhere else, `.git` included, so its work waits uncommitted for you
> to review. Its commands start with only the environment variables Kitchen Sink passes it, not the
> server's whole environment. That is not a security boundary;
> containing a command that goes looking takes a separate user or a container. A command Cursor started can keep running briefly after you stop a turn.
>
> **Continuing.** A session is one Cursor agent. Stop a turn and the next one picks up the same
> agent. If Cursor won't resume it, the session says so on every turn and keeps trying. A turn
> you stopped shows as stopped, not refused. It never quietly starts a new agent; start a new
> session for that.
>
> **The plan panel** shows Cursor's to-do list for the session's latest turn, as Cursor last
> confirmed it, read-only. A turn where Cursor kept no list says "no plan recorded for this
> turn"; one where Cursor emptied its list says "this turn's plan is empty". If the list couldn't
> be saved in full, its rows are marked "may be incomplete". When Cursor reorders its list, the rows follow their places, not the items. Nothing in
> the panel starts work.

The opening paragraph (the epic's draft, published by FIX-1914) names Cursor only once this
section ships. No other page changes. If Cursor's SDK starts passing item ids, the paragraph on
places in "Recording the run's plan" and the panel's reorder sentence change with D2.
