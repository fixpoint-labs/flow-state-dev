# FIX-1789 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three earlier designs this issue builds on. None is superseded whole. Epic-wide lineage, including
the six-key contract's move to stored data, is in [the epic's record](../../epics/FIX-1786/EVOLUTION.md).

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Admission is what the schema accepts, not which function built it; no marker, one enforcement point. FIX-1367, retained only in code: the header of `packages/workforce/src/worker-config.ts` | **Retained** under the list; **amended** under the wrapper, which adds a mark | The POC's H1: the list registers a hand-built flow that meets the contract, the wrapper refuses it | [Q1](DECISIONS.md#q1) | Under the list, every flow hireable today that meets the three checks stays hireable |
| Admission has exactly one gate, `hireWorkforce`; a missing kind is refused by name; a replacement `agent` must declare its kind. [`docs/architecture/workforce-default-worker-kind.md` → C2](../../../docs/architecture/workforce-default-worker-kind.md#c2--admission-has-exactly-one-gate) | **Amended**: the gate gains the contract's three checks, run once per flow at registration, and standard-only after the `agent` default | The epic's ER-2 | BR-1 to BR-16 | C2's refusals and wording unchanged; C3's per-seat drawer moves off org scope (S6), re-seeded from configuration |
| One door per kind; two is a hire problem; none means the composers say so. [`../FIX-1690/DECISIONS.md`](../FIX-1690/DECISIONS.md), D1 | **Amended** for worker flows: none or two is refused at registration | The epic's ER-2 makes the door part of the contract; the concept's reason is that an app talks to any worker without knowing its flow | BR-3, BR-4 | A doorless worker flow stops hiring. DevForce's scripted EM is the one found; PLAN → *At implement time* |

The epic's [EVOLUTION](../../epics/FIX-1786/EVOLUTION.md) already records the mailbox boards' org
ledgers as superseded by FIX-1792; this issue only allows them by name until then (S7). Compare
each prior intent with current code before implementing: approved intent is not shipped behaviour.
