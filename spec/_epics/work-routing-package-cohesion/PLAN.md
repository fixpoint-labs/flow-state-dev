# FIX-1407 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails — not how to build any piece,
which is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: a ship fence band across the top saying no W4 ship PR merges until every W3 child carrying an implementation is merged to main, with four W3 children still to merge, then two W3 input lanes for TEAM.md and the tools fence whose specs are approved and unbuilt, then seven issue lanes against time. FIX-1408 has a done bar behind the now line at September 18. The three first-cut lanes — package cohesion, runtime inventory and channel boards — are empty ahead of the now line and marked spec and POC may start now, ship merge held by the fence. The two phase-2 lanes for catalog manifests and channel-admin sit further right, off the gate but holding the wrap. The manager-queue lab lane is last and marked proof, unadopted. The critical path is drawn in the gutter through the inventory, the boards and the lab.](figures/path.svg)

Nine lanes: two W3 inputs and the seven children. **One bar exists** — FIX-1408, done by decision.
Everything else is an empty lane, because nothing else has started. That is the honest picture at
the gate, and it is why the band across the top matters more than any lane: the fence is on
**merge**, not on work ([ER-14](BUSINESS-RULES.md)), so all six remaining children can open a spec
and a POC the day the objective is approved. The critical path runs inventory → boards → the proof.
Package cohesion runs beside it the whole way, because what the proof consumes from it is a
ratified contract rather than a shipped package ([the spec](SPEC.md#what-the-proof-consumes)). The
dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1408** dispatch policy | design → **closed as decided** | D4's two leans | Sub-agent vs seat-assign, `parentSessionId` at mint, opt-in history, the brief | Every other child | — |
| **FIX-1405** runtime inventory | spec → POC → impl | The three existing readers · hire · `channelInstances` · open sessions (D5) | Two layers: a declared roster composed at read time (replacing both labs' private `LabRoster`), and the live org resource | FIX-1385 · FIX-817 · FIX-1415 · wildcards, later | Medium |
| **FIX-1385** channel boards | spec → POC → impl | The ChannelFlow floor · the inventory (ER-3) · ER-5 | A channel holding `0..N` TaskCollections; two doors, one surface. Plus the PR-5 propagation pass (ER-19) | The proof · FIX-1430 | Large |
| **FIX-1394** package cohesion | **POC matrix → ratify** → ship tickets | FIX-1377's team layer · FIX-1416's `tools:` fence — **both unlanded** (ER-18) · D4 | One package format, two attachment modes. Its POC also carries the evidence for FIX-1408's open walls (ER-15) | The proof's contract at ratify; ship tickets after | Large |
| **FIX-817** catalog manifests · *phase-2* | spec → impl | FIX-1405's **approved reader contract** (ER-23), as a reader and not a second index | One discovery shape over seats, channels, resources, tools, skills | Planning before assign | Medium |
| **FIX-1415** channel-admin · *phase-2* | spec → ratify → ship tickets | The inventory · the `tools:` fence after FIX-1394 (ER-23) · Collab's system-vs-dynamic lanes | Channel create / delete / invite as a **capability**, behind seat `tools:` | DevForce's "EM opens a channel" pressure | Medium |
| **FIX-1430** manager-queue lab · *proof, unadopted* | spec → goal check | ER-1 · ER-2 as a contract · ER-4 · ER-5 — consumes four, owns none | A coordinator seat assigning over a channel board to linked seats, queue columns as views | The epic's wrap | Medium |

**Size is a read, not an estimate.** Four of the seven are exploration tickets whose own scope is
the thing being explored — FIX-1394 most of all, whose deliverable is a POC matrix and whose ship
tickets are not in this set yet.

## Where it is

Status lives in one place: [the set table](SPEC.md#the-set--as-of-2026-09-18). The lanes above are
the same state as a picture of time, redrawn when it moves.

**The inputs from other epics.** FIX-1377 (optional `TEAM.md`) and FIX-1416 (custom tools
authoring) are W3 children whose specs are **approved** —
[#1819](https://github.com/fixpoint-labs/flow-state-dev/pull/1819) and
[#1890](https://github.com/fixpoint-labs/flow-state-dev/pull/1890), both carrying `spec approved`,
both closed unmerged — and whose code has **not landed**. Both are In Development as of 2026-09-18.
Write against the approved specs and name them (ER-18). They are dashed edges in the graph because
a contract is what you get, not because the code is there.

## What unblocks what, from here

1. **The objective is approved** → all six live children may open a spec and a POC immediately.
   Nothing waits on anything else to *start*; the fence is on merge (ER-14).
2. **FIX-1405's reader contract is approved** → FIX-817 may start specifying against it (ER-23).
   Before that, two children would design one discovery API in parallel.
3. **FIX-1405's inventory lands** → FIX-1385 can assign a **team** seat rather than a literal id.
   The one edge that genuinely sequences.
4. **FIX-1385's board surface lands** → the proof can run. Until then ER-20 has nothing behind it.
5. **W3's last implementing child merges to main** → the ship fence lifts. Children completed by
   decision, duplicated or cancelled do not hold it (ER-14).
6. **FIX-1394's POC matrix is ratified** → ER-2 becomes a contract the proof can hold itself to,
   and only then are ship tickets cut (ER-8). Those are new children and will need the set table
   and this path redrawn.
7. **If the gate adopts FIX-1430 as the proof** → ER-20 gets an owner and the epic gains a
   finishing condition. If not, one needs filing, or the epic wraps on a claim.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The inventory surface | FIX-1405 and FIX-817 | 1405 owns both layers; 817 reads them, and specs only after 1405's reader contract is approved (ER-23) |
| The seat's `tools:` fence | FIX-1394, FIX-1415, and FIX-1416 outside the epic | Three edits on one fence, settled in that order (ER-23). Neither W4 child widens past seat `tools:` |
| The seat's prompt compose | FIX-1394 and FIX-1377 outside the epic | The package format composes onto framework default → team → seat. No fourth layer; the team's text does not merge into the seat's |
| The board's claim / assign surface | FIX-1385 and FIX-1430 | 1385 owns it, the lab consumes it. Cross-flow seats declare the **same logical board** (`boardId` + ledger + own same-flow gating dispatcher) — whether that is a file-convention teach is FIX-1385's open wall, not the lab's |
| The Workforce docs section | FIX-1385, FIX-1405, FIX-1430 | All three teach boards. Whichever lands second links rather than repeats |

## Not children, deliberately

Soft-after for ship, never re-parented: [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)
(**W3**, D2). Parked: [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) (**Collab RC**) —
FIX-1415 shapes a capability, not a reopen. Shipped and not reopened inside W4:
[FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359) (OOTB agent kind),
[FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) (nested-session removal — cited as a
fence, never a ship child). Consumed, not owned:
[FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388),
[FIX-1393](https://linear.app/fixpoint-labs/issue/FIX-1393),
[FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426),
[FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410),
[FIX-1373](https://linear.app/fixpoint-labs/issue/FIX-1373),
[FIX-957](https://linear.app/fixpoint-labs/issue/FIX-957).

## Wrap

When ER-20 holds **and every remaining child is Linear-terminal** — not the same moment while
FIX-817 and FIX-1415 are parented, which is the set question ([Open](DECISIONS.md#open)): run the
lessons pass over the set's review rounds, then dispatch the docs polish over the Workforce pages
the children each edited in isolation. It owes the sentence nobody else will write — that a board
**assignee** and a Workforce **seat** are two different things that map by composition (ER-5,
ER-22). Confirm FIX-1385 ran the PR-5 propagation pass (ER-19), refresh the set table and the path
one last time, and close the epic PR unmerged.
