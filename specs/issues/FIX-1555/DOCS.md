# FIX-1555 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three small edits, no new page. The epic owns the evaluator's own teaching
([epic DOCS](../../epics/FIX-1553/DOCS.md)); this issue documents only the memory option and
points to it. The reader is someone who already captures memory with `system()`.

## UPDATE · `apps/docs/docs/memory/configuration.md` · `system()` options table, new row

| Field | Type | Description |
|-------|------|-------------|
| `evaluator` | evaluator block | Optional. Asks one question before the observer runs: is anything in the new messages worth remembering? See [Deciding which turns to observe](#deciding-which-turns-to-observe). |

## CREATE · `apps/docs/docs/memory/configuration.md` · new section after the `system()` options table

> ### Deciding which turns to observe
>
> Every turn you capture runs the observer, a model call that reads the new messages and pulls
> out anything worth keeping. In a chatty agent most turns hold nothing ("ok", "thanks", "try
> that again"), and the observer runs anyway.
>
> You can put an evaluator in front of it. An evaluator is a block that asks a model a question
> with known answers and gets a typed answer back ([Blocks](../fundamentals/blocks)). Memory
> publishes the question; you build the block and choose the model:
>
> ```ts
> import { evaluator } from "@flow-state-dev/core";
> import { system, captureQuestions } from "@flow-state-dev/memory";
>
> const worthRemembering = evaluator({
>   name: "memory-gate",
>   model: "typesafe-ai/jev",
>   questions: captureQuestions,
> });
>
> const mem = system({
>   model: "openai/gpt-5.4-mini",
>   working: true,
>   episodic: true,
>   evaluator: worthRemembering,
> });
> ```
>
> On each capture, the evaluator reads the same new messages the observer would and answers
> `remember` or `skip`.
>
> - **`remember`**: the observer runs on those messages, exactly as it does without an evaluator.
> - **`skip`**: the observer doesn't run and nothing is written. The messages count as read, so
>   no later capture looks at them again.
> - **An error** (the evaluation model is down, or refuses the call): the capture fails the way an
>   observer failure does. The messages stay unread, and the next capture that succeeds picks them
>   up. Memory never runs the observer in the evaluator's place.
>
> A skip is final, so a model that skips too eagerly loses facts. Try it on a sample of your real
> conversations before you turn it on. It pays off when most turns are skips: a turn the evaluator
> passes costs one evaluate call on top of the observer.
>
> Any evaluation-capable model works, including `openai.evaluationModel(...)`. Memory reads the
> answer only. It doesn't need the model to report how confident it is, and it doesn't use that
> confidence when the model does report it.
>
> Leave `evaluator` out and capture works as it always has. Memory doesn't depend on any
> evaluation model or provider package; the block arrives already built.

## UPDATE · `apps/docs/docs/memory/overview.md` · "Further reading", new bullet after Configuration

> - [Deciding which turns to observe](./configuration#deciding-which-turns-to-observe) — put an
>   evaluator in front of capture so small-talk turns skip the observer.

## UPDATE · `packages/memory/README.md` · new section after "Relations (knowledge graph)"

> ## Skipping turns with an evaluator
>
> `system()` takes an optional `evaluator` block. Before the observer runs, it answers memory's
> one question, exported as `captureQuestions`: `remember` runs the observer as usual, `skip`
> writes nothing and marks the messages read. You build the evaluator and pick its model; this
> package imports no model or provider for it. Leave it out and capture is unchanged.
>
> ```ts
> const mem = system({
>   model: 'openai/gpt-5.4-mini',
>   working: true,
>   evaluator: evaluator({ name: 'memory-gate', model: 'typesafe-ai/jev', questions: captureQuestions }),
> })
> ```

Add `captureQuestions` to the README's **Key exports** line.

## Voice and ownership

The configuration section introduces "evaluator" in plain terms on first use and links the
blocks page, which [FIX-1554](https://linear.app/fixpoint-labs/issue/FIX-1554) writes. No page
mentions Jev as required, a System One package, or a generator fallback (ER-9). Examples use the
model strings current at publication. Publish after the implementation passes V2 and V4; if
FIX-1559 named its slot differently, the option name here follows it.
