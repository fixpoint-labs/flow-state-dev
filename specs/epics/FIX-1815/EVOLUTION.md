# FIX-1815 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans both children. Each child's own evolution record carries the rest.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1537, a Backlog stub (2026-09-23) for `dispatchAndWait` under FIX-1312's reverse dispatch, gated on FIX-1312 and FIX-1171; Linear only, no retained spec | **Undecided**: FIX-1816's spec decides which framing stands (ER-18) | Ask reads the request id the dispatch returns (L5), so it may not need FIX-1312's reverse reply at all. FIX-1312's `from` stamp carries no request id (`engine/src/execution/dispatch-metadata.ts`) | FIX-1816, or FIX-1537 under it | One of the two closes as a duplicate. FIX-1537 stays FIX-1312's child |
| FIX-1230 and FIX-1231, earlier attempts at the same capability; Linear only, Canceled | **Superseded** | Cancelled before any design was retained | FIX-1816 | None |
| FIX-1780's `onTaskSettled`, S1 to S5; its PRs #2758 and #2761 | **Retained** as the signal ask and assign wake on, built by FIX-1794 P2 (Q2) | Only S5a shipped (#2761). [FIX-1794's evolution record](../../issues/FIX-1794/EVOLUTION.md) carries S1 to S5 to its S6 and S7. Linear still marks FIX-1780 Done (Q3) | D2's one child-finished signal, L4 | None. The entry name is the one FIX-1780 pinned |
| FIX-1794 BR-25, a parked task answered later gives a second `completed` notice; [source](../../issues/FIX-1794/BUSINESS-RULES.md) | **Amended** by FIX-1817 | BR-25 says the task completes, not which session the answer wakes. FIX-1794 BR-17 re-enters the same session only on a second attempt | ER-2: the answer wakes the same task session | FIX-1794's notices unchanged; ER-12 forbids editing its spec here |
| FIX-1794 goal leg e, a finished task declines writes (`terminal_task_write_declined`) and the coordinator files a new task; [source](../../issues/FIX-1794/SPEC.md) | **Retained** | "Never locks" is about the session, not the row | ER-3: a follow-up task is a new row bound to the same session | No change to the finished row |
| FIX-1802 BR-15 to BR-17, a piece's notice wakes the task session and a settle-owed marker replays "run my board"; [source](../../issues/FIX-1802/BUSINESS-RULES.md) | **Retained**, and extended in use | The marker family is the durable "owed" note both kinds need. Spec-only on `main` | D2's one resume-owed marker, L3 | Shared, not copied (ER-7) |
| FIX-1791's delivery ledger, a token the answer hands back, claimed once; `packages/workforce/src/delivery-ledger.ts` | **Retained** | One of the two existing answer-once checks ask may ride (ER-6) | — | Whether "ask the delegate" becomes an ask, and so the token goes, is FIX-1816's call |
| FIX-1814, removing skill `agents:` | **Retained** | The product owner: half-built, no clear agent concept | ER-10 | No skill helper in this epic |

Re-check each cited intention against current code before implementing: retained specs are
intent, not proof of shipped behavior.
