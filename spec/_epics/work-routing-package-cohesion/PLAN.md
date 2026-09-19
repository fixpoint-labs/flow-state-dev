# FIX-1407 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails — not how to build any piece,
which is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: a ship-fence band, two W3 input lanes, the seven lanes of the set against time with a now line at September 19, and two related lanes under a divider. The figure's aria-label carries every lane and bar.](figures/path.svg)

Eleven lanes: two W3 inputs, the **seven** children of the set, and — under the divider — the two
[related issues](SPEC.md#related-not-children) that still consume FIX-1405. Four lanes are merged;
FIX-1394 sits at its **recorded** ratify, and the last two each open at the now line with a PR-open
bar and nothing merged behind it — **FIX-1381**, pulled in at 16:01, and
**[FIX-1451](SPEC.md#the-seventh-child)**, which was a child all along. Three lanes with nothing
merged is what the wrap's tail looks like.

**The critical path ran boards → the proof, and all of it is behind us.** FIX-1385 merged on
2026-09-19 and FIX-1430's build followed it onto `main` the same day
([#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929)). **The gate has since been met**:
[ER-20 passed](SPEC.md#er-20-passed) on 2026-09-19, three runs on the model path with both controls
red, once the project was pointed at an environment that could reach a model. The proof's lane ends
in a passed gate rather than an unrun one. **Behind the gate, the wrap has a tail of two:**
FIX-1381's spec and FIX-1451's fix. Neither is on the critical path — they came *after* it — but
both are terms of the wrap.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1408** dispatch policy | design → **closed as decided** | D4's two leans | Sub-agent vs seat-assign, `parentSessionId` at mint, opt-in history, the brief | Every other child | — |
| **FIX-1405** runtime inventory | spec → POC → **impl, merged** | The three existing readers · hire · `channelInstances` · open sessions (D5) | Two layers: a declared roster composed at read time (replacing both labs' private `LabRoster`), and the live org resource | FIX-817, on its approved reader contract (ER-23) · FIX-1415 · `team.*` wildcards, later. **Not FIX-1385** | Medium · all three PRs on `main` — PR-A [#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920), S4 [#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923), S5–S7 [#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928) |
| **FIX-1385** channel boards | spec → POC → **impl, merged** | The ChannelFlow floor · ER-5 · ER-3, which it may not re-decide and reads only **if** the roster has landed | A channel holding `0..N` TaskCollections; two doors, one surface. Plus the PR-5 name check over its own diff (ER-19) | The proof · FIX-1430 — **released 2026-09-19** | Large · shipped in one PR, not four |
| **FIX-1394** package cohesion | **POC matrix → ratify, recorded** → ship tickets | FIX-1377's team layer · FIX-1416's `tools:` fence — **both landed** at `d8e4c99`, and the code wins over either spec (ER-18) · D4 | One format as a Markdown file, instructions and tools, two attachment modes, **not disk-only**, **documents org-scoped** (ER-2). Its POC also carries the evidence for **one** of FIX-1408's walls (ER-15) | Ship tickets, once the ratify completes (ER-8) — **not** the proof | Large |
| **FIX-1381** seat resource allowlist | spec → impl · **spec PR [#1935](https://github.com/fixpoint-labs/flow-state-dev/pull/1935) open**, in review, gate unanswered | **D-11's settled direction** (FIX-1380, Done): Ask 1 the thin allowlist, Ask 3 org `ro` automatic / `rw` by permission · today's `resourcesFromDocs` org hard-code and the `WorkerConfig` gap its invent-kill names | Thin seat/kind resource refs by `ro`/`rw` — the first control over which resources a worker or skill reaches | **The wrap** — it is now a term of it | Not sized · direction settled, spec in review |
| **FIX-1451** allowed-tools honesty · *a bug* | **no spec** → impl · fix PR [#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936) open on `fix/FIX-1451-allowed-tools-honesty` | FIX-1416's landed `tools:` fence at `d8e4c99` — the promise the bug is about (ER-18) | A seat's skill no longer promising a tool grant the loader does not make | **The wrap** — a term of it like any child. Explicitly **not** a ship-gate on FIX-1394 | Not sized · a bug, scoped by its PR rather than a spec |
| **FIX-1430** manager-queue lab · *the proof* | spec → **impl, merged** → **goal check PASS**, three runs | ER-1 · **ER-2 as a fence, not an input** · ER-4 · ER-5 — consumes four, owns none | A coordinator seat assigning over a channel board to linked seats, queue columns as views. Plus the drain-width comparison ER-15 called for ([width 1](DECISIONS.md#drain-width)) | The epic's wrap, **once ER-20 runs** — merging did not release it | Medium · [#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929) merged |

**Size is a read, not an estimate.** Three of the original five are exploration tickets whose own
scope is the thing being explored — FIX-1394 most of all, whose ship tickets are not in this set
yet. **The two newest children are deliberately unsized, for opposite reasons:** FIX-1381's
direction is settled by D-11 but its spec is still in review, and a number before that spec is
approved would be a guess wearing an estimate's clothes; FIX-1451 is a bug and will never have a
spec, so its scope is whatever its PR turns out to be.

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
   discharged, and **four of the seven children are on `main`**.
5. **ER-20 ran on the real path and passed** → the epic's *claim* is proved, 2026-09-19. It was
   blocked on an **environment** rather than on work, and that blocker is gone — the project was
   pointed at the FSD environment and a thread ran the gate there, three consecutive passes with
   both controls red ([the run](SPEC.md#er-20-passed)). It was the one term nobody could work
   around; **[two open children](#wrap) are the rest of the wrap**, and those are work.
6. **W3's last implementing child merges** → the ship fence lifts (ER-14). That is **FIX-1435**,
   still `Todo` with no branch and no PR. Four W4 ship PRs have merged under the live fence, the
   last of them **#1928, by the owner himself** — which settles that PR without answering the rule.
   What is still fenced is **FIX-1394's eventual ship PR**, **FIX-1381's eventual implementation**,
   **FIX-1451's fix if it ships a package** (that changeset call has not been made) and the
   [wrap](#wrap) — the fence's bite **grew** when the set did. Whether the rule
   narrows is [a re-gate with the owner](DECISIONS.md#er-14-re-gate), not an epic call; how the
   epic behaves until he answers is [an operating default](DECISIONS.md#fence-default).
7. **FIX-1394's ratify completes** → ship tickets are cut (ER-8). **Both forks are now answered** —
   [authorship](DECISIONS.md#authorship-answer), and [documents as
   org-scoped](DECISIONS.md#documents-answer) — so nothing external holds it. Those tickets are new
   children and will need this path redrawn. It does **not** unblock the proof ([the spec](SPEC.md#what-the-proof-consumes)).
8. **FIX-1381's spec lands, then its implementation** → one of the three remaining wrap terms
   clears. It starts with its direction already decided by D-11 (FIX-1380, Done), so the spec is
   describing a settled shape rather than choosing one. Its implementation will be a **ship PR** and
   therefore sits under [ER-14](BUSINESS-RULES.md).
9. **FIX-1451's fix merges** → the last of the three clears. **No spec gate on this one** — it is a
   `Bug`, so its PR is the review surface ([ER-17](BUSINESS-RULES.md)) and it goes straight to
   implementation on `fix/FIX-1451-allowed-tools-honesty`. It is fenced by ER-14 only **if** it
   ships a package; that call has not been made.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The inventory surface | FIX-1405 and FIX-817 *(related, not a child)* | 1405 owns both layers; 817 reads them, and specs only after 1405's reader contract is approved (ER-23) |
| The seat's `tools:` fence | FIX-1394 · FIX-1415, outside the set · FIX-1416, **landed** | Three edits on one fence, in that order (ER-23). None widens past seat `tools:`, and FIX-1416's merged code is the fence's actual shape, not its spec |
| The skill's tool promise | **FIX-1451** and FIX-1394 · FIX-1416, **landed** | The bug is that a skill's `allowed-tools` promises a grant the loader does not make, on the same surface FIX-1394's format scopes to *instructions and tools*. **Explicitly not a ship-gate on FIX-1394** — the owner filed it as a soft encounter, so 1394's ratify never waits on it. Both write against FIX-1416's merged fence at `d8e4c99`, not its spec (ER-18) |
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

**Re-homed 2026-09-19:** [FIX-1459](https://linear.app/fixpoint-labs/issue/FIX-1459), the ship
ticket for the ratified package format, for the same reason — the build is downstream of W4's
objective, not inside it ([the spec](SPEC.md#related-not-children)). ER-8's hold is discharged by
it being cut; ER-14 fences it when it starts.

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

When **[ER-20](BUSINESS-RULES.md) holds** and every remaining child is terminal — **now seven
children, not five** ([amended](DECISIONS.md#d6-extended), then [corrected](DECISIONS.md#d6-seventh)).

<a name="terminal"></a>
**Terminal is read from GitHub, not from Linear.** A child is terminal when its **implementation PR
is merged or closed**, or when this epic-spec records its work as **done by decision rather than as
code** — which is FIX-1408, and the set table is where that is recorded. Linear is the mirror; a
merge is what makes code shipped. **Five children are terminal: FIX-1408 and FIX-1394 by
decision, FIX-1385, FIX-1405 and FIX-1430 by merge.** FIX-1394 counts here because its deliverable
was the ratify and the ratify is recorded — its matrix PR never merges and its build left the set as
[FIX-1459](SPEC.md#related-not-children). Two are not terminal: **FIX-1381, whose spec PR
[#1935](https://github.com/fixpoint-labs/flow-state-dev/pull/1935) is open and unapproved**, and
**FIX-1451, whose fix PR
[#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936) is open and unmerged**. Note
that FIX-1451 needs no spec to become terminal — a bug's route runs straight to its implementation PR
([ER-17](BUSINESS-RULES.md)) — so a missing spec there is not a missing step.

**ER-20 ran and passed, so the gate is met.** [The row reads PASS](SPEC.md#er-20-passed) — three
consecutive runs of
`goals/manager-queue-lab/it-routes-a-queue-to-the-seats-their-files-name` at `GOAL_FILER=model` on
`vercel/openai/gpt-5.4-mini`, against `e6ccb22` of `main`, with both negative controls red at their
own legs on the same path. **Terminal children were never a met gate**, and for a week this set was
the clearest case of that difference: everything built was on `main` and nobody had watched it work.
Somebody has now watched it work. **One caveat on where that is written down:** the `NOT RUN` row
inside `goal.md` on `main` is still stale and needs its own PR — that is not this branch's to fix,
and until it lands, `main` does not yet say what this page says.

**And meeting the gate is no longer the same moment as wrapping.** [D6](DECISIONS.md#d6) bought
exactly that alignment at the objective gate, and the set has since grown twice — the owner
deliberately pulled **FIX-1381** in at 16:01 with the cost stated to him, and **FIX-1451** turned
out to have been a child since 12:58, which no call made and no call can undo. So the wrap needed
**ER-20 passing *and* every child terminal**. **ER-20 is now met, and the second term is not:**
FIX-1381 and FIX-1451 are both open. Only one of those two growths was a choice, and they are what
is left.

**Which children count is no longer open.** The tracker and this document agree on seven
([ER-16](BUSINESS-RULES.md)), and there is no unconfirmed remainder. That agreement was reached by
reading the tickets rather than trusting this document, which is the only reason it is worth
stating — [the epic had FIX-1451 wrong](DECISIONS.md#d6-seventh), and a wrap computed from the
wrong membership is a wrap that closes over unbuilt work.

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
