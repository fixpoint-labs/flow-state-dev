# FIX-1592 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The order the remaining work runs in and what each piece entails. How to build a piece is that
issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 27 September 2026, in steps because the epic is unscheduled. One lane for the seven shipped children, done. Now: this amendment in review, and no child starts until it merges. Step 1, in parallel: FIX-1609 the live channel view, FIX-1610 the routed channel whose answer always lands, FIX-1605 and FIX-1606 with their PRs open, and FIX-1601's QA-plan amendment. Step 2: FIX-1611 the support desk rebuild, after FIX-1609 and FIX-1610. Step 3: FIX-1601's run on one main commit, then its closure PR, whose merge releases wrap. FIX-1591 sits below as held. The critical path runs from whichever of FIX-1609 and FIX-1610 lands second, through FIX-1611 and FIX-1601's run, to wrap.](figures/path.svg)

Three steps. FIX-1609 and FIX-1610 build side by side once this merges; FIX-1611 waits for both;
the closure run waits for everything. Whichever of the first two lands second starts the
critical path.

## What each issue entails

| Issue | Route | Blocked by | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|---|
| **FIX-1609** live channel view | spec → impl PR | this amendment | The session's requests and running child runs | A session-wide live stream the open view hears; "working" in the channel view; a no-reload browser check red on today's `main` (ER-23) | FIX-1611 · FIX-1601 | Large |
| **FIX-1610** routed channel, the answer lands | spec with a routing POC → impl PR | this amendment | The fan-out, the stock wake, members' `description:` · ER-3 · ER-4 | Workforce's opt-in route step composing core `evaluator`, with a fallback, and the `CHANNEL.md` line; the answer that lands every time, still a generator (D6); its scripted-model entries; the channels guide section (ER-21, ER-22) | FIX-1611 · FIX-1601 | Medium |
| **FIX-1611** support desk rebuild | spec → impl PR | FIX-1609 · FIX-1610 | The route line · the answer rule · the live view · D8's cut list | The roster (ER-26), escalation filing (ER-25), every check and e2e re-pointed (ER-27), the README (ER-19) | FIX-1601 | Large |
| **FIX-1605** dev page 500 · **FIX-1606** README key | bug → impl PR ([#2306](https://github.com/fixpoint-labs/flow-state-dev/pull/2306), [#2305](https://github.com/fixpoint-labs/flow-state-dev/pull/2305)) | — | — | The page renders under `next dev`; the README names the gateway key | FIX-1601 | Small |
| **FIX-1601** closure · required | [plan amendment](#fix-1601s-plan-amendment) → runs until one is clean → PR | every other child, on one `main` commit | ER-17's legs and the smoke | The report, a bug child per failure | Wrap | Medium |

**Linear, as filed.** FIX-1609 and FIX-1610 block FIX-1611; FIX-1609, FIX-1610, FIX-1611,
FIX-1605 and FIX-1606 block FIX-1601. All are parented under FIX-1592. The done children and
their relations stay.

## Notes for the child specs

- **FIX-1610, before it is built:** D5's one-call premise is untested. Its spec runs a small
  spec-poc first that proves one `evaluator` choice over a fixed member set on a real model: a
  fixed transcript, three intents.
  - Who hears is one `evaluator` block with a `choice` question over the members, its options
    built from each member's id and `WORKER.md` `description:`. `utility.cascadingRouter` is
    the altitude reference (typed choices, fail-closed), not a tree to build unless the spec
    proves a multi-level need. Not `intentRouter` or `intentClassifier`: both pick through a generator.
  - Narrow the members in the channel flow before the fan-out's forEach. Capped at one evaluator
    call per post; the specialist's own generator run is separate.
  - Unlike `cascadingRouter`, where a failed evaluation propagates, a failed call here goes to
    the fallback (ER-21). The keyless run needs a scripted evaluation answer in the one script
    file (ER-7).
- **FIX-1609:** prefer session-visible item and post events, with "working" from child-run
  summaries, over multiplexing every child request's full delta stream. Word-by-word streaming
  is out of scope.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-27) is the snapshot; follow its links for live
state. Nothing new starts until this amendment is approved and merged. FIX-1601's run is paused
until then; its QA plan ([#2288](https://github.com/fixpoint-labs/flow-state-dev/pull/2288),
amended by [#2300](https://github.com/fixpoint-labs/flow-state-dev/pull/2300)) is out of date
the moment this merges.

## FIX-1601's plan amendment

Before its next run, FIX-1601's QA plan is amended in a follow-up PR to its retained spec, from
`main`: today it grades after a reload, on the old roster. The amendment carries ER-17's legs a
to c read before any reload, the real-model smoke and every named control; names from
[D7](DECISIONS.md#d7)'s roster; and the goal checks as FIX-1611 re-points them (ER-27). Verdicts
already recorded stand.

## What unblocks what, from here

1. **This amendment merges** → FIX-1609 and FIX-1610 start, specs first, FIX-1610's with its
   routing POC. FIX-1601's plan amendment is written.
2. **FIX-1609 and FIX-1610 merge** → FIX-1611 builds.
3. **FIX-1611, FIX-1605 and FIX-1606 merge** → FIX-1601 runs on one `main` commit.
4. **Wrap**, when ER-17 to ER-19 hold and FIX-1601's closure PR has merged.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The channel panel and the kitchen-sink e2e | FIX-1609, FIX-1611 | FIX-1609 owns the live wiring and "working". FIX-1611 builds on them and owns names and re-pointing; it waits for FIX-1609 for this reason |
| The scripted model | FIX-1610, FIX-1611 | One resolver, one script file (ER-7). No second test resolver |
| The kitchen-sink README | FIX-1606, FIX-1611 | FIX-1606's key fix lands first; FIX-1611 keeps it |
| Goal checks that read kitchen-sink | FIX-1611, FIX-1601 | FIX-1611 re-points them (ER-27); FIX-1601 re-runs them (ER-18) |

## Not children, deliberately

FIX-1591 (the boards, held for the owner's `escalations` call) · FIX-1415 (channel admin, which
brings page hiring back) · FIX-1493 (verified identity) · FIX-1476 (the channel convention,
Done) · FIX-1598 (durable hire, Done, another epic's). Linked, never re-parented.

## Wrap

When ER-17 to ER-19 hold: run the lessons pass, with the reload-graded checks as its first case;
dispatch docs polish over the kitchen-sink README and the channels guide; report the outcome in
Linear from the browser evidence and the smoke. Design changes go in a follow-up PR from `main`.
