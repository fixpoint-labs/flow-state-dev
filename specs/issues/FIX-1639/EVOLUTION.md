# FIX-1639 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only the lineage this issue changes. The epic's own lineage (FIX-441, Relay, FIX-1302) is in
[the epic's EVOLUTION.md](../../epics/FIX-1637/EVOLUTION.md) and is inherited, not repeated.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The epic's shared draft: [`specs/epics/FIX-1637/DOCS.md`](../../epics/FIX-1637/DOCS.md) → *Into a new session or an existing one*, a two-row `session` table and *"run dispatch in process for that flow, or design the hand-off so the receiving side starts from a key"* | **Amended.** The two rows and the refusal wording are retained; a `{ from: true }` row is added and the last paragraph is replaced | The epic asked this issue to confirm both routes first. [poc F3](poc/page-facts/README.md) shows a reply is refused too, and no per-flow switch runs dispatch in process | [D1](DECISIONS.md#d1), BR-10, BR-14 | Docs only. The epic's copy stays as history; [DOCS.md](DOCS.md) is the one to publish |
| The same draft → *CREATE* placement: *"the first item of the guides sidebar's Background work category"* | **Superseded** | The epic's own [D2](../../epics/FIX-1637/DECISIONS.md#d2) says webhooks and schedules start work rather than outlive it | [D2](DECISIONS.md#d2): top-level, above *Webhooks* | The epic left placement to this issue (*Decided, not asked*) |
| The same draft → *Where each setting lives* and *Terms* | **Retained**, wording tightened | [`names.mts`](poc/page-facts/README.md) resolves every cell on `main` | DOCS.md, same sections | None |
| Epic D1 ([#2394](https://github.com/fixpoint-labs/flow-state-dev/pull/2394), not yet merged): *"the table may be its own linkable page"* | **Retained as an option not taken** | One URL, one place to keep true | D2: a section with an anchor | A later split is a move plus a redirect |
| [FIX-1302](https://linear.app/fixpoint-labs/issue/FIX-1302)'s refusal row on *Dispatched work*: *"An `id` delivery on a deployment that hands work to an external queue"* | **Amended**, one row | F3: the runtime refuses any delivery into an existing session, and `{ from: true }` is one | S4, BR-21 | Wording only; the refusal code is unchanged |

Re-check each against `main` and the merged epic before publishing ([PLAN → At implement
time](PLAN.md#at-implement-time)).
