# FIX-1407 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails — not how to build any piece,
which is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: a ship-fence band, two W3 input lanes, the six lanes of the set against time with a now line at September 19, and two related lanes under a divider. The figure's aria-label carries every lane and bar.](figures/path.svg)

Ten lanes: two W3 inputs, the **six** children of the set, and — under the divider — the two
[related issues](SPEC.md#related-not-children) that still consume FIX-1405. Four lanes are merged;
FIX-1394 sits at its now-unblocked ratify, and **FIX-1381's lane opens at the now line with no bar
behind it**, which is what a child pulled in at 16:01 looks like. The lane the tracker holds and
this figure does not is [FIX-1451](SPEC.md#the-unconfirmed-child) — deliberately, until it is
confirmed a child or re-homed.

**The critical path ran boards → the proof, and all of it is behind us.** FIX-1385 merged on
2026-09-19 and FIX-1430's build followed it onto `main` the same day
([#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929)). **What stands between the epic
and its gate is not work**: it is [ER-20's own run](SPEC.md#er-20-has-not-run), which needs a model
credential this epic has never had — which is why the proof's lane ends in a gate box rather than at
its bar. **Behind the gate, the wrap now has a new tail:** FIX-1381 must also finish, and it has not
started. Package cohesion is *beside* the critical path; FIX-1381 is *after* it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1408** dispatch policy | design → **closed as decided** | D4's two leans | Sub-agent vs seat-assign, `parentSessionId` at mint, opt-in history, the brief | Every other child | — |
| **FIX-1405** runtime inventory | spec → POC → **impl, merged** | The three existing readers · hire · `channelInstances` · open sessions (D5) | Two layers: a declared roster composed at read time (replacing both labs' private `LabRoster`), and the live org resource | FIX-817, on its approved reader contract (ER-23) · FIX-1415 · `team.*` wildcards, later. **Not FIX-1385** | Medium · all three PRs on `main` — PR-A [#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920), S4 [#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923), S5–S7 [#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928) |
| **FIX-1385** channel boards | spec → POC → **impl, merged** | The ChannelFlow floor · ER-5 · ER-3, which it may not re-decide and reads only **if** the roster has landed | A channel holding `0..N` TaskCollections; two doors, one surface. Plus the PR-5 name check over its own diff (ER-19) | The proof · FIX-1430 — **released 2026-09-19** | Large · shipped in one PR, not four |
| **FIX-1394** package cohesion | **POC matrix → ratify, now unblocked** → ship tickets | FIX-1377's team layer · FIX-1416's `tools:` fence — **both landed** at `d8e4c99`, and the code wins over either spec (ER-18) · D4 | One format as a Markdown file, instructions and tools, two attachment modes, **not disk-only**, **documents org-scoped** (ER-2). Its POC also carries the evidence for **one** of FIX-1408's walls (ER-15) | Ship tickets, once the ratify completes (ER-8) — **not** the proof | Large |
| **FIX-1381** seat resource allowlist | spec → impl · **spec being written**, no PR yet | **D-11's settled direction** (FIX-1380, Done): Ask 1 the thin allowlist, Ask 3 org `ro` automatic / `rw` by permission · today's `resourcesFromDocs` org hard-code and the `WorkerConfig` gap its invent-kill names | Thin seat/kind resource refs by `ro`/`rw` — the first control over which resources a worker or skill reaches | **The wrap** — it is now a term of it | Not sized · direction settled, spec outstanding |
| **FIX-1430** manager-queue lab · *the proof* | spec → **impl, merged** — but the goal check is **NOT RUN** | ER-1 · **ER-2 as a fence, not an input** · ER-4 · ER-5 — consumes four, owns none | A coordinator seat assigning over a channel board to linked seats, queue columns as views. Plus the drain-width comparison ER-15 called for ([width 1](DECISIONS.md#drain-width)) | The epic's wrap, **once ER-20 runs** — merging did not release it | Medium · [#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929) merged |

**Size is a read, not an estimate.** Three of the original five are exploration tickets whose own
scope is the thing being explored — FIX-1394 most of all, whose ship tickets are not in this set
yet. **FIX-1381 is deliberately unsized:** its direction is settled by D-11 but its spec is being
written, and a number before the spec would be a guess wearing an estimate's clothes.

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
   discharged, and **four of the six children are on `main`**.
5. **ER-20 runs on the real path** → the epic's *claim* is proved. It is blocked on an
   **environment**, not on work: every line of code it needs is merged, and
   [the gate has not run](SPEC.md#er-20-has-not-run). It is no longer the last thing in front of
   the wrap — [FIX-1381](#wrap) is the other — but it is the only one nobody can work around.
6. **W3's last implementing child merges** → the ship fence lifts (ER-14). That is **FIX-1435**,
   still `Todo` with no branch and no PR. Four W4 ship PRs have merged under the live fence, the
   last of them **#1928, by the owner himself** — which settles that PR without answering the rule.
   What is still fenced is **FIX-1394's eventual ship PR**, **FIX-1381's eventual implementation**
   and the [wrap](#wrap) — the fence's bite **grew** when the set did. Whether the rule
   narrows is [a re-gate with the owner](DECISIONS.md#er-14-re-gate), not an epic call; how the
   epic behaves until he answers is [an operating default](DECISIONS.md#fence-default).
7. **FIX-1394's ratify completes** → ship tickets are cut (ER-8). **Both forks are now answered** —
   authorship, and [documents as org-scoped](DECISIONS.md#documents-answer) — so nothing external
   holds it. Those tickets are new children and will need this path redrawn. It does **not** unblock
   the proof ([the spec](SPEC.md#what-the-proof-consumes)).
8. **FIX-1381's spec lands, then its implementation** → the last wrap term other than ER-20 clears.
   It starts with its direction already decided by D-11 (FIX-1380, Done), so the spec is describing
   a settled shape rather than choosing one. Its implementation will be a **ship PR** and therefore
   sits under [ER-14](BUSINESS-RULES.md).

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
| What a seat's file may declare | FIX-1394 and **FIX-1381** | Both extend `WorkerConfig` — 1394 with the package format's instructions and tools, 1381 with `ro`/`rw` resource refs. Neither widens into the other's half, and the seat `tools:` fence stays ER-23's. **Confirm this seam once FIX-1381's spec exists**; it is named now because the collision is foreseeable, not because it has been checked |

## Not children, deliberately

**Re-homed at the objective gate** ([D6](DECISIONS.md#d6)), FIX-1405 dependency preserved and still
bound by ER-3 and ER-23: [FIX-817](https://linear.app/fixpoint-labs/issue/FIX-817) (catalog
manifests) and [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415) (channel-admin verbs).
Neither holds this epic's wrap; both remain filed.

**Related to FIX-1381, and not absorbed by it:**
[FIX-1454](https://linear.app/fixpoint-labs/issue/FIX-1454) is the scope-*existence* half — that a
resource cannot be scoped to a single seat at all — which is a different question from which
resources a seat may reach. [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442), the
org-identity security pass, is adjacent. Neither is a child.

Soft-after for ship, never re-parented: [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)
(**W3**, D2). Parked: [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) (**Collab RC**).
Shipped and not reopened inside W4: [FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359)
(OOTB agent kind), [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) (nested-session
removal — cited as a fence, never a ship child). Consumed, not owned: FIX-1388, FIX-1393, FIX-1426,
FIX-1410, FIX-1373, FIX-957.

## Wrap

When **[ER-20](BUSINESS-RULES.md) holds** and every remaining child is terminal — **now six
children, not five** ([D6 as amended](DECISIONS.md#d6-extended)).

<a name="terminal"></a>
**Terminal is read from GitHub, not from Linear.** A child is terminal when its **implementation PR
is merged or closed**, or when this epic-spec records its work as **done by decision rather than as
code** — which is FIX-1408, and the set table is where that is recorded. Linear is the mirror; a
merge is what makes code shipped. **Four children are terminal: FIX-1408 by decision, FIX-1385,
FIX-1405 and FIX-1430 by merge.** Two are not: FIX-1394, at its now-unblocked ratify, and
**FIX-1381, which has no spec yet**.

**ER-20 has not run, so the gate has not been met.** #1929 merged, which made FIX-1430 terminal and
left the gate exactly as unrun as before — [the row reads `NOT RUN`](SPEC.md#er-20-has-not-run) and
the term is enforced against the rule as written. **Terminal children are not a met gate**, and
this set is the clearest possible case of the difference: everything the first cut builds is on
`main`, and nobody has watched it work. Somebody running that check with a model credential, and
the verdict log saying PASS, is what meets the gate.

**And meeting the gate is no longer the same moment as wrapping.** [D6](DECISIONS.md#d6-extended)
bought exactly that alignment at the objective gate, and the owner deliberately spent part of it on
2026-09-19 by pulling **FIX-1381** into the set — a child with no spec and no implementation. So the
wrap now needs **ER-20 passing *and* FIX-1381 terminal**, and the second of those has not started.
**This was not a side effect:** the consequence was stated before the call, and the call was his.

**Which children count is still partly open.** The tracker holds a **seventh**,
[FIX-1451](SPEC.md#the-unconfirmed-child), parented but never confirmed, and this term reads *every
remaining child*. Until it is confirmed in or re-homed out, the wrap has an input nothing here
sequences — and confirming it would extend the tail a second time.

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
