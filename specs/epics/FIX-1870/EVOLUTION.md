# FIX-1870 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1815: ask and assign are two kinds of hand-off, both stay; source [`../FIX-1815/DECISIONS.md`](../FIX-1815/DECISIONS.md) → "Decided before review" | **Superseded** as naming; behaviour **retained** | The recipient does the same work in both; only the caller differs (`wait-for-response.ts`) | This epic D1 and D3 | Both behaviours stay, pinned by the FIX-1816, FIX-1817 and FIX-1820 reruns |
| FIX-1815 D4: ask is an opt-in option on `addTask`, `waitForResponse`; source [`../FIX-1815/DECISIONS.md#d4`](../FIX-1815/DECISIONS.md#d4) | **Amended**: fire-and-forget by default is retained, the option moves | `waitForResponse` makes a board CRUD tool a delivery tool | `dispatchTask`'s `wait` (FIX-1875, ER-1, ER-2) | `waitForResponse` and `timeoutMs` are refused by name, not ignored (BP-030) |
| FIX-1815 D2: one answer-once fence, never built; source [`../FIX-1815/DECISIONS.md#d2`](../FIX-1815/DECISIONS.md#d2), with ER-6 allowing either the claim ticket or the ledger | **Amended**: the intent retained, the choice made | Two fences still ship; FIX-1818 was cut by [FIX-1815 Q1](../FIX-1815/DECISIONS.md#q1) | This epic D2, ER-5, ER-10; FIX-1872 | The delivery ledger's server-written `deliveries` state is dropped; a session holding an open round needs FIX-1872's migration answer |
| FIX-1791: the delivery ledger, a token the answer hands back, claimed once; `packages/workforce/src/delivery-ledger.ts`; [`../../issues/FIX-1791/DECISIONS.md`](../../issues/FIX-1791/DECISIONS.md) → "Decided, not asked" | **Superseded** | Same as above | The board claim ticket (FIX-1872) | One answer per delegate per post per round holds (ER-6) |
| FIX-1312: reply-to-sender, `session: { from: true }`; Linear only | **Retained** | Flow-code transport, not a model tool | — | Unchanged (ER-12) |
| The glossary's *Hand-off*: work leaving the request for another session; `apps/docs/docs/glossary.md` | **Superseded** | D3 | The rows in [DOCS.md](DOCS.md) (FIX-1876) | Docs only |

FIX-1871 and FIX-1874, this epic's first draft, were never merged as specs; their record is Linear
(both Canceled). Re-check each cited intention against current code before implementing.
