# FIX-1407 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails — not how to build any piece,
which is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: a ship fence band across the top naming FIX-1435 and FIX-1449 as the two W3 children still non-terminal on a relayed read, with no W4 ship PR merging until every implementation-carrying W3 child is on main, then two W3 input lanes for TEAM.md and the tools fence, both landed on main on September 19, then the five lanes of the set against time. FIX-1408 has a done bar behind the now line at September 19. All four specs are approved, so each remaining lane opens with a short spec-approved bar at the now line. FIX-1405 inventory then shows a merged segment for PR-A (#1920) and an implementing bar for S4 (#1923), still open. FIX-1385 channel boards shows an implementing bar: in implementation, #1922, review round 1 folded. FIX-1394 package cohesion shows an implementing bar reading spec approved, matrix #1921, awaiting ratify, which sits with the owner. FIX-1430, the manager-queue lab, shows its spec bar and then a dashed lane only: the build has not started and runs last, after the boards. Below a divider two related lanes, catalog manifests and channel-admin, are marked related, not in the set: they consume FIX-1405 and hold no wrap, and catalog manifests waits for FIX-1405's approved spec. The critical path is drawn in the gutter through the boards and the lab only — the inventory sits beside it, not behind it.](figures/path.svg)

Nine lanes: two W3 inputs, the **five** children, and — under the divider — the two
[related issues](SPEC.md#related-not-children) that still consume FIX-1405. Five bars exist:
FIX-1408, done by decision, and the four specs written on 2026-09-19 — three first-cut ones in
parallel from the start, FIX-1430's alongside them. The lab's **build** still follows FIX-1385,
because there is nothing for the proof to demonstrate until the board surface exists. They spec at
once because the fence is on **merge**, not on work ([ER-14](BUSINESS-RULES.md)).

**The critical path runs boards → the proof.** The inventory and package cohesion sit *beside* it,
not behind it: no child in this set has a blocking prerequisite inside the set except FIX-1430,
which waits on FIX-1385's implementation. One **merge-order** seam is real and is in the
[seams table](#coordination-seams-to-watch); a merge order is not a start dependency.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1408** dispatch policy | design → **closed as decided** | D4's two leans | Sub-agent vs seat-assign, `parentSessionId` at mint, opt-in history, the brief | Every other child | — |
| **FIX-1405** runtime inventory | spec → POC → impl | The three existing readers · hire · `channelInstances` · open sessions (D5) | Two layers: a declared roster composed at read time (replacing both labs' private `LabRoster`), and the live org resource | FIX-817, on its approved reader contract (ER-23) · FIX-1415 · `team.*` wildcards, later. **Not FIX-1385** | Medium |
| **FIX-1385** channel boards | spec → POC → impl | The ChannelFlow floor · ER-5 · ER-3, which it may not re-decide and reads only **if** the roster has landed | A channel holding `0..N` TaskCollections; two doors, one surface. Plus the PR-5 name check over its own diff (ER-19) | The proof · FIX-1430 | Large |
| **FIX-1394** package cohesion | **POC matrix → ratify** → ship tickets | FIX-1377's team layer · FIX-1416's `tools:` fence — **both landed** at `d8e4c99`, and the code wins over either spec (ER-18) · D4 | Whatever the ratify records — one format with two attachment modes, or **don't collapse** ([ER-2](BUSINESS-RULES.md)). Its POC also carries the evidence for **one** of FIX-1408's walls — which opt-in history packs are v1 (ER-15) | Ship tickets, after the ratify (ER-8) — **not** the proof | Large |
| **FIX-1430** manager-queue lab · *the proof* | spec → goal check | ER-1 · **ER-2 as a fence, not an input** · ER-4 · ER-5 — consumes four, owns none of them | A coordinator seat assigning over a channel board to linked seats, queue columns as views | The epic's wrap | Medium |

**Size is a read, not an estimate.** Three of the five are exploration tickets whose own scope is
the thing being explored — FIX-1394 most of all, whose ship tickets are not in this set yet.

## Where it is

Status lives in one place: [the set table](SPEC.md#the-set--as-of-2026-09-19). The lanes above are
the same state as a picture of time.

**And it lives there alone.** Linear has not been writable from any session on this epic, so the
set table and this path are the record rather than a projection of one — the reasoning, the count
of queued writes, and what it does to the wrap term are in [ER-16](BUSINESS-RULES.md).

**Both W3 inputs have landed** — FIX-1377 and FIX-1416, merged 2026-09-19
([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911),
[#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909)), on main at `d8e4c99`. Write
against **that code** and name the commit ([ER-18](BUSINESS-RULES.md)); where a W3 spec and the code
disagree, the code wins. They stay dashed edges in the graph because they do not block, not because
the code is missing.

## What unblocks what, from here

1. **The objective is approved** — done, 2026-09-19 → the three first-cut specs opened the same day,
   in parallel. Nothing waited on anything else to *start*.
2. **FIX-1405's reader contract is approved** → FIX-817 may start specifying against it (ER-23).
   Leaving the set did not change this edge.
3. **Nothing else inside the set sequences a *start*.** FIX-1385, FIX-1405 and FIX-1394 each have
   no blocking prerequisite here. In particular there is **no inventory → boards edge**: FIX-1385's
   spec reads the declared roster only *if it has landed* and says no decision changes either way,
   and its BR-7 carries the caller's `assignee` verbatim rather than resolving a seat
   ([ER-5](BUSINESS-RULES.md)). `team.*` addressing is [ER-7](BUSINESS-RULES.md)'s, and no child
   builds it at first ship.
4. **FIX-1385's implementation lands** → the proof can run. **The set's only true blocking edge**,
   and FIX-1430's own plan states it. Until then ER-20 has nothing behind it.
5. **W3's last implementing child merges** → the ship fence lifts (ER-14).
6. **FIX-1394's POC matrix is ratified** → ship tickets are cut (ER-8). Those are new children,
   and will need the set table and this path redrawn. It does **not** unblock the proof: ER-2
   already fences what the lab may author, and the lab waits on nothing here ([the
   spec](SPEC.md#what-the-proof-consumes)).

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The inventory surface | FIX-1405 and FIX-817 *(related, not a child)* | 1405 owns both layers; 817 reads them, and specs only after 1405's reader contract is approved (ER-23) |
| The seat's `tools:` fence | FIX-1394 · FIX-1415, outside the set · FIX-1416, **landed** | Three edits on one fence, in that order (ER-23). None widens past seat `tools:`, and FIX-1416's merged code is the fence's actual shape, not its spec |
| The seat's prompt compose | FIX-1394 and FIX-1377 | Composes framework default → team → seat. No fourth layer; the team's text does not merge into the seat's |
| The board's claim / assign surface | FIX-1385 and FIX-1430 | 1385 owns it, the lab consumes it. Cross-flow seats declare the **same logical board** (`boardId` + ledger + own same-flow gating dispatcher) — whether that is a file-convention teach is FIX-1385's open wall, not the lab's |
| The same surface, again | FIX-1385 and FIX-1415 *(related, not a child)* | 1415's invite verbs land on the channel 1385 hangs a board on. Re-homing moved the wrap, not the collision |
| One channel flow factory, two PRs | FIX-1385's **PR-A** and FIX-1405's **PR-B** | Both edit `defineChannelFlow` and the binder. **PR-A lands first; PR-B rebases onto it.** A **merge** order, not a start dependency — neither spec waits on the other, and both workers have been told. FIX-1385's plan already names the seam: board *declaration* is built-in-kind-only, channel *inventory* is every kind's |
| The Workforce docs section | FIX-1385, FIX-1405, FIX-1430 | All three teach boards. Whichever lands second links rather than repeats |

## Not children, deliberately

**Re-homed at the objective gate** ([D6](DECISIONS.md#d6)), FIX-1405 dependency preserved and still
bound by ER-3 and ER-23: [FIX-817](https://linear.app/fixpoint-labs/issue/FIX-817) (catalog
manifests) and [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415) (channel create / delete
/ invite as a capability). Neither holds this epic's wrap; both remain filed.

Soft-after for ship, never re-parented:
[FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) (**W3**, D2). Parked:
[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) (**Collab RC**). Shipped and not
reopened inside W4: [FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359) (OOTB agent kind),
[FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) (nested-session removal — cited as a
fence, never a ship child). Consumed, not owned:
[FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388),
[FIX-1393](https://linear.app/fixpoint-labs/issue/FIX-1393),
[FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426),
[FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410),
[FIX-1373](https://linear.app/fixpoint-labs/issue/FIX-1373),
[FIX-957](https://linear.app/fixpoint-labs/issue/FIX-957).

## Wrap

When ER-20 holds **and every remaining child is Linear-terminal** — now the same moment, which is
what [D6](DECISIONS.md#d6) bought. Run the lessons pass over the set's review rounds, then dispatch
the docs polish over the Workforce pages the children each edited in isolation. It owes the sentence
nobody else will write: a board **assignee** and a Workforce **seat** are two different things that
map by composition (ER-5, ER-22). Confirm FIX-1385's PR-5 name check ran **over its own diff**
([ER-19](BUSINESS-RULES.md)) — the repo-wide rename is the project's, waits on its vocabulary lock,
and is **not** this epic's to confirm or to claim. Refresh the set table and the path one last time,
and close the epic PR unmerged.
