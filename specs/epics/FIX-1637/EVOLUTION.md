# FIX-1637 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans the set. No retained spec directory exists for the first three rows;
they cite Linear history.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| [FIX-441](https://linear.app/fixpoint-labs/issue/FIX-441) → *Surface*: a topic, or notification, bus, `.notify(topic)` with `NotificationFlow` subscribers, and the `notification` transport source | **Superseded** as a thing to document. The issue is Canceled; soft-related, not reopened | Neither name is exported on `main`. The `notification` value survives in core's `InboundSource` doc comment, the DevTool's source badge and *Inbound transports → Known sources* | D3: the event row names `dispatcher({ flowKind })`, the shipped cross-flow bus, and a custom inbound adapter. FIX-1639 rewords the Known sources row: no shipped transport emits it | Docs only. The value stays in the known set; a custom transport may still emit it, and the DevTool labels it |
| [FIX-1197](https://linear.app/fixpoint-labs/issue/FIX-1197), [FIX-1230](https://linear.app/fixpoint-labs/issue/FIX-1230), [FIX-1231](https://linear.app/fixpoint-labs/issue/FIX-1231): Relay, an internal message layer addressing an existing session | **Retained as canceled** | The dispatch protocol ([FIX-1302](https://linear.app/fixpoint-labs/issue/FIX-1302), Done) replaced it | ER-8: no Relay vocabulary in published docs | None |
| [FIX-1302](https://linear.app/fixpoint-labs/issue/FIX-1302): `dispatcher()` delivery refuses `{ id }` past an external queue, by name | **Retained** | `create-request-host.ts` and `dispatch-operation.ts` on `main` refuse with `external-dispatcher`; FIX-1634 keeps it until both guarantees are restored | ER-4 states it on the page | None; the page reads the runtime as it is |
| [FIX-1589 BR-20](../../issues/FIX-1589/BUSINESS-RULES.md) and [FIX-1594 BR-19](../../issues/FIX-1594/BUSINESS-RULES.md): a channel's filing and posting refuse on a queue host | **Retained** | Both rules describe the same refusal from the Workforce side | The page's channel paragraph links *Channels* rather than restating it | None |
| The PRD's three-child split on FIX-1637, with the Architect's "do not merge bodies" note on FIX-1638 | **Amended** by D1, the owner's fold on 2026-09-29 | D1's consistency argument | FIX-1639 carries all three deliverables, the table and the terms as sections of one page | FIX-1638 and FIX-1640 canceled as folded; their blocks on FIX-1642 removed |

Nothing here migrates stored data. Re-check each cited intention against `main` before
publishing.
