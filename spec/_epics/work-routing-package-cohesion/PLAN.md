# FIX-1407 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: a ship fence band across the top marking W3 open with four children, then two W3 input lanes for TEAM.md and the tools fence whose specs are approved and unbuilt, then seven issue lanes against time. FIX-1408 has a done bar behind the now line at September 18. The three first-cut lanes — package cohesion, runtime inventory and channel boards — are empty ahead of the now line and marked spec and POC may start now, ship merge held by the fence. The two phase-2 lanes for catalog manifests and channel-admin sit further right, off the gate. The manager-queue lab lane is last and marked proof, unadopted. The critical path is drawn in the gutter through the inventory, the boards and the lab.](figures/path.svg)

Nine lanes: two inputs from W3 and the seven children. **One bar exists** — FIX-1408, done by
decision — and everything else is an empty lane, because nothing else has started. That is the
honest picture at the gate, and it is why the band across the top matters more than any lane: the
fence is on **merge**, not on work ([ER-14](BUSINESS-RULES.md)), so all six remaining children can
open a spec and a POC the day the objective is approved. The critical path is short and runs
inventory → boards → the proof; package cohesion is the one lane that can run beside it the whole
way. The dependency graph itself is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this document adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1408** dispatch policy | design → **closed as decided** | D4's two leans | Sub-agent vs seat-assign, `parentSessionId` at mint, opt-in history, the brief | Every other child | — |
| **FIX-1405** runtime inventory | spec → POC → impl | The shared scan · hire · `channelInstances` · open sessions (D5) | One L2 lookup for membership expand, author check, fan-out, DM find-or-create | FIX-1385 · FIX-817 · FIX-1415 · `team.*` wildcards, later | Medium |
| **FIX-1385** channel boards | spec → POC → impl | The ChannelFlow floor · the inventory (ER-3) · ER-5 | A channel holding `0..N` TaskCollections; two doors, one mutation surface | The proof · FIX-1430 | Large |
| **FIX-1394** package cohesion | **POC matrix → ratify** → ship tickets | FIX-1377's team layer · FIX-1416's `tools:` fence — **both unlanded** (ER-18) · D4 | One package format, two attachment modes; the scale-back before both surfaces grow twice | Ship tickets, cut after ratify | Large |
| **FIX-817** catalog manifests · *phase-2* | spec → impl | The inventory as a reader, not a second index (D5) | One discovery shape across seats, channels, resources, tools, skills | Planning before assign | Medium |
| **FIX-1415** channel-admin · *phase-2* | spec → ratify → ship tickets | The inventory · the `tools:` fence · Collab's system-vs-dynamic lanes | Channel create / delete / invite as a **capability**, behind seat `tools:` | DevForce's "EM opens a channel" pressure | Medium |
| **FIX-1430** manager-queue lab · *proof, unadopted* | spec → goal check | ER-1 · ER-2 · ER-4 · ER-5 — consumes four, owns none | A coordinator seat assigning over a channel board to linked seats, with queue columns as views | The epic's wrap | Medium |

**Size is a read, not an estimate.** Four of the seven are exploration tickets whose own scope is
the thing being explored; FIX-1394 is the clearest case — its deliverable is a POC matrix, and the
ship tickets it cuts are not in this set yet.

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-18). The
lanes above carry the same state as a picture of time and are redrawn when it moves.

**The inputs from other epics, and their verified state.** FIX-1377 (optional `TEAM.md`) and
FIX-1416 (custom tools authoring) are W3 children whose specs are **approved** —
[#1819](https://github.com/fixpoint-labs/flow-state-dev/pull/1819) and
[#1890](https://github.com/fixpoint-labs/flow-state-dev/pull/1890), both carrying the
`spec approved` label, both closed unmerged — and whose code has **not landed**. Linear still reads
*In Spec Review* for both, which is [ER-16](BUSINESS-RULES.md) already failing on the two
dependencies this epic cares most about. Treat the approved specs as the contract (ER-18); treat
the Linear state as stale.

## What unblocks what, from here

1. **The objective is approved** → all six live children may open a spec and a POC immediately.
   Nothing in the set waits on anything else to *start*; the fence is on merge (ER-14).
2. **FIX-1405's inventory lands** → FIX-1385 can assign a **team** seat rather than a literal id,
   and FIX-817 and FIX-1415 stop being blocked on a lookup that doesn't exist. This is the one
   edge that genuinely sequences.
3. **FIX-1385's board surface lands** → the proof can run. Until then ER-20 has nothing behind it.
4. **W3's last child merges** → the ship fence lifts and W4 impl PRs may merge. Four remain:
   FIX-1377, FIX-1416, FIX-1435, FIX-1441.
5. **FIX-1394's POC matrix is ratified** → and only then are its ship tickets cut (ER-8). Those
   tickets are new children of this epic and will need the set table and this path redrawn.
6. **If the gate adopts FIX-1430 as the proof** → ER-20 gets an owner and the epic gains a
   finishing condition. If it doesn't, the epic needs one filed, or it wraps on a claim.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The inventory surface | FIX-1405 and FIX-817 | 1405 owns it; 817 reads it. Whether the inventory resource **is** the manifest or only feeds a tool is an open wall — neither child answers it alone (D5, ER-13) |
| The seat's `tools:` fence | FIX-1394, FIX-1415, and FIX-1416 outside the epic | Three edits pressing on one fence. Neither W4 child widens past seat `tools:`, and both write against FIX-1416's approved spec rather than around it (ER-18) |
| The seat's prompt compose | FIX-1394 and FIX-1377 outside the epic | The package format composes onto framework default → team → seat. It does not invent a fourth layer, and it does not merge the team's text into the seat's |
| The board's claim / assign surface | FIX-1385 and FIX-1430 | 1385 owns it; the lab consumes it. Cross-flow seats must declare the **same logical board** (`boardId` + ledger + own same-flow gating dispatcher) — whether that is a file-convention teach is FIX-1385's open wall, and the lab does not answer it |
| `goals/devforce-lab/` | FIX-1430 and FIX-1426 (Done, outside the set) | 1426 is the coding seam only and does not grow into the manager-queue showcase |
| The Workforce docs section | FIX-1385, FIX-1405, FIX-1430 | All three teach boards. Whichever lands second links rather than repeats, and none teaches ahead of its reader |

## Not children, deliberately

[FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) (**W3**) — soft-after for ship,
soft-related otherwise, never re-parented (D2).
[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) (**Collab RC**) — parked; FIX-1415
shapes a capability, not a reopen.
[FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359) (**OOTB agent kind**) — shipped,
parallel history, not reopened inside W4.
Also consumed, not owned: [FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388) (Door B),
[FIX-1393](https://linear.app/fixpoint-labs/issue/FIX-1393) (the `tools:` fence),
[FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426) (DevForce first slice, Done),
[FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) (nested-session removal — cited, not a
ship child), [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410) (D-12 DevForce Lab),
[FIX-1373](https://linear.app/fixpoint-labs/issue/FIX-1373) (board-worker vocab park) and
[FIX-957](https://linear.app/fixpoint-labs/issue/FIX-957) (durable task collections).

## Wrap

When ER-20 holds: run the lessons pass over the set's review rounds; dispatch the docs polish over
the Workforce pages the children each edited in isolation — it owes the sentence nobody else will
write, that a board **assignee** and a Workforce **seat** are two different things that map by
composition (ER-5, ER-22). Then settle whether PR-5's propagation pass ran or is handed on
([ER-19](BUSINESS-RULES.md)), refresh the set table and the path one last time, and close the epic
PR unmerged.
