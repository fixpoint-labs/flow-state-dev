# FIX-1457 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

This set was recut twice on 2026-09-20 and the second recut changed the epic's identity, not just
its membership. What it replaced is recorded here so a child following an old link, an old rule
number or an old fence lands on what replaced it rather than on a decision nobody holds.

**None of the predecessors below has a retained artifact under `specs/`.** Three are this set's own
earlier revisions, which lived at `spec/_epics/living-workforce/` on the never-merged branch before
the retention policy changed; the rest predate retention entirely. Each is cited through its real
commit, PR or Linear provenance rather than through a local path that does not exist
([retention policy](../../../docs/contributing/orchestration.md#spec-retention-and-authority)).

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **ER-19, the done condition as three *surfaces*:** *"Workforce can be seen working, on three artifacts… (a) the reference app — someone clones the kitchen-sink… (b) the live view… (c) the real configuration"* — source this set's own `BUSINESS-RULES.md` as it stood at [bf140ca](https://github.com/fixpoint-labs/flow-state-dev/commit/bf140caab), ER-19, on [PR #1944](https://github.com/fixpoint-labs/flow-state-dev/pull/1944) | **Superseded** | Leg (a) *was* the kitchen-sink, which left the set the same day ([D9](DECISIONS.md#d9)), and legs (b) and (c) already had no owner — the rule's own *proved by* cell said so. A done condition naming an artifact that belongs to another epic cannot be checked here. Owner recalibration, 2026-09-20 18:05:22Z, in FIX-1457's Linear body; summarised in PR comment `5751623639` | **[ER-Devtool](BUSINESS-RULES.md#er-devtool), [ER-DevForce](BUSINESS-RULES.md#er-devforce), [ER-Collab](BUSINESS-RULES.md#er-collab)**, with [D6](DECISIONS.md#d6) rewritten around them | **ER-19 is retired with a forward pointer, not deleted** — a child following an old link reads the three rules that replaced it. No work was in flight against any of its three legs, so nothing had to be re-scoped |
| **The standing invent-kill against DevForce:** *"don't treat W5 as build DevForce"* — source FIX-1457's Linear description **before** the 18:05Z rewrite, section *FSD Architect — EM fences (2026-09-19)* | **Superseded** | The fence conflated *a Lab as product* with *a Lab as evidence*, and the north star asks for the second in so many words: a finish-line Lab that *"can actually build something."* The owner reversed it explicitly — *"Proof-via-DevForce is **in**. Old invent-kill… is **dead**"* — and set the replacement bound in the same sentence | **[D8](DECISIONS.md#d8)** and **[ER-11](BUSINESS-RULES.md) re-narrowed**: the thinnest DevForce path that produces a real artifact is in, and stops there | **A reversal, not a widening.** Unbounded Lab product delivery stays out, *"rebuild the whole Lab product"* stays out, and CyberForce stays out this cycle. Nothing had been built against the old fence, so there is no migration |
| **W5's parenthood of the kitchen-sink rebuild:** ER-15 as originally written — FIX-1455 *"runs its own lifecycle **as a member of this set**"* — source this set's own `BUSINESS-RULES.md` at [1d9218e](https://github.com/fixpoint-labs/flow-state-dev/commit/1d9218e87), ER-15 | **Superseded** | A reference app someone clones is a **product surface**; the exit proofs are **QA**. Different owners, different gates, different finish lines, and running one inside the other is what made W5 read as a kitchen-sink epic twice. FIX-1455 has no parent in Linear and runs its own epic lifecycle on [PR #1978](https://github.com/fixpoint-labs/flow-state-dev/pull/1978), which records the same separation from the other side | **[D9](DECISIONS.md#d9)**; [ER-15](BUSINESS-RULES.md#er-15) rewritten, [ER-24](BUSINESS-RULES.md) added, and **[ER-1](BUSINESS-RULES.md), [ER-2](BUSINESS-RULES.md) and [ER-3](BUSINESS-RULES.md) re-owned** rather than left pointing at a row that had gone | **The two epics read the ship fence differently and both are right.** [D4](DECISIONS.md#d4) records it as *standing* here because [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) is In Review; FIX-1455's own D1 lifts it for that set on the same facts. A child reads **its own** epic's card. [ER-24](BUSINESS-RULES.md) forbids re-parenting kitchen-sink under W5 |
| **D4's fence recorded as *lifted*:** *"[D4](DECISIONS.md#d4)'s fence has lifted"* — source this set's own `DECISIONS.md` at [bf140ca](https://github.com/fixpoint-labs/flow-state-dev/commit/bf140caab), the D4 card and its summary line | **Corrected** — a factual correction, not a change of direction | W4's first-cut *issues* are Done, but the epic [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) is **In Review**, not closed, and the recalibration restates the fence as standing in the owner's own words: *"do not start W5 ship while W4 first-cut is open,"* *"polish may start now"* | **[D4](DECISIONS.md#d4)** restated, carrying [ER-10](BUSINESS-RULES.md) | **Only ship tickets are fenced; polish was never fenced and still is not.** No ticket had been opened under the lifted reading, so the correction cost nothing |
| **ER-18 as a standing downstream-blocking clause**, added in review round 1: an exploration may not exit with either blocking wall open — source this set's own `BUSINESS-RULES.md` at [f65c529](https://github.com/fixpoint-labs/flow-state-dev/commit/f65c52991), ER-18 | **Retained, and recorded as met** | [FIX-1467](https://linear.app/fixpoint-labs/issue/FIX-1467) merged 2026-09-20 answering both walls: the noun is **`references/`**, the migration is **`clearShadowedReferences` / `describeShadowedReferences`**, and the grant model is settled — ambient and read-only down the org → team → worker tree, with `resources:` still the explicit grant for mutable state. Published in [`documents-on-disk.md`](../../../apps/docs/docs/workforce/documents-on-disk.md) | **[ER-18](BUSINESS-RULES.md#er-18)**, marked MET with what met it | **The rule is not removed.** A satisfied fence left reading as open fences its dependants onto nothing, which is the same defect as an unsatisfied one nobody noticed. Checklist row 6 now has a real distinction to render |

## Predecessors this set consumes without superseding

- **The W3 floor** ([FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)) and **the W4 first
  cut** ([FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407)) — boards
  ([FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385)), inventory
  ([FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)), dispatch policy
  ([FIX-1408](https://linear.app/fixpoint-labs/issue/FIX-1408)), the manager queue
  ([FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430)), dispatch honesty
  ([FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440)) and org identity
  ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442)). **Composed, never re-decided**
  ([D1](DECISIONS.md#d1), [ER-4](BUSINESS-RULES.md)). **A dependency is not supersession**: nothing
  here amends any of them, and a proof that needs one changed has found a gap in W3 or W4 and
  comments up ([ER-17](BUSINESS-RULES.md#er-17), [ER-25](BUSINESS-RULES.md)).
- **FIX-1467's shipped `references/` split.** Consumed by checklist row 6 and by every child that
  grants a seat documents. Settled, not reopened.
- **[FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320)'s Devtool instance and session
  surfaces.** Checklist rows 1–3 **ride** them; this set neither owns nor amends them, and
  [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) was deliberately cut to the three rows
  that do not.

## The canceled child, and what outlived it

**[FIX-1458](https://linear.app/fixpoint-labs/issue/FIX-1458)** (humans-in-seats) was canceled on
2026-09-20 and [#1955](https://github.com/fixpoint-labs/flow-state-dev/pull/1955) closed unmerged.
It is **not** a superseded predecessor — it decided nothing this set reversed — but two things
outlived it deliberately and are recorded so they are not read as dead with it:

- **Its invent-kills survive as [D2](DECISIONS.md#d2)**: humans are not board drainers, there is no
  parallel HITL plane, and `assignee` never equals a person.
- **Its POC's finding survives**: a session belongs to one user, so a board a person answers into
  cannot be session-scoped to the seat's session — the ledger is org-scoped. True at one principal
  as well as many, and it lands directly on checklist rows 3 and 5, which are session-scoped today.

What *was* dropped with it is parked with a revisit condition in
[Grow into later](DECISIONS.md#later), not left open.

---

Re-check every cited intention against current code and the architecture docs before implementing.
`docs/architecture/*` and the published pages are the authority for how the system behaves now; the
rows above record what was **decided**, not what ships.
