# FIX-2397 · Teammates tells you when it needs you, even from another tab

**Spec** · [Decisions](DECISIONS.md)

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **has a teammate waiting for their yes** (an approval in its conversation) | Its row reads *Idle* or *Running coding task*, plus a `+1` like any new line | Its row reads *Needs your OK: deploy to staging?* with an attention badge, above every other status |
| **has a coding task waiting on a question or a review** | Its row reads *Running coding task: X* | *Waiting on you: which branch?*, the same badge |
| **has a coding task finish or fail** | The row drops back to *Idle* the moment it ends | For two minutes the row reads *Coding task finished: X* or *Coding task failed: X* (in red), then *Idle* |
| **is in another tab** | The tab reads *Teammates*, always | The tab reads *(2) Teammates*: two teammates have something for you |
| **wants to hear about it with the tab in the background** | No way | Turns on *Notify me* in the sidebar's foot; a desktop notification says which teammate needs them, or which task ended |

## The goal, and how we'll know it's met

**From any tab, you can tell when Teammates needs you and which teammate it is.**

- **The real need:** [epic FIX-2369](../../epics/FIX-2369/SPEC.md), R-31 (*see what the work is
  doing*): long background runs are what the app supervises, so the app has to call you back.
- **Smaller, and rejected:** the status line only. A status you can't see from another tab is
  the problem the issue opens with.
- **Bigger, and not this issue's:** the same signals in Shift Manager and Kitchen Sink. Their
  sources differ, so each is its app's; FIX-2549 ([D4](DECISIONS.md#d4)).
- **Not done if:** a pending approval or a held task reads as anything but its *needs you* line,
  the title count ignores one of them, or a notification fires with the tab in front or with
  *Notify me* off.

**The check.** Unit tests on `statusLine` (priority: needs you, then replying, then running, then
a fresh ending, then messaging, then idle; the ending line gone after two minutes), on the title
count (a teammate counts once whether unread, needing you or both), and on the notifier (fires
only when on, permitted, hidden, and only for a new item). A render test of the workers list with
a fake lab shows the badge and sets `document.title` to `(1) Teammates`. Each fails on `main`.

## What changes

App glue only, in `labs/teammates`.

- **`lib/status.ts`:** a new top tier. A pending approval entry reads *Needs your OK: …*; a task
  whose row view waits on you reads *Waiting on you: …* (FIX-2379's words). A task that ended in
  the last two minutes reads *Coding task finished / failed: …*, from its `completedAt`
  ([FIX-2395](../FIX-2395/SPEC.md) puts it on the row). `statusLine` returns a tone beside the
  text, so the row can colour it.
- **`WorkersList.tsx`:** the attention badge on a row that needs you; the rows report what they
  hold, so the list sets the tab's title; the *Notify me* toggle in the foot.
- **`lib/attention.ts`:** the title count and the notifier, both pure over what the rows report.
- **Docs:** the lab README's *Left* paragraph. No site page describes the lab.

## What stays as it is

- The roster's order: a teammate that needs you is badged, not moved ([D2](DECISIONS.md#d2)).
- The conversation's own approval card and the task popup's buttons.
- Every package. No server change: everything is read from watches the rows already hold.

## What's already here, and the debt

- **Reused:** the row's watches (activity, conversation, tasks, talk), FIX-2379's `waiting`, the
  `attention` colour token ("a person must act"), `useSeen`'s browser storage pattern.
- **Adds:** one small module and its tests, a toggle. Net: neutral.
- **Leaves:** Shift Manager and Kitchen Sink attention signals (FIX-2549, [D4](DECISIONS.md#d4)).

## Sign off

- **The goal**: you can tell from any tab when Teammates needs you. *If wrong:* the title effect and badge come out.
- **D2** · [badge, don't reorder the roster](DECISIONS.md#d2). *If wrong:* a sort in one place.
- **D3** · [the title counts teammates, not lines](DECISIONS.md#d3). *If wrong:* one function.
- **Open: none.**

Improvement · `labs/teammates` · S · epic FIX-2369 wave 3 · stack 2395 → 2397
