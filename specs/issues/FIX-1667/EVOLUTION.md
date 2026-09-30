# FIX-1667 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1426 D1: the feature board is declared in the two worker kinds' code, on a ledger of the lab's own; the recipient's second declaration is an interim tax. No retained spec file; provenance is [FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426) and the headers of `goals/devforce-lab/lab/board.mts` and `coder.mts` | **Amended.** Where the board lives is superseded; the cross-flow hand-off and the interim second declaration are retained | FIX-1385 settled board authoring as channel-attached after FIX-1426 was written; the lab's own header names it as the direction | [D1](DECISIONS.md#d1), S4 to S6: one ledger, the channel's | The three checks keep their claims; only where they read rows moves (S7). The product check's reread opens a store file its own run wrote, so both halves move together; no store outlives one check run |
| FIX-1385: a channel's file declares its boards by local name and the framework mints the id. Provenance: [FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385) and `packages/workforce/README.md` → "Holding a board" | **Retained**, and extended to a board that backs a supervised coding run | `goals/channel-boards/` proves the plain-drain case; the manager's refusal of dotted ids ([Settled](DECISIONS.md#settled)) was the gap | D1's manager change, S1 | Unchanged for every existing channel board |
| The harness manager's run partition: a board id must already be a safe path segment. Provenance: `packages/harness-manager/src/identity.ts` (`DERIVED_IDENTITY`) | **Amended**: a channel-minted id is also accepted, through a derivation | Channel ids are dot-joined by design | S1 | BR-14: every id accepted today derives byte for byte as before |

Nothing is wholly superseded. The recipient's second declaration is retained as it was; FIX-1408 closed without removing it, and it has no open owner.
