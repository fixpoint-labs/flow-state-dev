# FIX-1425 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

| Rule | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A worker supplies its valid document setting | Hiring succeeds and the existing lab checks retain their outcomes | V2, V3 |
| BR-2 | A worker omits its document setting | The real hiring path refuses the setting rather than admitting a worker that fails on first read | V1 |
| BR-3 | A maintainer reads the document declaration | It is required and carries no explanation of an optional workaround | Diff inspection of S1 |

## Failure taxonomy

A missing document is a startup configuration error through existing admission validation. There is no new error type, retry policy, or fallback. Empty strings retain the existing non-empty validation. A model credential failure leaves V3 blocked; a mock or a model-free pass cannot substitute for it.

## Acceptance criteria this issue owns

S1 implements the required declaration and removes its workaround explanation. V1 observes rejection on the real hiring path and acceptance with the setting restored. V2 and V3 pass on the implementation revision. Existing neighboring limitations, including stale README prose, are outside this narrow change and tracked separately.
