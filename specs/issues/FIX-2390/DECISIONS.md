# FIX-2390 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: plan, Codex and Cursor workers, routing text, a composer chip that
hints the delegate, and in Shift Manager a choice of harness and a longer budget. Two calls shape
it.

<a name="d1"></a>
## D1 · The chip writes one visible line on the message

| | A visible line (chosen) | A hidden prefix the transcript strips | A typed *preferred delegate* on the turn input |
|---|---|---|---|
| What the model reads is what the person sees | yes | no | yes, but as a field |
| New package surface | none | none | a workforce turn field, every app |
| Lab code only (FIX-2152 ER-9) | yes | yes, plus a strip rule in two renderers | no |
| How reliable routing is | rests on the model reading the line | same | deterministic |

- **Because:** the issue asks for a hint and names the typed field as the fallback. A hidden
  prefix is the same hint plus a second rule that hides what the model was told.
- **Locks in:** the line's wording is the contract the routing text reads, so both change
  together. The goal leg and its `no-hint` control prove the line is what routes.
- **What would change my mind:** the goal leg passing only some runs. Then the typed field is
  filed against workforce, as the issue says, and the chip writes it instead.

<a name="d2"></a>
## D2 · Shift Manager: more harnesses and a budget now, per-task choice later

| | Process-level choice and budget (chosen) | Per-task choice in the app | Per-task choice lifted into harness-manager first |
|---|---|---|---|
| Real FSD issues stop being cut off at 10 minutes | yes | yes | yes |
| Codex and Cursor usable in Shift Manager | yes, one per process | yes | yes |
| A second copy of the lab's per-worker routing | no | yes (ER-3 forbids it) | no |
| Size | small, wave 0 | medium | medium, a package slice |

- **Because:** epic ER-3 says a need two apps show goes to the package. The lab's
  `harness-thread` router already picks a manager per worker; Shift Manager needs the same, so
  the right home is `harness-manager`, not a second copy in the app. That is not a wave-0 quick
  win.
- **Locks in:** Shift Manager still runs one harness per process. A follow-up is filed when
  this merges: lift per-worker harness routing into `harness-manager`, then Shift Manager
  chooses per task or per project and the lab drops its router.
- **No new start-time refusal.** Codex and Cursor start without a sign-in check here: FIX-2391
  (#4372) makes Shift Manager's start report readiness for every harness instead of refusing,
  so a refusal added here would only be removed there (Architect, round 1).
- **What would change my mind:** Jake wanting per-task choice in Shift Manager inside this
  epic. Then the follow-up joins FIX-2369 as a wave-1 package slice.

## Decided, not asked

- **E1 · Worker names** follow the issue: `coder-plan`, `coder-codex`, `coder-cursor`, and
  `thread-coder-*` for threads mode. Ids are what the routing text names.
- **E2 · The plan thread has no review line.** A plan run commits nothing, and the manager's
  review waits only on a run that committed.
- **E3 · The chip's choice lasts while the session is open**, not across reloads. Remembering it
  is a later call if people ask.
- **E4 · *Plan first* is Claude Code only.** Codex and Cursor have no read-only mode the flow
  builds; the chip offers what the flow can run.
- **E5 · Shift Manager's budget is one setting for every harness**, in minutes, with the stub
  keeping its own 60 seconds. A value that isn't a positive whole number is refused at start,
  as an unknown harness is.
- **E6 · No browser readiness on the chip.** FIX-2403 adds it after FIX-2391.
- **E7 · Showing the budget in Shift Manager's inspector goes with FIX-2398**, which shows a
  run's duration and attempts. Here the start line names it.

## How it got here

- Drafted 2026-10-31 from the issue and the code on `main` (675f614): `harness-thread.mts`
  already builds the four managers, and Shift Manager's `selectHarness` takes two choices.

## Notes from review

- FSD Architect (5f78b89): **folded.** Shift Manager adds `codex` and `cursor` with no new
  refuse-at-start check, so FIX-2391's readiness report owns start behaviour for all three.
- Cursor (5f78b89), approved direction. **Folded:** `no-route` covers `desk.lead` too; routing by
  the person's own words is best effort, unchecked. **Recorded for the implementer:** keep the
  `Coder:` line's wording in one place in code (the composer) with a test pinning the exact
  words the two `WORKER.md` files name, since a prompt file can't import a constant; the hint
  routing is lab-only, and Shift Manager's choice stays process-level; D1 trades deterministic
  routing for no package surface, which the goal leg and its controls keep honest.
- Codex (5f78b89): no findings, three runs.
