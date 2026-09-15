# spec(FIX-1362): per-seat skills in the built-in worker kind

**Two workers on one roster read each other's skills, and nothing fills either one.** The contract promises *a seat's skills are that seat's*. The built-in kind shipped days ago; skills are the next thing a roster reaches for.

**Goal:** two seats, two skill folders, each holds and uses only its own. A turn that uses no skill costs nothing.

## What you're signing

| | Decision | Instead of | Locks in |
|---|---|---|---|
| **D2** | Colocated = reachable, not always-on. Tool off until turned on | Always-on by default | Drop a folder, nothing changes until `/name` or an edit. Skills never slow a worker |
| **D3** | A seat holds a copy. Refresh is deliberate, replaces the folder whole | Live propagation · file-by-file overwrite | A typo fix means a refresh. A seat's own additions in that folder are lost |
| **D1** | Skills ride the worker record, handed over at hire | `hireWorkforce` option · runtime lookup | Fixed at roster read. Re-hire to change |

**Open: none.** D2 is the one to weigh: it optimises for a promise over the thing people try first.

## What the change will satisfy

R1 distinct drawers, by contents · R2 colocated needs no list · R3 always-on in every prompt · R4 slash doesn't clobber · R5 both off costs nothing · R6 `tools: []` reaches nothing, even via delegation · R7 org edits wait for refresh · R8 refresh removes withdrawn files, seeding never deletes · R9 existing refusals unchanged · R10 `seatSkills:` refused by name · G goal check on a real model. Each maps to a decision, a surface, and a check in the [plan](PLAN.md).

## News

- New exposure: a seat's own skill can now declare `agents:`. Closed at S7.
- A collection seeded before this is orphaned, not migrated (BP-030).

## Reviewers · look here

- **D2** — is "drop a folder, type `/name`" a good enough first experience?
- **D1 / plan guardrails** — the settings bag as the only per-seat channel. Wrong layer = S5–S9 rewrite.
- **S7** — where the fence is closed.
- **Unsure:** D3's all-or-nothing half.

**Not here:** FIX-1390 · classifier · keyword tier · FIX-1364 · FIX-1366.

[Spec](SPEC.md) · [Plan](PLAN.md) · [Explainer](EXPLAINER.md) · Linear FIX-1362 · Epic FIX-1359 · builds on #1754 · never merges

<details>
<summary><b>How to review this</b> — altitude, what's in scope, what's deliberately unsettled</summary>

*(the spec-PR contract, pasted verbatim from `spec-template.md`)*

</details>
