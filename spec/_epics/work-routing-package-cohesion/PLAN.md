# FIX-1407 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails — not how to build any piece,
which is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: a ship fence band across the top saying FIX-1435 carries an implementation and is still Todo, so the W3 ship fence has not lifted — re-derived on September 19 — and that three W4 ship PRs merged under it. Then two W3 input lanes for TEAM.md and the tools fence, both landed on main on September 19, then the five lanes of the set against time. FIX-1408 has a done bar behind the now line at September 19. Each remaining lane opens with a short spec-approved bar at the now line. FIX-1405 inventory then shows a merged segment covering PR-A (#1920) and S4 (#1923), both merged, followed by an implementing bar for S5 and S6, in flight with no PR. FIX-1385 channel boards shows a merged bar running to the end of its lane: Done, #1922 merged September 19, one full-scope PR rather than the four its plan named. FIX-1394 package cohesion shows an implementing bar reading matrix #1921, authorship decided, documents still open. FIX-1430, the manager-queue lab, shows its spec bar and then a dashed lane: unblocked by #1922, build not started, and next. Below a divider two related lanes, catalog manifests and channel-admin, are marked related, not in the set: they consume FIX-1405 and hold no wrap, and catalog manifests waits for FIX-1405's approved spec. The critical path is drawn in the gutter through the boards and the lab only — the inventory sits beside it, not behind it.](figures/path.svg)

Nine lanes: two W3 inputs, the **five** children D6 ratified, and — under the divider — the two
[related issues](SPEC.md#related-not-children) that still consume FIX-1405. Every lane now carries a
bar. FIX-1408 is done by decision; FIX-1385 is done by merge; FIX-1405 has two merged segments with
S5/S6 still running; FIX-1394 sits at its ratify. They specced at once because the fence is on
**merge**, not on work ([ER-14](BUSINESS-RULES.md)). The lane the tracker holds and this figure does
not is [FIX-1451](SPEC.md#the-sixth-child) — deliberately, until it is confirmed a child or
re-homed.

**The critical path ran boards → the proof, and the first half is behind us.** FIX-1430 waited on
FIX-1385's implementation; that merged on 2026-09-19, so the lab's build is the critical path now
and nothing in the set sits in front of it. The inventory and package cohesion are *beside* it, not
behind it. The one **merge-order** seam settled in the order it named
([seams table](#coordination-seams-to-watch)); a merge order was never a start dependency.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1408** dispatch policy | design → **closed as decided** | D4's two leans | Sub-agent vs seat-assign, `parentSessionId` at mint, opt-in history, the brief | Every other child | — |
| **FIX-1405** runtime inventory | spec → POC → impl | The three existing readers · hire · `channelInstances` · open sessions (D5) | Two layers: a declared roster composed at read time (replacing both labs' private `LabRoster`), and the live org resource | FIX-817, on its approved reader contract (ER-23) · FIX-1415 · `team.*` wildcards, later. **Not FIX-1385** | Medium |
| **FIX-1385** channel boards | spec → POC → **impl, merged** | The ChannelFlow floor · ER-5 · ER-3, which it may not re-decide and reads only **if** the roster has landed | A channel holding `0..N` TaskCollections; two doors, one surface. Plus the PR-5 name check over its own diff (ER-19) | The proof · FIX-1430 — **released 2026-09-19** | Large · shipped in one PR, not four |
| **FIX-1394** package cohesion | **POC matrix → ratify** → ship tickets | FIX-1377's team layer · FIX-1416's `tools:` fence — **both landed** at `d8e4c99`, and the code wins over either spec (ER-18) · D4 | One format as a Markdown file, instructions and tools, two attachment modes, **not disk-only** ([ER-2](BUSINESS-RULES.md)); *documents in v1* still open. Its POC also carries the evidence for **one** of FIX-1408's walls — which opt-in history packs are v1 (ER-15) | Ship tickets, once the ratify completes (ER-8) — **not** the proof | Large |
| **FIX-1430** manager-queue lab · *the proof* | spec → goal check | ER-1 · **ER-2 as a fence, not an input** · ER-4 · ER-5 — consumes four, owns none of them | A coordinator seat assigning over a channel board to linked seats, queue columns as views | The epic's wrap | Medium |

**Size is a read, not an estimate.** Three of the five are exploration tickets whose own scope is
the thing being explored — FIX-1394 most of all, whose ship tickets are not in this set yet.

## Where it is

Status lives in one place: [the set table](SPEC.md#the-set--as-of-2026-09-19). The lanes above are
the same state as a picture of time.

**And Linear now holds the mirror again.** The queued writes landed on 2026-09-19 — child statuses,
the four spec documents, three new tickets — so the set table is a projection with a live copy
behind it rather than the only record ([ER-16](BUSINESS-RULES.md)). The wrap term stays derived from
GitHub either way ([below](#terminal)).

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
4. **FIX-1385's implementation landed** ([#1922](https://github.com/fixpoint-labs/flow-state-dev/pull/1922),
   2026-09-19) → **the proof can run now.** That was the set's only true blocking edge, and it is
   discharged: ER-20 has a surface behind it, and FIX-1430's build is the next thing to start.
5. **W3's last implementing child merges** → the ship fence lifts (ER-14). Re-derived 2026-09-19:
   that is **FIX-1435**, still `Todo`, so the fence has not lifted — and three W4 ship PRs merged
   under it. Recorded in [ER-14](BUSINESS-RULES.md), for the owner.
6. **FIX-1394's ratify completes** → ship tickets are cut (ER-8). Half of it is answered — the
   format is the Markdown file, scoped to instructions and tools, and **not disk-only** — and
   *documents in v1* is the remaining half. Those tickets are new children and will need the set
   table and this path redrawn. It does **not** unblock the proof: ER-2 already fences what the lab
   may author, and the lab waits on nothing here ([the spec](SPEC.md#what-the-proof-consumes)).

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The inventory surface | FIX-1405 and FIX-817 *(related, not a child)* | 1405 owns both layers; 817 reads them, and specs only after 1405's reader contract is approved (ER-23) |
| The seat's `tools:` fence | FIX-1394 · FIX-1415, outside the set · FIX-1416, **landed** | Three edits on one fence, in that order (ER-23). None widens past seat `tools:`, and FIX-1416's merged code is the fence's actual shape, not its spec |
| The seat's prompt compose | FIX-1394 and FIX-1377 | Composes framework default → team → seat. No fourth layer; the team's text does not merge into the seat's |
| The board's claim / assign surface | FIX-1385 (**merged**) and FIX-1430 | 1385 owned it and has shipped it; the lab consumes what landed. Cross-flow seats reach the **same logical board** by both naming its channel and board name — the id is derived, never written, which answers the file-convention question that was FIX-1385's open wall. What it did **not** settle is named in [DECISIONS](DECISIONS.md#the-cross-flow-board-residue) and has no owner |
| The same surface, again | FIX-1385 and FIX-1415 *(related, not a child)* | 1415's invite verbs land on the channel 1385 hangs a board on. Re-homing moved the wrap, not the collision |
| One channel flow factory, two PRs | FIX-1385 (**merged**) and FIX-1405's **S5/S6** | Both edit `defineChannelFlow` and the binder. **Discharged in the order it named:** FIX-1385 shipped whole on 2026-09-19, so FIX-1405's remaining steps rebase onto it rather than racing it. FIX-1405's S4 shared no file and landed independently. The distinction still holds for the rebase: board *declaration* is built-in-kind-only, channel *inventory* is every kind's |
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

When ER-20 holds **and every remaining child is terminal** — now the same moment, which is
what [D6](DECISIONS.md#d6) bought.

<a name="terminal"></a>
**Terminal is read from GitHub, not from Linear** (re-derived 2026-09-19). A child is terminal when
its **implementation PR is merged or closed**, or when this epic-spec records its work as **done by
decision rather than as code** — which is FIX-1408, and the set table is where that is recorded.
This replaces *"Linear-terminal"*, which was always a proxy for *finished*: Linear is our mirror,
not the thing that makes code shipped. The outage that prompted the re-derivation is over
([ER-16](BUSINESS-RULES.md)) and the rule **stands anyway** — a merge is what makes code shipped,
whether or not a tracker is reachable to say so.

**Two children are terminal: FIX-1408 by decision, FIX-1385 by merge.** FIX-1405 is not (S5/S6 are
in flight), FIX-1394 is not (the ratify is half answered), and FIX-1430 has not started.

**Which children count is now the open part, not which are finished.** Linear lists
[six](SPEC.md#the-sixth-child) against D6's ratified five, and this term reads *every remaining
child*. Until FIX-1451 is confirmed in or re-homed out, the wrap has a sixth, `Backlog`-state input
that nothing in this plan sequences.

**A post-approval change to a mechanism, not to the objective or the box.** The owner approved *what
W4 proves* and *what is in the box*; which tracker records a child's finish is neither. The exit
gate ([D1](DECISIONS.md#d1)), the set ([D6](DECISIONS.md#d6)) and ER-20 are untouched.

Run the lessons pass over the set's review rounds, then dispatch
the docs polish over the Workforce pages the children each edited in isolation. It owes the sentence
nobody else will write: a board **assignee** and a Workforce **seat** are two different things that
map by composition (ER-5, ER-22). Confirm FIX-1385's PR-5 name check ran **over its own diff**
([ER-19](BUSINESS-RULES.md)) — the repo-wide rename is the project's, waits on its vocabulary lock,
and is **not** this epic's to confirm or to claim. Refresh the set table and the path one last time,
and close the epic PR unmerged.
