# FIX-1595 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Two destinations, both extensions. No new page: this is one option on a documented helper.
Voice notes for the implementer: no issue numbers in `apps/docs`, minimal em-dashes, and say
"exchange" once in plain words before relying on it.

## UPDATE · `apps/docs/docs/skills/activation.md` · "Tier 3 with an evaluator", after the paragraph that starts "`skillEvaluator` takes any model"

#### Follow-ups that need the last few turns

By default the evaluator sees only the current message. That misses the replies people type
most often after an offer: "yes, do that", "go ahead", "use it on what I just asked". On their
own they don't fit any skill.

Pass `recentMessages` to let it see the last few exchanges too. An exchange is one earlier turn:
what the user said and what the assistant answered.

```ts
export const skillActivator = createSkillActivator({
  initialSkills,
  evaluator: skillEvaluator("typesafe-ai/jev", { recentMessages: 3 }),
});
```

With it set, the model evaluates the earlier exchanges, oldest first, and then the message.
It still picks one skill or none, from the same skills, and the pick is still final.

What it reads:

- Only what was said. User and assistant text are included; tool calls, tool results and
  reasoning are not.
- The same history your generator sees. Items hidden from history are hidden here too, and the
  session's `historyWindow` caps how far back it can reach, whatever number you pass.
- Nothing from the current turn except the message itself.

It costs nothing unless the evaluator actually runs. A slash command, a keyword match or an
empty skill list resolves the turn before any history is read. On a session's first turn there
is nothing to add, so the evaluator sees the message alone.

Leave it out, or pass `0`, and the evaluator behaves exactly as before. A negative or
fractional value throws when you call `skillEvaluator`. Each exchange adds tokens to every
evaluator call, so start small: two or three is usually enough for a follow-up to make sense.

## UPDATE · `apps/docs/docs/skills/activation.md` · the paragraph "The activator passes the block `{ message, skills }`…"

Replace the paragraph with:

> The activator passes the block `{ message, skills }` and reads its `skill` answer. A block
> that asks a different question fails the activator with an error that says so.
> `recentMessages` is a `skillEvaluator` option; a block you build yourself gets `{ message,
> skills }` either way, and can read the session in its own `state` if it needs more.

## UPDATE · `packages/orchestration/README.md` · the `createSkillActivator` paragraph

After "It picks one skill or none, and its answer is final." insert:

> Pass `skillEvaluator(model, { recentMessages: 3 })` to let it read the last three exchanges
> too, so follow-ups like "yes, do that" can match.

## Publication ownership

This issue publishes all three edits after V1–V9 pass. The `routing-with-evaluators` guide and
the epic's shared evaluator narrative are unchanged; the guide links to the activation page,
which carries the option.
