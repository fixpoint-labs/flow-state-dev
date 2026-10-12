# Orchestration Primitives — the arc

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Live status is [Spec](SPEC.md) → *the epics*; this page is the order and what each hands the next.

![The arc](figures/arc.svg)

The substrate ran from July to October and is done; the one bar still open is FIX-1312, whose work
has shipped while its epic has not been closed. dispatchTask is next and has no bar yet.

## The order, and what each hands the next

| Epic | Consumes | Releases |
|---|---|---|
| Plan/Task series | — | The Task row, TaskCollection, the task board; patterns as board configurations |
| FIX-930 · delegation | The board | A roster, a default worker, context supply; skills that delegate through the board |
| FIX-939 · durable jobs | The board, the roster | Detached tasks under a lease; the claim ticket |
| FIX-980 · honest substrate | The claim ticket | Versioned task writes; park and unpark; settles a caller can trust |
| FIX-1320 · flow instances | — | A global address for each flow instance |
| FIX-1312 · dispatch protocol | An address | `dispatcher()` with reply-to-sender, as transport for flow code |
| FIX-1870 · dispatchTask | The honest board, reply-to-sender, FIX-1815's ask and assign behaviour | One worker-to-worker tool; one answer-once fence; "ask" and "hand-off" narrowed to one meaning each |

FIX-1870 waits on FIX-1820, the restart closure in Workforce: Shift Manager, which is Done. Its
checks, with FIX-1816's and FIX-1817's, are FIX-1870's regression gate.

## Deliberately not next

- **True Plan Mode (FIX-312, FIX-449).** Not started since April. Whether it stays in this project
  is open ([Decisions](DECISIONS.md) → *Open*).
- **The architecture page and pattern catalog (FIX-451, FIX-922).** Waits for FIX-1870, so the
  catalog documents one hand-off tool rather than four.
- **Waiting on several tasks at once, and a row-less question tool for workers.** FIX-1870 rules
  both out of scope; neither has an epic.
- **Spend caps on delegated work (FIX-933).** Filed under FIX-930, never started.
