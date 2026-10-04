# FIX-1717 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1426 BR-10: the prompt carries tokens from the coder seat's own `WORKER.md`, document and skills; source [FIX-1426 business rules at `763e6faf3`](https://github.com/fixpoint-labs/flow-state-dev/blob/763e6faf3384d38ff35efd3bbcf68ed46e7c9573/spec/FIX-1426/BUSINESS-RULES.md) (review PR #1848, closed unmerged; no retained `specs/` copy) | **Retained** | The seat's files still reach every prompt; `it-wakes-the-seat-a-file-declared` keeps grading it | [BR-5](BUSINESS-RULES.md) | Unchanged |
| The DevForce lab's builder treats the seat's document as the brief, "what the feature is" (`goals/devforce-lab/lab/phase.mts:6-12`, coder `WORKER.md:9-11`; design from the same FIX-1426 review) | **Amended**: the task on the row is the job; the document is the team's standing contract | The POC: an approved night-mode task ran as the document's greeting module ([Settled](DECISIONS.md#settled)) | D1 · PLAN S2 S4 | The four `devforce-lab` checks keep passing (V4); their rows and the document name the same feature |
| FIX-1394 parent→worker hand-off lean, agreed with the owner 2026-09-15: required brief, channel context only when shared, opt-in named packs and summary, no parent history by default; source: the Architect's note on [FIX-1717](https://linear.app/fixpoint-labs/issue/FIX-1717) → "Locked handoff lean" (no repository artifact) | **Retained**, applied to coding runs | The board's task fields already are that brief | [D1](DECISIONS.md#d1) | No opt-in summary is built here |
| The builder's run context carries the row's identity, attempt and history channels (feedback, answers, a person's turns), not the row's content (`packages/harness-manager/src/manager.ts:112-170`) | **Amended**, additively: it also carries the task | The worker already held the task and dropped it | [D2](DECISIONS.md#d2) · PLAN S1 | Builders that ignore it are unchanged (BR-12) |

Nothing is superseded. FIX-1701 is not a predecessor: it changes what harnesses stamp on the items
they emit, not what they are handed, and shares no file with this plan.
