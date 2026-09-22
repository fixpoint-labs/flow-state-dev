# FIX-1500 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three retained predecessors, and this issue amends a part of each rather than replacing any. None
is superseded: all three shipped contracts this design composes.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **FIX-1477 D4** — a hired roster and a channel board are ordinary in-organization data, so the panels read them directly; the axis is the resource's **scope**, and a user-scoped collection does not qualify. Source [`../FIX-1477/DECISIONS.md#d4`](../FIX-1477/DECISIONS.md#d4) | **Retained and extended** to three further collections | The rule is the product owner's and is stated in terms of `scope`, not of which collection. All three inventory collections declare `scope: "org"`, so they qualify on the rule as written — no new argument is needed, and none is made. The `expose`-not-bare corollary travels with it | [D3](DECISIONS.md#d3) | Additive. Nothing that reads these collections today changes; three more become listable by a browser, each behind an allow-list |
| **FIX-1477 `PLAN.md` → Blocked on** — the shell's session cannot be bound to a viewer's organization, so in a deployment configuring operator tokens the panels render **correct and empty**; the binding belongs to FIX-1503. Source [`../FIX-1477/PLAN.md#blocked-on`](../FIX-1477/PLAN.md#blocked-on) | **Amended in its consequence, not in its cause** | The cause is unchanged and re-verified against the current tree: there is still no viewer credential, and a session still binds to `ctx.principal?.orgId ?? DEFAULT_ORG_ID` (`packages/engine/src/routes/session-routes.ts:285`, a line that has moved since FIX-1477 cited it). What changes is what that costs: because this issue's hire resolves the organization by the same path as its reads, the two can no longer disagree, so the failure mode stops being *empty with no reason* and becomes *a different organization, named* | [D1](DECISIONS.md#d1), [PLAN.md → Blocked on](PLAN.md#blocked-on), BR-4 | The limit narrows; nothing that relied on the old behaviour breaks. FIX-1503 still removes it entirely |
| **FIX-1475** — a runtime hire is stored in the hired-roster collection and read back at the next boot; the door in front of it is the **app's** to write and guard, and `workforce-admin` is a worked example rather than something the framework ships (`apps/docs/docs/workforce/durable-hire.md`) | **Retained; its sequence gains one home** | The contract is untouched — same collection, same `create()`-as-duplicate-refusal, same compensating delete, same registration order. What this issue changes is that the *sequence* stops living inside one app flow's handler, so a second door composes it instead of copying it. That it is at exactly one site today, and therefore that this is a move rather than a reconciliation of drifted copies, was verified by execution ([`poc/evidence/`](poc/evidence/README.md) → C2) | [D1](DECISIONS.md#d1)'s *What this is not*, PLAN S1 | The operator flow keeps its behaviour, its credential and its fail-closed registration; its existing suite is the fence that proves so (PLAN V1) |

<a name="v15"></a>
## What this spec dropped in review

**V15 — the authoring-time evidence checker as a standing CI check.** The first draft's plan
required [`poc/evidence/check.mjs`](poc/evidence/README.md) to stay green after S2 and S3, which
made a spec directory the home of live CI machinery. It was dropped on **BP-037**: a spec
directory is retained *design history*, and a check parked in one becomes something every future
`packages/workforce` contributor maintains from a folder they have no reason to open. It also
contradicted the checker's own stated status.

Two things about the drop are worth keeping, because both were argued and one was argued wrongly:

- **The runtime content was never lost.** V4 (the `expose` allowlist, asserted on the absence of
  withheld fields) and V5 (the 403 with the declaration removed) cover what V15 asserted about
  behaviour.
- **The replacement proposed in review does not work, and the follow-up says why.** A `workforce`
  test asserting that the three inventory collections declare `client.state.read` + `expose` would
  cover only the three collections it already names — which is precisely the failure C1 exists to
  catch. These collections are built inside factory functions and are not module-level values, so
  a standing totality assertion has to enumerate from **source**. That is why the follow-up is
  specified that way rather than as "add a test".

C1, C2 and C3 remain in the checker as authoring evidence. They carry no maintenance burden
precisely because nothing requires them to stay green.

<a name="unchecked-falsifiability"></a>
## A defect class this epic has now produced twice

**A falsifiability claim that was itself never checked.** Both instances were found in review, not
by the mechanism each was supposed to be.

| Instance | The claim | What was true |
|---|---|---|
| FIX-1477's corpus checker | A planted file would be rejected | A subtree rule absorbed it, so the assertion silently passed the exact case it existed to catch — *inside* the assertion |
| This spec's `poc/evidence/check.mjs` | "Each assertion has a negative control that must be seen to fail (`--plant`)" | Only **C1** had one. `--plant` plants a collection and its failure message names C1 alone; C2 and C3 had no red path at all |

The second is the sharper one, and it is why this is recorded as a named class rather than as a
line in a review log: it appeared **in the artifact whose entire purpose was to stop hand-derived
claims from going unchecked**. Building a checker does not exempt the checker's own claims from
tenet 7. The header now states per-check which is falsifiable and which is not, rather than
carrying one sentence over all three.

The corollary that cost a round on its own: **C2's predicate was aimed at a neighbour of its
claim** — any `.create(` in a file that also mentioned `registerFromRoster`, which established
neither that the create was the roster's nor that the two sat in one sequence, and passed only
because exactly one file happened to match. Tightened, and the written claim narrowed to what a
proximity check can support.

<a name="br35-conflict"></a>
## A conflict with an approved spec — raised, not settled

**This is not a fork for this spec to decide.** [FIX-1475](https://linear.app/fixpoint-labs/issue/FIX-1475)
is merged and approved, and one of its rules forbids something a draft of this spec proposed. Per
BP-002, a surface a merged spec already decided is raised for re-gating rather than quietly
reversed or worked around.

**What FIX-1475 decided.** BR-35: *"A seat is hired at runtime → it gets **no live-inventory
row**. The roster (`workforce/roster/*`) and the inventory (`inventory/seats/*`) are two
contracts: the inventory never deletes a row, a roster must."* Its plan gives the reasoning in
order of weight — the two contracts disagree by design, so writing both makes a fire remove one
and leave the other, and *"a reader could not tell which answer was current"*.

**What this spec's draft proposed.** S4: a seat hired at runtime also gets an inventory row, so
that its detail pane opens like a file-declared seat's. That is BR-35's exact prohibition.

**Why it is worse now than when FIX-1475 wrote it.** BR-35 was a parity and tidiness argument
against an inventory nobody could read. [D3](DECISIONS.md#d3) makes the inventory
**browser-readable**, so a stale row is no longer an internal inconsistency — it is a **fired
seat still advertised to a person as live**. The fire path removes the roster row and the
registrar address and nothing else.

**Candidate resolutions, none chosen here:**

| | Shape | What it would need |
|---|---|---|
| 1 | Amend FIX-1475's BR-35 to permit the dual write **and add a deletion rule**, so fire removes both | Re-gating BR-35 with its owner. The inventory's *"nothing is ever deleted"* header becomes conditional, which is a contract change reaching every inventory reader, not just this app |
| 2 | Hired seats keep getting no inventory row; the seat detail reads the roster **and** the inventory as two sources | No change to BR-35. But two sources joined for one list is close to the *"client-side joins that become a second runtime inventory"* invent-kill unless the join is server-side |
| 3 | Neither collection carries the browse answer; a separate read model does ([Open 1](DECISIONS.md#open), candidate B) | Dissolves the clash rather than resolving it, and carries Open 1's own question about whether that read model is a second inventory |

Resolution 3 would make this conflict moot, so **Open 1 should be answered before this is
re-gated** — they are one decision viewed from two sides, not two independent ones.

**Not superseded, and not a lineage claim:**
[FIX-1476](https://linear.app/fixpoint-labs/issue/FIX-1476)'s channel-kind and `CHANNEL.md`
contract, [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)'s inventory and
[FIX-1367](https://linear.app/fixpoint-labs/issue/FIX-1367)'s `WorkerConfig` admission are
**dependencies this design consumes as they are**. A dependency is not a predecessor, and none of
them is amended here — FIX-1405's row schema gains a field, which is an extension of its contract
under its own BP-030 rule rather than a change to its intent.

Before implementation, compare these intents against current code and
`docs/architecture/*`: approved intent alone does not establish shipped behaviour.
