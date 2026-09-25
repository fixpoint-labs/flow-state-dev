# FIX-1595 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what an author, a user or the system does and what happens.
*Proved by* names the check in [PLAN.md](PLAN.md). A "turn" is one completed earlier request: the user's
message and every user or assistant message it kept in history, which can be more than one reply
([D1](DECISIONS.md#d1)).

## Turning it on

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An author writes `skillEvaluator(model)`, or passes `{ recentMessages: 0 }` | The evaluated state is the bare message string, exactly as today. No history is read | V1 |
| BR-2 | An author passes `{ recentMessages: N }`, N a positive integer | The evaluated state is `{ recentMessages, message }`: the messages of up to the last N earlier turns, oldest first, then the current message | V2 · VG |
| BR-3 | N is negative, fractional, `NaN` or not a number | Refused when `skillEvaluator` is called, with an error naming `recentMessages`. Never silently treated as 0 | V5 |

## What the evaluator sees

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | The session has fewer than N earlier turns, including none | As many as exist. On the first turn `recentMessages` is `[]` | V2 |
| BR-5 | Earlier turns used tools or produced reasoning | Only user and assistant text is kept. Tool calls, tool results and reasoning are left out; a turn whose reply was tool-only keeps its user message ([D2](DECISIONS.md#d2)) | V3 |
| BR-6 | An item is hidden from generator history (`history: false`) or transient | It is not in `recentMessages` either: the same visibility the generator's history applies | V3 |
| BR-7 | A block earlier in the same request already emitted a history-kept message | It is not in `recentMessages`. Only completed prior requests count, and the current message appears once, as `message` | V4 |
| BR-8 | The flow's `historyWindow` is smaller than N, or `0` | The window wins; N never widens it. A huge N reads at most the window (default 50) | V8 |
| BR-9 | The action input carries a `recentMessages` field | Ignored. Turns come from the session only (BP-031) | V7 |

## Where it applies, and where it doesn't

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | Slash or keyword resolves the turn | No history read, no evaluator call, as today | V6 |
| BR-11 | The offered catalog is empty | No history read, no evaluator call, nothing activated. Earlier turns never stand in for a missing catalog | V6 |
| BR-12 | The evaluator runs with turns | Same offered skills plus "no skill", one pick or none, final. Nothing about the pick changes ([FIX-1559 BR-4, BR-8 to BR-11](../FIX-1559/BUSINESS-RULES.md)) | Existing suite |
| BR-13 | An app passes an evaluator built by hand from `skillQuestions` | It is handed `{ message, skills }`, unchanged | V7 |
| BR-14 | The built-in agent kind, or the default generator classifier, runs | Unchanged. Neither has the option | Existing suite |
| BR-15 | The evaluator ran with turns | Its trace row's input shows the turns it was handed | V9 |
| BR-16 | A skill is removed or disabled while the evaluator, with turns, is answering | It does not activate, even if picked: the catalog is re-read after the pick, as today | V11 |

## Failure taxonomy

A bad option value is fatal at build time (BR-3). Reading the session during the turn fails the
activator with that error, as an evaluator error does today; there is no silent fallback to
message-only. Fewer turns than asked is not a failure (BR-4). Nothing retries.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on a real evaluation model, a follow-up
with no skill words activates the skill the previous offer was about, small talk after the same
offer activates nothing, and the same run fails under `GOAL_CONTROL=no-recent`. The issue's own
thin test: BR-1 (N=0 is today) and BR-2 (N>0 carries the prior turns).
