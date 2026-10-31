# FIX-2379 · Decisions

[Spec](SPEC.md) · **Decisions**

| | Decision | Chosen | Lost |
|---|---|---|---|
| [D1](#d1) | Where *waiting on you* comes from | The row's own open user holds, or the Inbox item's when passed in | A required `holds` argument |
| [D2](#d2) | Branch, commits and the review outcome | harness-manager's, through its `./browser` entry (FIX-2385, FIX-2386) | Orchestration reading harness-manager's output fields |

<a name="d1"></a>
## D1 · *Waiting on you* comes from the row's own holds, unless the caller has the Inbox's

**Chosen.** `taskRowView(row, holds?)`. Without `holds`, the view reads the row's own record
through `openUserHolds`, the Inbox's one hold read, with no flow lookup: kind and prompt are
right, and each hold says it can't be answered from here. With `holds` (the row's Inbox item's),
those win, since `inboxItems` also lists a stop found in the row's open run that the row hasn't
recorded yet, and knows where each answer goes.

**Lost.** A required `holds` argument, as the issue sketched it. A caller with no Inbox read
would pass `[]`, and a row holding a question would read *held* or *running*: the bug this issue
exists to remove, rebuilt by the first caller in a hurry.

**Locks in.** Waiting outranks the stored status on a non-terminal row; a terminal row is its
terminal state whatever its holds say. Only `actor: "user"` holds make a row wait on you.

<a name="d2"></a>
## D2 · Branch, commits and the review outcome are harness-manager's

**Chosen.** The view carries no branch, commit count or review outcome. Those are fields of
harness-manager's output (`managerOutputSchema`), and harness-manager depends on orchestration,
not the other way round. FIX-2385 moves `readRecordedWork` into a harness-manager `./browser`
entry and FIX-2386 shows branch and commits; an app composes that read beside this view. A
review stop's own data does reach the view, untouched, as the hold's `detail` when the reader
found it.

**Lost.** Reading `output.branch`, `output.commits` and `output.review` by name in orchestration,
as the issue's Shift Manager note asks. It would be a second reader of harness-manager's shape
in a package that can't import its schema, so a renamed field would fail silently in the view.

**Locks in.** The task-row view is the only status and *waiting on* vocabulary (epic ER-4);
harness-manager's browser entry is the only reader of what a run produced.

**Would change my mind.** If FIX-2385 lands without a function an app can call on a row's
output, the view should take that function as an option rather than reading the fields itself.

## Decided, not asked

- **It lives in `./inbox`**, not `./tasks`: it reads holds the way the Inbox does, and that entry
  is the one already published as browser-safe for a task screen.
- **An unknown stored status reads as `queued`**, its word kept on `status`, never hidden (Shift
  Manager's rule today).
- **A malformed stored spend reads as `null`**: a view never throws on a row (the Teammates
  lab's guard today).
- **`waitingOn.kind` keeps the Inbox's kinds** (`confirm` stays `confirm`); Claude Code-style's
  `confirm` to `input` mapping is that lab's to drop or keep.

## Notes from review

Round 1 (Cursor, approved; Codex, no findings). Below the bar, recorded for the implementer:

- **Pin the return shape** in the README: stored `status` beside display `state`, `error` and `statusNote` passed through, and `holds` kept beside `waitingOn.hold` on purpose (a screen that lists every open ask needs all of them).
- **One caller recipe** for a refresh that already ran `inboxItems`: index `item.holds` by task id and pass them per row, so no app runs `openUserHolds` twice or keeps its own `holdsOf` map.
- **`taskSpendView` parses with zod and can throw:** the view wraps it, lifting the Teammates lab's try/catch, so no adopter guards spend.
- **"Oldest" is `openedAt` order,** the same order `inboxItems` sorts an item's holds in.
- **`BROWSER_SAFE_ENTRIES` lists only `src/tasks/index.ts` today;** this slice adds `src/inbox/index.ts`.
- **If FIX-2385 slips,** track it as FIX-2385's blocker rather than growing `taskRowView`'s options; the wave-1 surface stays `(row, holds?)`.
- **For Shift Manager's wave-2 adoption:** its `waitsOnYou` counts row-source holds only, narrower than the view's `waiting`. That stack says how `state === "waiting"` replaces it, without a third predicate.
- **Memoize per snapshot** on large boards; the view is pure, so a screen can key it on the row.
- Fixed in the spec, a factual correction: a `held` row in Shift Manager sits under QUEUED, not RUNNING.
