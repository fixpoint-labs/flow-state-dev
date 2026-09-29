# FIX-1639 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only the lineage this issue changes. The epic's own lineage (FIX-441, Relay, FIX-1302) is in
[the epic's EVOLUTION.md](../../epics/FIX-1637/EVOLUTION.md) and is inherited, not repeated.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The epic's shared draft: [`specs/epics/FIX-1637/DOCS.md`](../../epics/FIX-1637/DOCS.md) → *Into a new session or an existing one*, a two-row `session` table and *"run dispatch in process for that flow, or design the hand-off so the receiving side starts from a key"* | **Amended.** The two rows and the refusal wording are retained; a `{ from: true }` row is added and the last paragraph is replaced | The epic asked this issue to confirm both routes first. [poc F3, F5](poc/page-facts/README.md) show a reply is refused when the run sending it is on a process that enqueues, and goes in process on a `worker-only` worker; no per-flow switch runs dispatch in process | [D1](DECISIONS.md#d1), BR-10, BR-14 | Docs only. The epic's copy stays as history; [DOCS.md](DOCS.md) is the one to publish |
| The same draft → *CREATE* placement: *"the first item of the guides sidebar's Background work category"* | **Superseded** | The epic's own [D2](../../epics/FIX-1637/DECISIONS.md#d2) says webhooks and schedules start work rather than outlive it | [D2](DECISIONS.md#d2): top-level, above *Webhooks* | The epic left placement to this issue (*Decided, not asked*) |
| [FIX-1302](https://linear.app/fixpoint-labs/issue/FIX-1302)'s refusal row on *Dispatched work*: *"An `id` delivery on a deployment that hands work to an external queue"* | **Amended**, one row | F3, F5: the runtime refuses a delivery into an existing session from a process that enqueues, and `{ from: true }` is one; from a `worker-only` worker it goes in process | S4, D1 | Wording only; the refusal code is unchanged |

Re-check each against `main` and the merged epic before publishing ([PLAN → At implement
time](PLAN.md#at-implement-time)).

**Owned elsewhere.** The fence rows (the `{ id }` refusal and the `{ from: true }` topology
rule), the fence paragraph and S4's refusal row describe today's behavior. FIX-1634, under
the in-flight hard-gates epic [FIX-1635](https://linear.app/fixpoint-labs/issue/FIX-1635),
changes that behavior, and its own docs work rewrites or removes them when it lands (epic
ER-14). Backstop: [FIX-1656](https://linear.app/fixpoint-labs/issue/FIX-1656). When FIX-1635
closes, it confirms the rows match shipped behavior, rewrites any FIX-1634 missed, and
re-reads FIX-1642's claims.
