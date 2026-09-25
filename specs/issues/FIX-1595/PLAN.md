# FIX-1595 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. One PR, touching `core`, `engine` and
`orchestration`.

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S0 | `core` · `ItemQuery` · `engine` · `items.history()` (`packages/engine/src/context/history.ts`) | One optional, generic field on `ItemQuery` that leaves the in-flight request's items out of `items.history()`. Omitted: today's behaviour, live items appended. Nothing skill- or evaluator-shaped | BR-7 · D3 |
| S1 | `orchestration` · `skillEvaluator` helper (`src/skills/skill-evaluator.ts`) | Takes `options?: { recentMessages?: number }`. Validates it at the call. Records N where the tier can read it. N > 0: `state` returns `{ recentMessages, message }` from the input; otherwise today's `(input) => input.message` | BR-1 BR-2 BR-3 |
| S2 | `orchestration` · `SkillEvaluatorInput` and its schema | Optional `recentMessages: { role: "user" \| "assistant"; text: string }[]` | BR-2 BR-13 |
| S3 | `orchestration` · a small module both S1 and S4 import, with no core evaluator values | Holds "how many turns this block asked for" (a `WeakMap` keyed by block, or equivalent). The gather is one `ctx.session.items.history()` call with S0's option, `limit: N`, `itemTypes: ["message"]`, `roles: ["user", "assistant"]`, mapped to `{ role, text }`. No second copy of the engine's selection, visibility or window rules | BR-4 to BR-8 |
| S4 | `orchestration` · the evaluator tier (`src/skills/skill-evaluator-tier.ts`) | After the catalog is listed and non-empty, and only if the block asked for N > 0, gather and add `recentMessages` to the evaluator's input. Never from the action input. The post-pick catalog re-read in the apply step stays as it is | BR-7 BR-9 BR-10 BR-11 BR-15 BR-16 |
| S5 | `orchestration` · tests | `test/skills/skill-activator-evaluator.test.ts` gains the V-checks; the type test gains the options overload | all |
| S6 | `goals/skill-activator/follow-up-uses-recent-turns/` | New goal check (goal.md, run.mts, fixtures), modelled on its sibling `evaluator-picks-a-skill` | VG |
| S7 | Docs · changeset | Per [DOCS.md](DOCS.md); `patch` changesets for `@flow-state-dev/core`, `@flow-state-dev/engine` and `@flow-state-dev/orchestration`. The new `ItemQuery` field gets a line in core's session-views docs | — |

Nothing is removed.

## Sequence

```mermaid
flowchart TD
  S0["S0 · history view: prior only"] --> S3
  S2["S2 · input field"] --> S3["S3 · N lookup + gather"]
  S3 --> S1["S1 · helper option and state"]
  S3 --> S4["S4 · tier gathers"]
  S1 --> S5["S5 · tests"]
  S4 --> S5
  S5 --> S6["S6 · goal check"]
  S5 --> S7["S7 · docs · changeset"]
```

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V0 | S0 | Engine history test: a live history-kept message is appended by `items.history()` without the option (unchanged, deep-equal to today) and absent with it; limit, visibility and the flow window apply the same either way. **Must fail** if the option is ignored |
| V1 | S1 S4 | In a session with prior turns, `skillEvaluator(model)` and `{ recentMessages: 0 }` hand the evaluation model the bare message string, deep-equal to today's; no history read. **Must fail** if the tier gathers regardless of N |
| V2 | S4 | N = 2 over three prior turns: the recorded evaluation call's state is `{ recentMessages: [the last two, oldest first], message }`. First turn: `recentMessages: []`. Red on `main` |
| V3 | S4 | Prior turns with a tool call, tool result, reasoning, a `history: false` message and a transient item: only user/assistant text survives (BR-5, BR-6) |
| V4 | S4 | A block ahead of the activator emits a history-kept message this request: absent from `recentMessages`; the current message appears once (BR-7) |
| V5 | S1 | `-1`, `1.5`, `NaN`, `"3"` each throw at the helper call, naming `recentMessages` |
| V6 | S4 | Slash hit, keyword hit, empty catalog: no evaluator call and no history read with N > 0 (spy on the session view) |
| V7 | S4 | A hand-built `skillQuestions` evaluator gets `{ message, skills }` only; an action input carrying `recentMessages` is ignored |
| V8 | S4 | `historyWindow: { turns: 1 }` with N = 5 yields one turn's messages |
| V11 | S4 | With N > 0, a skill removed from the binding while the evaluation call is in flight does not activate though picked; same as the existing N = 0 race test |
| V12 | S4 | A prior request that kept two assistant messages contributes both, in order, and still counts as one of the N turns ([D1](DECISIONS.md#d1)) |
| V9 | S4 | The evaluator's trace row input carries the turns |
| V10 | S5 | The existing import-invariant test passes **unchanged**: only `skill-evaluator.ts` imports core's evaluator values, and the tier imports it by type only |
| VG | S6 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met): `pnpm tsx goals/skill-activator/follow-up-uses-recent-turns/run.mts` PASSES on both models, after the same run FAILED under `GOAL_CONTROL=no-recent`. Prior turns are written by running earlier turns through the engine in the same session, never injected into the input |

The second path (BP-035): V1 is the off state of the new option; V4 is the in-flight path; V6 the
paths that must not pay for it; V11 the race the re-read guards.

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| Helper option | `recentMessages` | The owner's call on the issue. Public |
| Input and state field | `recentMessages` | Public on `SkillEvaluatorInput`; a hand-built evaluator's author may read it |
| Element shape | `{ role: "user" \| "assistant"; text: string }` | Public, and what the model reads ([D2](DECISIONS.md#d2)) |
| Goal control | `GOAL_CONTROL=no-recent` | Cited by `SPEC.md` |

Everything else is yours to name.

## Guardrails

| Rule | Because |
|---|---|
| Read turns only through `items.history()` with S0's option; don't rebuild selection from `all()` or engine internals | Without the option it appends the in-flight request's items regardless of limit (`loadLLMHistory`), which breaks BR-7. The raw views carry no role, and engine internals aren't orchestration's to import (D3) |
| Filter to `itemTypes: ["message"]` and `roles: ["user", "assistant"]` | The default history types include reasoning and `tool_output`, whose tool calls come back as assistant-role messages; D2 wants neither |
| Keep the apply step's catalog re-read | A skill removed mid-call must not activate (BR-16) |
| One gather, in the tier; the helper's `state` never reads `ctx` | The issue locks gathering in the activator, and one reader keeps the trace honest (tenet 5) |
| The tier keeps importing `./skill-evaluator` by type only | An activator built without an evaluator must never build one (FIX-1559 V-invariant) |
| No read of any kind when N is 0 or the evaluator won't run | Apps that don't opt in pay nothing (BP-030); an empty catalog stays visibly empty (FIX-1372) |
| Turns come from the session, never the action input | Caller-controllable input decides nothing here (BP-031) |

## Docs

Reconcile [DOCS.md](DOCS.md) against the shipped behaviour after V1–V9 pass, then publish it to
its two destinations. No new page.

## Sketch · pseudocode, illustrative, react to the shape

```
helper(model, { recentMessages = 0 } = {}):
    refuse unless recentMessages is a non-negative integer
    block ← evaluator(… state: N > 0 ? input → { recentMessages: input.recentMessages ?? [], message } : input → input.message)
    remember block → N                     ← the shared module
tier, after listing a non-empty catalog:
    N ← asked(block)
    if N > 0: turns ← session.items.history({ <S0 prior-only>, limit: N, itemTypes: [message], roles: [user, assistant] })
    evaluator input ← { message, skills, …(N > 0 ? { recentMessages: turns } : {}) }
```

**POC:** none. The premise D3 rests on, that `items.history()` always appends the in-flight
request, is read from `loadLLMHistory` and pinned by V0's unchanged-without-the-option half.

## At implement time

- Re-check that `mockEvaluationModel` records the state it was called with; V1 to V4 read it.
- FIX-1372 may have landed; BR-11 holds either way.
- Name S0's field for what it does to history (for example `includeInFlight: false`, default
  `true`). `history()` is the view this issue needs; whether `all()` and `client()` honor it too
  is yours, but say which in core's type docs.

## Notes from review

Recorded for the implementer, not baked into the design. Weigh them against real code.

- **Cursor (PLAN S3):** "consider storing `recentMessages` N on the evaluator **block instance** the
  tier already references (`opts.evaluator`), with a tiny exported reader from
  `skill-evaluator.ts` (still V10-safe if only that file imports core evaluator values). WeakMap is
  fine if blocks cannot hold opaque config." Either is fine; V10 must pass unchanged.
- **Cursor (DOCS, hand-built evaluators):** warn that `items.history({ limit })` is not a drop-in
  (in-flight items and tool traffic). With S0 shipped, the docs can instead name the option and
  the type/role filters.
- **Cursor (BR-13):** say in one line that the activator populates `recentMessages` only for blocks
  built by `skillEvaluator(model, { recentMessages })` with N > 0, so nobody merges action or
  session data into custom evaluators.
- **Cursor (export the engine history helper):** superseded by S0; the tier reuses the engine's
  history through the public view, not a second implementation.

## Follow-ups

- The same option for the default generator classifier, if wanted (issue's out of scope).
