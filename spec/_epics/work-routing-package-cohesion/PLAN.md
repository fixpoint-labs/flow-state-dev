# FIX-1407 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails — not how to build any piece,
which is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: a ship-fence band, two W3 input lanes, the five lanes of the set against time with a now line at September 19, and two related lanes under a divider. The figure's aria-label carries every lane and bar.](figures/path.svg)

Nine lanes: two W3 inputs, the **five** children D6 ratified, and — under the divider — the two
[related issues](SPEC.md#related-not-children) that still consume FIX-1405. Every lane carries a
bar, and four of the five are merged. The lane the tracker holds and this figure does not is
[FIX-1451](SPEC.md#the-sixth-child) — deliberately, until it is confirmed a child or re-homed.

**The critical path ran boards → the proof, and all of it is behind us.** FIX-1385 merged on
2026-09-19 and FIX-1430's build followed it onto `main` the same day
([#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929)). **What is in front of the epic
is not work**: it is [ER-20's own run](SPEC.md#er-20-has-not-run), which needs a model credential
this epic has never had. That is why the proof's lane ends in a gate box rather than at its bar —
the code is done and the gate is open. Package cohesion is *beside* the critical path, not behind
it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1408** dispatch policy | design → **closed as decided** | D4's two leans | Sub-agent vs seat-assign, `parentSessionId` at mint, opt-in history, the brief | Every other child | — |
| **FIX-1405** runtime inventory | spec → POC → **impl, merged** | The three existing readers · hire · `channelInstances` · open sessions (D5) | Two layers: a declared roster composed at read time (replacing both labs' private `LabRoster`), and the live org resource | FIX-817, on its approved reader contract (ER-23) · FIX-1415 · `team.*` wildcards, later. **Not FIX-1385** | Medium · all three PRs on `main` — PR-A [#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920), S4 [#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923), S5–S7 [#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928) |
| **FIX-1385** channel boards | spec → POC → **impl, merged** | The ChannelFlow floor · ER-5 · ER-3, which it may not re-decide and reads only **if** the roster has landed | A channel holding `0..N` TaskCollections; two doors, one surface. Plus the PR-5 name check over its own diff (ER-19) | The proof · FIX-1430 — **released 2026-09-19** | Large · shipped in one PR, not four |
| **FIX-1394** package cohesion | **POC matrix → ratify** → ship tickets | FIX-1377's team layer · FIX-1416's `tools:` fence — **both landed** at `d8e4c99`, and the code wins over either spec (ER-18) · D4 | One format as a Markdown file, instructions and tools, two attachment modes, **not disk-only** (ER-2); *documents in v1* still open. Its POC also carries the evidence for **one** of FIX-1408's walls (ER-15) | Ship tickets, once the ratify completes (ER-8) — **not** the proof | Large |
| **FIX-1430** manager-queue lab · *the proof* | spec → **impl, merged** — but the goal check is **NOT RUN** | ER-1 · **ER-2 as a fence, not an input** · ER-4 · ER-5 — consumes four, owns none | A coordinator seat assigning over a channel board to linked seats, queue columns as views. Plus the drain-width comparison ER-15 called for ([width 1](DECISIONS.md#drain-width)) | The epic's wrap, **once ER-20 runs** — merging did not release it | Medium · [#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929) merged |

**Size is a read, not an estimate.** Three of the five are exploration tickets whose own scope is
the thing being explored — FIX-1394 most of all, whose ship tickets are not in this set yet.

## Where it is

Status lives in one place: [the set table](SPEC.md#the-set--as-of-2026-09-19). The lanes above are
the same state as a picture of time, and Linear mirrors both ([ER-16](BUSINESS-RULES.md)).

**Both W3 inputs have landed** — FIX-1377 and FIX-1416, merged 2026-09-19
([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911),
[#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909)), on main at `d8e4c99`. Write
against **that code** and name the commit ([ER-18](BUSINESS-RULES.md)). They stay dashed edges in
the graph because they do not block, not because the code is missing.

## What unblocks what, from here

1. **The objective is approved** — 2026-09-19. Nothing waited on anything else to *start*.
2. **FIX-1405's reader contract is approved** → FIX-817 may specify against it (ER-23). Leaving the
   set did not change this edge.
3. **Nothing inside the set sequences a *start*.** In particular there is **no inventory → boards
   edge**: FIX-1385 reads the declared roster only *if it has landed*, and its BR-7 carries the
   caller's `assignee` verbatim rather than resolving a seat ([ER-5](BUSINESS-RULES.md)).
4. **FIX-1385's implementation landed** ([#1922](https://github.com/fixpoint-labs/flow-state-dev/pull/1922))
   → the proof's build ran, and has since merged too. The set's only true blocking edge is
   discharged, and **four of the five children are on `main`**.
5. **ER-20 runs on the real path** → the epic can wrap. Nothing is in front of it but this, and it
   is blocked on an **environment**, not on work: every line of code it needs is merged, and
   [the gate has not run](SPEC.md#er-20-has-not-run).
6. **W3's last implementing child merges** → the ship fence lifts (ER-14). That is **FIX-1435**,
   still `Todo` with no branch and no PR. Four W4 ship PRs have merged under the live fence, the
   last of them **#1928, by the owner himself** — which settles that PR without answering the rule.
   What is still fenced is **FIX-1394's eventual ship PR** and the [wrap](#wrap). Whether the rule
   narrows is [a re-gate with the owner](DECISIONS.md#er-14-re-gate), not an epic call; how the
   epic behaves until he answers is [an operating default](DECISIONS.md#fence-default).
7. **FIX-1394's ratify completes** → ship tickets are cut (ER-8). Half is answered; *documents in
   v1* is the rest. Those tickets are new children and will need this path redrawn. It does **not**
   unblock the proof ([the spec](SPEC.md#what-the-proof-consumes)).

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The inventory surface | FIX-1405 and FIX-817 *(related, not a child)* | 1405 owns both layers; 817 reads them, and specs only after 1405's reader contract is approved (ER-23) |
| The seat's `tools:` fence | FIX-1394 · FIX-1415, outside the set · FIX-1416, **landed** | Three edits on one fence, in that order (ER-23). None widens past seat `tools:`, and FIX-1416's merged code is the fence's actual shape, not its spec |
| The seat's prompt compose | FIX-1394 and FIX-1377 | Composes framework default → team → seat. No fourth layer; the team's text does not merge into the seat's |
| The board's claim / assign surface | FIX-1385 (**merged**) and FIX-1430 (**#1929, merged**) | 1385 owned it and shipped it; the lab consumes what landed. Two of 1385's rules about that surface were read back by the lab and [corrected](DECISIONS.md#refuted-mechanisms) rather than worked around. What 1385 did **not** settle is named in [DECISIONS](DECISIONS.md#the-cross-flow-board-residue) and has no owner |
| The same surface, again | FIX-1385 and FIX-1415 *(related, not a child)* | 1415's invite verbs land on the channel 1385 hangs a board on. Re-homing moved the wrap, not the collision |
| One channel flow factory, two PRs | FIX-1385 (**merged**) and FIX-1405's **S5–S7 ([#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928), merged)** | Both edit `defineChannelFlow` and the binder. **Closed:** FIX-1385 shipped whole first and #1928 landed on top of it rather than racing it, its own deviations noting where the landed code won. Board *declaration* stays built-in-kind-only; channel *inventory* is every kind's |
| The Workforce docs section | FIX-1385, FIX-1405, FIX-1430 | All three teach boards. Whichever lands second links rather than repeats |

## Not children, deliberately

**Re-homed at the objective gate** ([D6](DECISIONS.md#d6)), FIX-1405 dependency preserved and still
bound by ER-3 and ER-23: [FIX-817](https://linear.app/fixpoint-labs/issue/FIX-817) (catalog
manifests) and [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415) (channel-admin verbs).
Neither holds this epic's wrap; both remain filed.

Soft-after for ship, never re-parented: [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)
(**W3**, D2). Parked: [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) (**Collab RC**).
Shipped and not reopened inside W4: [FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359)
(OOTB agent kind), [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) (nested-session
removal — cited as a fence, never a ship child). Consumed, not owned: FIX-1388, FIX-1393, FIX-1426,
FIX-1410, FIX-1373, FIX-957.

## Wrap

When **[ER-20](BUSINESS-RULES.md) holds** and every remaining child is terminal.

<a name="terminal"></a>
**Terminal is read from GitHub, not from Linear.** A child is terminal when its **implementation PR
is merged or closed**, or when this epic-spec records its work as **done by decision rather than as
code** — which is FIX-1408, and the set table is where that is recorded. Linear is the mirror; a
merge is what makes code shipped. **Four children are terminal: FIX-1408 by decision, FIX-1385,
FIX-1405 and FIX-1430 by merge.** Only FIX-1394 is not — its ratify is half answered.

**ER-20 has not run, so the wrap has not opened.** #1929 merged, which made FIX-1430 terminal and
left the gate exactly as unrun as before — [the row reads `NOT RUN`](SPEC.md#er-20-has-not-run) and
the term is enforced against the rule as written. **Terminal children are not a met gate**, and
this set is now the clearest possible case of the difference: everything the epic builds is on
`main`, and nobody has watched it work. The last step before the wrap is somebody running that
check with a model credential and the verdict log saying PASS.

**Which children count is the other open part.** Linear lists [six](SPEC.md#the-sixth-child) against
D6's ratified five, and this term reads *every remaining child*. Until FIX-1451 is confirmed in or
re-homed out, the wrap has a sixth, `Backlog`-state input that nothing here sequences.

**Three things must be named out at the wrap, not confirmed.** None has an owner inside W4, and each
would otherwise close as a pass nobody ran:

- **ER-19's repo-wide PR-5 rename.** What FIX-1385 owed was a check **over its own diff**; the
  repo-wide pass is the project's and waits on its vocabulary lock ([ER-19](BUSINESS-RULES.md)).
- **How a sub-agent's background work surfaces on a board row.** Orphaned when FIX-1385 closed
  without building a coordinator assign; [unowned](DECISIONS.md#open), and nothing left in the set
  will force it.
- **A board id no channel minted.** Not refused — it silently resolves a second, empty ledger
  ([the residue](DECISIONS.md#the-cross-flow-board-residue)). No owner, no filed ticket.

Then: run the lessons pass over the set's review rounds, and dispatch the docs polish over the
Workforce pages the children each edited in isolation. It owes the sentence nobody else will write —
a board **assignee** and a Workforce **seat** are two different things that map by composition
(ER-5, [ER-22](BUSINESS-RULES.md)). Refresh the set table and the path one last time, and close the
epic PR unmerged.
