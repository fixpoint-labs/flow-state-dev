# FIX-1914 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n), [DECISIONS.md](DECISIONS.md) (D-n) and the epic's rules (ER-n). `tdd`. One PR. Everything
is under `apps/kitchen-sink/`, `goals/` and docs; nothing under `packages/`.

## Surfaces

| ID | Where · role | Change | Rules |
|---|---|---|---|
| S1 | `lib/` · the mode list, a leaf module (BP-019) | The four modes: id, label, address, and for a harness mode its flow kind (unset until its issue fills it). Imported by the browser and the server | BR-1 BR-2 |
| S2 | `lib/` · the gate, server only | One predicate for "harness modes on for this host" (`VERCEL` unset and a workspace setting naming an existing directory), and one function giving each mode's availability and first reason, in BR-12's order. A mode's own check is a slot its issue fills | BR-5–BR-13 |
| S3 | `fsdev.config.ts` · the flow list | Harness flows are added only through S2's predicate. Today there are none; this is the seam FIX-1915 registers through | BR-15 |
| S4 | `app/page.tsx` · **replaced** | The picker: a server-rendered page reading S2 per request, four cards, the reason on each unavailable one | BR-1 BR-3 BR-4 |
| S5 | `app/flow-state/page.tsx` · **moved** | Today's `app/page.tsx`, moved whole. One addition: the rail's header row with the mode name and the link back | BR-17 BR-18 BR-19 |
| S6 | `app/` · the three harness addresses | Each reads S2. Unavailable: the reason page. Available: the harness frame (S7) with the mode's flow kind | BR-14 BR-21 |
| S7 | `components/` · the harness frame | Rail header, one `FlowNavigator` section over the mode's flow kind with **New session**, an empty-state line, and a stream slot for the mode's issue | BR-21–BR-23 |
| S8 | `lib/goal-control.ts` | Add `gate-open`, honoured only in a test-mode build like the others | Goal check |
| S9 | The 6 entry-point files | `/` → `/flow-state`, keeping each query (see [Entry points](#entry-points)) | BR-17 BR-18 |
| S10 | `goals/kitchen-sink-harness-mode/opens-on-the-picker/` | The goal check: `goal.md`, `run.mts` on `goals/lib/kitchen-sink.mts` | Goal |
| S11 | Docs | Publish [DOCS.md](DOCS.md); `apps/kitchen-sink/CLAUDE.md` layout lines; the `apps/kitchen-sink` row in the root `CLAUDE.md` | ER-18 |

## Entry points

Every place a browser opens Kitchen Sink's front page expecting the shell. Re-derived by
[`poc/entry-points/check.mjs`](poc/entry-points/), which fails if this table misses one.

| File | Opens | Reaches it |
|---|---|---|
| `apps/kitchen-sink/e2e/fixtures.ts` | `/?e2eSession=…` | 7 specs through `openKitchenSink` |
| `apps/kitchen-sink/e2e/talk-from-page.spec.ts` | `/` | itself |
| `apps/kitchen-sink/e2e/workforce-shell.spec.ts` | `/`, twice | itself |
| `goals/lib/kitchen-sink.mts` | `${origin}/` | 4 goals through `openShell` |
| `goals/kitchen-sink-talk/shows-the-reply-without-a-reload/run.mts` | `${origin}/${PAGE_QUERY}` | itself |
| `goals/kitchen-sink-talk/a-person-talks-to-a-seat-a-mailbox-and-back/run.mts` | `${origin}/…`, three times | itself |

8 of the 9 e2e specs and all 6 `kitchen-sink-talk` goals. Only `devtool-loads.spec.ts` opens
nothing but `/devtool`, and doesn't change.

## Sequence

```mermaid
flowchart TD
  S1["S1 · mode list"] --> S2["S2 · the gate"]
  S2 --> S3["S3 · flow list through the gate"]
  S2 --> S4["S4 · the picker at /"]
  S1 --> S5["S5 · today's page to /flow-state"]
  S5 --> S9["S9 · re-point the 6 entry points"]
  S2 --> S6["S6 · harness addresses"]
  S7["S7 · harness frame"] --> S6
  S4 --> S10["S10 · goal check"]
  S6 --> S10
  S9 --> S10
  S8 --> S10
  S10 --> S11["S11 · docs"]
```

Move first (S5, S9) and run the existing suite before anything new, so a red check is the move's
fault or the picker's, never both.

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S2 | Each of BR-6 to BR-12 for each harness mode, with the env stubbed per case. Flow State available in every case |
| V2 | S3 | With the predicate off, a stand-in harness flow handed to the flow list is not registered; on, it is. D2's check |
| V3 | S5, S9 | The e2e suite and the 6 `kitchen-sink-talk` goals pass at `/flow-state`, before the picker exists |
| V4 | S9 | `node specs/issues/FIX-1914/poc/entry-points/check.mjs --after` passes: nothing still opens `/` expecting the shell |
| V5 | S4, S6 | Component tests: four cards in order; an unavailable mode by address renders the reason and no navigator. D1's check |
| V6 | S7 | Component test over a stubbed session client holding two flow kinds: only the mode's kind listed; **New session** creates on it; empty state (BR-21–BR-23). Flow State's rail lists neither (BR-19) |
| V7 | S8 | `gate-open` is ignored outside a test-mode build |
| VG | all | [The goal](SPEC.md#the-goal-and-how-well-know-its-met): `goals/kitchen-sink-harness-mode/opens-on-the-picker/` PASSES on one build across three starts, after the same run FAILED under `GOAL_CONTROL=gate-open` and on today's `main` |

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| Addresses | `/`, `/flow-state`, `/claude-code`, `/codex`, `/cursor` | The README, the closure and every browser check type them (D1) |
| Host setting | `KITCHEN_SINK_HARNESS_WORKSPACE` | A person types it (D2). FIX-1915's workspace resolver reads this same setting; see *At implement time* |
| Goal control | `gate-open` | The goal check and FIX-1915's extension of it use it |
| Mode labels | Flow State, Claude Code, Codex, Cursor | The epic's ER-1 |

## Guardrails

| Rule | Because |
|---|---|
| The gate runs on the server per request; no `NEXT_PUBLIC_` value carries availability | One build serves a laptop and a deployed copy (BR-13). An inlined answer is the hollow pass the goal's one-build input exists to catch |
| The picker and the flow list read one predicate (tenet 5) | Two copies of "is it on" drift, and the page then says off while the API runs an agent (BR-15) |
| Today's page is moved, not edited, beyond the rail header row | "Unchanged" is the open question's recommended answer, and the move is what lets the suite prove it (V3) |
| No browser check is deleted or skipped to get green | A check that stops running reports nothing, and that is how `main` goes green by checking less. V4 and the entry-points table are the inventory |
| Nothing harness-specific in S7 beyond a flow kind | ER-6 and ER-11: a harness that needs more has found a gap in its package |

## Docs

Reconcile and publish [DOCS.md](DOCS.md) after VG passes, naming only Flow State as runnable
(the epic's rule: the opening never names a mode that doesn't run yet). S11 also updates the
internal lines: `apps/kitchen-sink/CLAUDE.md` → Layout (`app/page.tsx` is the picker; the shell is
`app/flow-state/page.tsx`) and the root `CLAUDE.md` package-map row. No changeset: the app is
private.

## Sketch · pseudocode, illustrative, react to the shape

```
the gate (server):
    harness modes on  ←  not on Vercel  and  workspace setting names a directory
    for each mode:
        flow state       → available
        not on           → the host's reason
        no flow kind yet → "not built yet"
        otherwise        → the mode's own check, or its thrown message
the flow list:      add harness flows only if harness modes on
the picker at /:    render the four with their availability
a harness address:  unavailable → reason page;  available → frame(mode's flow kind)
```

**POC:** [`poc/entry-points/`](poc/entry-points/) counts every browser open of the front page and
checks this plan's table against it. It found 6 files reaching 8 e2e specs and 6 goals, and its
negative controls fail as they should. The premise held: the move is an address change in 6 files.

## At implement time

- **The workspace setting is one setting.** If FIX-1915 merged first under another name, use that
  name here and in the docs; never ship two.
- Re-run the entry-points check; a browser check added since this spec must be in the table.
- Open PR #2973 edits `talk-from-page.spec.ts` near its `/` open. Rebase onto it if it lands first.
- Compare [Evolution](EVOLUTION.md)'s predecessor claims with the current shell and README.

## Follow-ups

- None filed. If the open question is answered "move it out", file the support-desk migration
  under FIX-1907 and amend this spec in a follow-up PR from `main`.
