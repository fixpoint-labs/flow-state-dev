# FIX-2565 · Decisions

[Spec](SPEC.md) · **Decisions**

**No decisions of its own.** The closure proves the epic's goal as the epic wrote it
([FIX-2516](../../epics/FIX-2516/SPEC.md#the-goal-and-how-well-know-its-met)). On the Codex and
Cursor pages leg b passes on the code word, read from the PDF's extracted text
(FIX-2520 [D1](../FIX-2520/DECISIONS.md#d1), the owner's call of Nov 8).

## Decided, not asked

- **One `main` commit for everything**, after every child has merged; the closure is blocked by
  every child in Linear.
- **The control commit** is the parent of FIX-824's merge, not today's `main`: by the time the
  closure runs, today's `main` will be long gone, and the parent of the first merge is what
  "before this epic" means.
- **A harness not signed in** on the runner's host is named in the verdict as not run, never
  counted as a pass. A cell left unrun keeps the closure open.
- **A finding** is filed as an issue against its owning child, under the epic, and the closure
  re-runs that leg after the fix.
- **The restart is real**: the server process is stopped and started on the same stores.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Re-run each child's goal check and stop | Each ran alone; the seams between them are this issue's reason to exist |
| Re-run every child's goal check before the legs | The app and harness checks are the legs themselves, on the same commit |
| One app as a sample for the others | Each app has its own composer and send path, which is why each has its own issue |

<a name="analysis"></a>
## Analysis

2026-11-08 · watermark 2026-11-05 · **Right approach.** Run over the set by `epic-agent`. Reuse:
the last closure's runner layout. The set review added the seam walks for the two seams it found
unowned.

## How it got here

- **Filed with the epic (Nov 5).** **Specced (Nov 8)** in the epic's spec set.
- **Fold (Nov 8).** Leg b on Codex and Cursor passes on the code word (the owner's call). Cut:
  sweep 1 re-runs only the kill line and the model-free package checks; the second-user 404 runs
  once; the session-copy walk went (no session copy exists).

**Open: none.**
