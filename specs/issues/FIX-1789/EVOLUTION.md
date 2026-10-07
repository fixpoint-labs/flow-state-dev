# FIX-1789 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three earlier designs this issue builds on. None is superseded whole. Epic-wide lineage, including
the six-key contract's move to stored data, is in [the epic's record](../../epics/FIX-1786/EVOLUTION.md).

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Admission is what the schema accepts, not which function built it; no marker, one enforcement point. FIX-1367, retained only in code: the header of `packages/workforce/src/worker-config.ts` | **Retained**: the list was chosen, and adds no mark | The POC's H1: the list registers a hand-built flow that meets the contract, the wrapper refuses it | [Q1](DECISIONS.md#q1) | Every flow hireable today that meets the three checks stays hireable |
| Admission has exactly one gate, `hireWorkforce`; a missing kind is refused by name; a replacement `agent` must declare its kind. [`docs/architecture/workforce-default-worker-kind.md` → C2](../../../docs/architecture/workforce-default-worker-kind.md#c2--admission-has-exactly-one-gate) | **Amended**: the gate gains the contract's three checks, run once per flow at registration, and standard-only after the `agent` default | The epic's ER-2 | BR-1 to BR-16 | C2's refusals and wording unchanged. Its option `kinds` is renamed `workerFlows` (S2). C3's drawer, one per hired worker, moves off org scope (S6), re-seeded from configuration |
| One door per kind; two is a hire problem; none means the composers say so. [`../FIX-1690/DECISIONS.md`](../FIX-1690/DECISIONS.md), D1 | **Amended** for worker flows: none or two is refused at registration | The epic's ER-2 makes the door part of the contract; the concept's reason is that an app talks to any worker without knowing its flow | BR-3, BR-4 | A doorless worker flow stops hiring. DevForce's scripted EM is the one found; PLAN → *At implement time* |

The epic's [EVOLUTION](../../epics/FIX-1786/EVOLUTION.md) already records the mailbox boards' org
ledgers as superseded by FIX-1792; this issue leaves them as they are, since nothing at org scope is
refused ([Q2](DECISIONS.md#q2)). Compare each prior intent with current code before implementing:
approved intent is not shipped behaviour.

Amended after merge (FIX-1802's spec PR #2839): [FIX-1802's D1](../FIX-1802/DECISIONS.md#d1)
makes `delegates:` the key that decides whether any worker files, so `workerConfigSchema()`
defines `delegates`, the key FIX-1791 gives the coordinator. There is no `filing` key. Marked in
SPEC's *What stays as it is*; the three checks and their refusals are unchanged.

<a name="amendment-d9"></a>
## Amended after merge: no upgrade note (epic D9)

On 2026-10-07 the product owner wrote: "No consumers yet. No need for backwards support of any
kind." The epic records it as [epic D9](../../epics/FIX-1786/DECISIONS.md#d9).

| What | Treatment | Why | What is retained |
|---|---|---|---|
| DOCS's README line that `kinds` is now `workerFlows` | **Removed** | It told an upgrader what changed, and there is no consumer to upgrade | The rename itself, and S8's `minor` changeset as one sentence (restored by the cross-spec alignment: a changeset is release bookkeeping, epic D9's changeset policy) |

<a name="amendment-cross-spec"></a>
## Amended after merge (cross-spec alignment, 2026-10-07)

**The alignment.** Reading the epic's merged child specs against each other found places where
siblings read two ways. Each was an engineering call, made under decisions already taken, and
recorded in the epic's [How it got here](../../epics/FIX-1786/DECISIONS.md#how-it-got-here). This
spec changed:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| BR-15 and the PLAN guardrail's BP-030 citations | **Amended**: each gives its own reason | Epic D9: BP-030 doesn't apply to this epic | Both rules: a refused row is reported and left as it is |
