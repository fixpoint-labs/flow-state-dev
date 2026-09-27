# poc/route-choice — does one evaluator choice pick the right specialist?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`, and `knip` ignores `specs/issues/*/poc/**`. The script runs core's `evaluator`
block on the real path: a flow whose action is the block, run by the engine's `runAction` with
in-memory stores. Nothing is mocked below the model.

**The question.** The epic ([D5](../../../../epics/FIX-1592/DECISIONS.md#d5)) bets that who
hears a post is one `evaluator` call with one `choice` question, its options each member's id
described by its `WORKER.md` `description:`, reading the channel's recent lines and the new
post. Does that pick the right member on a real model?

**What would have abandoned the direction:** a clearly worded post routed wrong, a follow-up
that the recent lines can't keep with its specialist, or a call too slow to sit in front of every
post.

## The fixed set

Four members, the epic's [D7](../../../../epics/FIX-1592/DECISIONS.md#d7) roster, each described
in one line the way a `WORKER.md` would. `support.general` is the fallback. The recent lines: a
customer's laptop won't join the wifi, and `support.devices` has asked whether it sees the
network. Five posts:

| Leg | Intent | Post | Expected |
|---|---|---|---|
| L1 | device | My phone stopped charging, and it's a brand new cable. | `support.devices` |
| L2 | account, a topic switch | Different thing: I was charged twice for my subscription this month. | `support.accounts` |
| L3 | building with FSD | How do I make a generator return structured output in flow-state-dev? | `support.fsd` |
| L4 | follow-up | It sees it. It fails right after the password. | `support.devices` |
| L5 | unclear | Who do I ask about getting a parking pass? | `support.general` |

L4 names no device. Only the recent lines tie it to `support.devices`, so it is the leg that
shows whether the state carries a follow-up. `POC_CONTROL=no-transcript` drops those lines and
L4 must then fail.

## Run it

From the repository root, with `AI_GATEWAY_API_KEY` set and the `FSDEV_*` model overrides unset
(they force every model to the cheap one). It exits 2 without a key.

```bash
pnpm exec tsx specs/issues/FIX-1610/poc/route-choice/run.mts --model sonnet --repeat 3                           # PASS 15/15
POC_CONTROL=no-transcript pnpm exec tsx specs/issues/FIX-1610/poc/route-choice/run.mts --model sonnet --repeat 3 # FAIL: L4 goes to accounts
pnpm exec tsx specs/issues/FIX-1610/poc/route-choice/run.mts --model jev --repeat 3                              # PASS 15/15
pnpm exec tsx specs/issues/FIX-1610/poc/route-choice/run.mts --model nano --repeat 1                             # every call refused
pnpm exec tsx specs/issues/FIX-1610/poc/route-choice/run.mts --model string --repeat 1                           # every call refused
```

## Results, 2026-09-27

| Model, as the `evaluator` is handed it | L1 device | L2 account | L3 fsd | L4 follow-up | L5 unclear | Median · max |
|---|---|---|---|---|---|---|
| `anthropic/claude-sonnet-5`, a chat model wrapped in the AI SDK's generic evaluation adapter | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1.7 s · 2.2 s |
| the same, no recent lines (control) | 3/3 | 3/3 | 3/3 | **0/3, `accounts`** | 3/3 | 1.7 s · 2.4 s |
| `typesafe-ai/jev`, the gateway's own evaluation model | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 0.3 s · 0.5 s |
| the same, no recent lines (control) | 3/3 | 3/3 | 3/3 | **0/3, `accounts` at 0.94–0.96** | 3/3 | 0.3 s · 0.5 s |
| `openai/gpt-5-nano`, wrapped in the adapter | refused | refused | refused | refused | refused | — |
| the string `"vercel/anthropic/claude-sonnet-5"`, through core's resolver | refused | refused | refused | refused | refused | — |

Runs of the same commands earlier the same day matched: 15/15 on both models, and L4 0/3 under
the control on the wrapped chat model.

## What it showed

1. **The premise holds.** One call, one `choice`, picked the right member 30 times in 30 across
   two unrelated models, including a topic switch right after a specialist asked a question
   (L2) and a post that fits nobody (L5).
2. **The recent lines are what keep a follow-up.** Without them L4 went to `accounts` every
   time, on both models. So the route has to hand the evaluator the channel's recent lines, and
   a check that it does can fail.
3. **Confidence would not have caught the misroute.** The evaluation model was 0.94–0.96 sure of
   the wrong answer under the control. A threshold adds nothing here, which is what FIX-1558's
   [adapter-confidence POC](../../../FIX-1558/poc/adapter-confidence/README.md) found for chat
   models from the other side: they report none.
4. **The model has to be one that can evaluate.** The gateway refuses a chat model named as a
   plain string at its evaluation endpoint. The generic adapter sends a "no reasoning" setting
   the cheap model rejects. So an app names an evaluation model, or wraps a chat model that
   takes the adapter. Kitchen-sink's test and dev runs force the cheap model today, so its route
   needs its own model setting ([PLAN → Coordination](../../PLAN.md#coordination)).
5. **Cost of one call.** About 0.3 s on the evaluation model and 1.7 s on the wrapped chat
   model, in front of the specialist's own run.

Raw output: [`evidence.txt`](evidence.txt).
