# FIX-1592 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The order the remaining work runs in and what each piece entails. How to build a piece is that
issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 27 September 2026, in steps because the epic is unscheduled. One lane for the seven shipped children, done. Now: this amendment in review, and no child starts until it merges. Step 1, in parallel: FIX-1609 the live channel view, the routed channel (to file), FIX-1610 the answer that lands every time, FIX-1605 and FIX-1606 with their PRs open, and FIX-1601's QA-plan amendment. Step 2: the support desk rebuild (to file), after the routed channel and FIX-1610. Step 3: FIX-1601's run on one main commit, then its closure PR, whose merge releases wrap. FIX-1591 sits below as held. The critical path runs through the routed channel, the rebuild and FIX-1601's run to wrap; FIX-1609 must merge before that run.](figures/path.svg)

Three steps. Three children build side by side once this merges; the rebuild waits for two of
them; the closure run waits for everything. The routed channel, the rebuild and the closure run
are the critical path. FIX-1609 runs beside them and must land before the closure run.

## What each issue entails

| Issue | Route | Blocked by | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|---|
| **FIX-1609** live channel view | spec → impl PR | this amendment | The session's requests and running child runs | A session-wide live stream the open view hears; "working" in the channel view; a no-reload browser check red on today's `main` (ER-23) | FIX-1601 | Large |
| **FIX-XXX** routed channel | spec → impl PR | this amendment | The fan-out, the stock wake, members' `description:` · ER-3 | The opt-in route step, a stock purpose router with a fallback, the `CHANNEL.md` line, its scripted-model entry, the channels guide section (ER-21, ER-24) | The rebuild | Medium |
| **FIX-1610** the answer lands every time | spec → impl PR | this amendment | ER-24's heard post · ER-3 · ER-4 | The routed specialist posts its answer as itself, every time; a scripted scenario that never calls the tool (ER-22) | The rebuild | Small |
| **FIX-XXX** support desk rebuild | spec → impl PR | routed channel · FIX-1610 | The route line · the answer rule · D8's cut list | The roster (ER-26), escalation filing (ER-25), every check and e2e re-pointed (ER-27), the README (ER-19) | FIX-1601 | Large |
| **FIX-1605** dev page 500 · **FIX-1606** README key | bug → impl PR ([#2306](https://github.com/fixpoint-labs/flow-state-dev/pull/2306), [#2305](https://github.com/fixpoint-labs/flow-state-dev/pull/2305)) | — | — | The page renders under `next dev`; the README names the gateway key | FIX-1601 | Small |
| **FIX-1601** closure · required | plan amendment (ER-28) → runs until one is clean → PR | every other child, on one `main` commit | ER-17's legs and the smoke | The report, a bug child per failure | Wrap | Medium |

**Linear, once the two placeholders are filed.** The routed channel and FIX-1610 block the
rebuild. FIX-1609, the routed channel, FIX-1610, the rebuild, FIX-1605 and FIX-1606 block
FIX-1601; four of those relations exist today. FIX-1609 is parented under FIX-1592; today it has
no parent. The done children and their relations stay.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-27) is the snapshot; follow its links for live
state. Nothing new starts until this amendment is approved and merged. FIX-1601's run is paused
until then; its QA plan ([#2288](https://github.com/fixpoint-labs/flow-state-dev/pull/2288),
amended by [#2300](https://github.com/fixpoint-labs/flow-state-dev/pull/2300)) is out of date
the moment this merges.

## What unblocks what, from here

1. **This amendment merges** → FIX-1609, the routed channel and FIX-1610 start, specs first.
   FIX-1601's QA-plan amendment is written (ER-28).
2. **The routed channel and FIX-1610 merge** → the rebuild builds.
3. **The rebuild, FIX-1609, FIX-1605 and FIX-1606 merge** → FIX-1601 runs on one `main` commit.
4. **Wrap**, when ER-17 to ER-19 hold and FIX-1601's closure PR has merged.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| What a woken specialist hears | Routed channel, FIX-1610 | The routed channel owns the notify input's shape (ER-24). FIX-1610 doesn't change it; if it must, it waits and consumes |
| `agent-worker-flow.ts`'s `onChannelPost` | FIX-1610, routed channel | FIX-1610 edits it. The routed channel stays in the channel flow, the binder and its own block |
| The channel panel and the kitchen-sink e2e | FIX-1609, rebuild | FIX-1609 owns the live wiring and "working". The rebuild owns names and re-pointing. Whichever merges second rebases; neither edits the other's part |
| The scripted model | Routed channel, FIX-1610, rebuild | One resolver, one script file (ER-7). No second test resolver |
| The kitchen-sink README | FIX-1606, rebuild | FIX-1606's key fix lands first; the rebuild keeps it |
| Goal checks that read kitchen-sink | Rebuild, FIX-1601 | The rebuild re-points them (ER-27); FIX-1601 re-runs them (ER-18) |

## Not children, deliberately

FIX-1591 (the boards, held for the owner's `escalations` call) · FIX-1415 (channel admin, which
brings page hiring back) · FIX-1493 (verified identity) · FIX-1476 (the channel convention,
Done) · FIX-1598 (durable hire, Done, another epic's). Linked, never re-parented.

## Wrap

When ER-17 to ER-19 hold: run the lessons pass, with the reload-graded checks as its first case;
dispatch docs polish over the kitchen-sink README and the channels guide; report the outcome in
Linear from the browser evidence and the smoke. Design changes go in a follow-up PR from `main`.
