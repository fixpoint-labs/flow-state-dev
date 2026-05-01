# Handler Discipline: Validated and Refined

A follow-up validation of the original review's handler/sequencer claim, prompted by the maintainer's stronger framing: handlers should never call blocks via `block.run()` — ever — and the framework's design currently lets them. This report audits the codebase, examines why the temptation exists, proposes enforcement strategies, and compares the discipline gap to how Inngest, Vercel Workflows, and Trigger.dev handle the same problem.

The short answer: the maintainer is right that this is a real flaw, and it is structurally similar to the orchestration-vs-step-code distinction in durable execution frameworks. The original review's claim that "handler vs sequencer is genuinely ambiguous in practice" is partially right but mostly mis-framed. The ambiguity isn't between handler and sequencer — it's between "handler that does one thing" and "handler that orchestrates." Removing the second category by construction collapses the ambiguity.

---

## 1. Audit: where do handlers call blocks today?

I grepped `packages/`, `apps/`, and `examples/` for `.run(`, then filtered out tests, SQLite prepared statements, p-limit's `limiter.run`, and substrate sites.

**The substrate-legitimate set** (these are the runtime actually invoking user blocks; they are not violations):

- `packages/server/src/execution/executeBlock.ts:227,252` — the runtime's central dispatch.
- `packages/core/src/blocks/sequencer.ts:468,640` — sequencer step execution and `forEach` per-element execution.
- `packages/core/src/blocks/router.ts:198` — router dispatch on the selected route.
- `packages/core/src/blocks/generator.ts:688,845` — tool block invocation inside the LLM tool loop and observer dispatch.
- `packages/cli/src/commands/block.ts:119` — CLI's `fsdev block run` substrate.
- `packages/server/src/execution/executeBlock.ts:227` (generator branch) — the generator-specific dispatch.

**The actual violations in shipped, non-substrate code** are narrow but real:

1. `packages/core/src/utility/intent-router.ts:78` — `await classifier.run(input, ctx)` inside a handler's `execute`. This is in a first-party utility factory (`intentRouter`) and is exactly the kind of thing the maintainer is calling out. The handler's only job is to classify input and pack it into an envelope; the right shape is a sequencer with `.then(classifier).then(packEnvelope)`. Notably, the surrounding code already returns a sequencer at the end of the factory — the inner handler does the LLM call inline rather than as a step.

2. `packages/tasks/src/helpers/dispatch-and-execute.ts:142` — `await worker.run(workerInput, ctx)` inside the `dispatchAndExecute` free function. The file's own header comment (lines 122–124) explicitly endorses calling this from a handler's `execute`: *"This is a free function rather than a block factory so patterns can call it inline inside their own handler `execute` bodies."* This is documented design intent. It is also a documented contradiction with BP-011's spirit. As of today no in-tree pattern actually calls `dispatchAndExecute` from a handler — only tests do — so the design endorsement has not yet produced field violations, but the helper as shipped is a loaded gun.

3. `packages/thought-fabric-core/src/identity/*.ts` and `metacognition/bias-detection-blocks.ts` — multiple `*.run(...)` references in **JSDoc only** (`@example` blocks). Not violations in code, but they teach users that `block.run(...)` is a normal calling convention from outside a sequencer. That's the wrong DX hint.

**Net audit:**

- One real production violation in `@flow-state-dev/core` (`intent-router.ts`).
- One sanctioned-by-design helper in `@flow-state-dev/tasks` (`dispatchAndExecute`) that exists specifically to enable handler-internal block calls. No active in-repo callers, but the docstring teaches the anti-pattern.
- Doc-comment teaching of `block.run(...)` as a user-facing API in `thought-fabric-core` examples.
- Zero violations in `examples/`, `apps/`, the `patterns/` runtime code, or any user-facing demo.

The leak is small in volume but architectural in shape: the framework ships the abstraction, ships at least one violator inside `core/`, and ships a helper whose stated purpose is to make the violation easier.

---

## 2. Why does the temptation exist?

The maintainer's framing — "LLMs and code want to do this" — is structurally correct. The temptation is built into the type system.

**`BlockDefinition.run(input, ctx)` is public.** From `packages/core/src/types/block.ts:427`:

```ts
export interface BlockDefinition<...> {
  ...
  run(input: TInput, ctx: BlockContext): Promise<TOutput>;
  ...
}
```

`run` is the substrate's dispatch hook *and* part of the type. Anyone holding a `BlockDefinition` reference — which includes anyone who imported it as a value from another module — can call `.run(input, ctx)`. The handler's `ctx` is a `BlockContext`, which is exactly what `run` accepts. The two halves match. Nothing in the type system or the runtime stops the call.

**The handler `ctx` does not expose `.run` directly.** I read `BlockContext` (lines 105–300 of `block.ts`). It exposes scopes, resources, emitters, capabilities, runtime hooks (internal), targets, and `getBlockOutput` / `getBlockResult` accessors. There is no `ctx.runBlock(...)` or equivalent. The temptation comes entirely from external block references (imports), not from the handler's own context surface.

That is good news for enforcement — the handler's `ctx` is already innocent. The bad news is that the framework cannot remove `.run` from the public block type without breaking every test, the CLI's `fsdev block run`, and the substrate dispatch path that uses the same surface. The dispatch surface and the user-callable surface are the same method.

This is the architectural shape of the problem: the public block type doubles as the substrate's invocation interface, so you cannot hide one without hiding the other.

---

## 3. Enforcement options, ordered by aggressiveness

### Tier 0 — documentation-only (status quo plus)

Update BP-011 from "handlers must not call generators internally" to "handlers must not invoke any block via `.run()`." The current BP-011 only forbids generators; that's a holdover from when the rule was about losing tool-loop instrumentation. The maintainer's broader claim deserves its own rule. Cost: zero. Effect: marginal — the rule already exists in spirit but slips because it isn't crisp.

### Tier 1 — lint rule

Ship a project ESLint rule (`@flow-state-dev/eslint-plugin/no-block-run-in-handler`) that flags `.run(` calls inside any object literal property called `execute` whose enclosing call is `handler({...})`. The pattern is structural and tractable for a no-restricted-syntax / TSESLint walker. Real-world false positives:

- `array.run` exists in user code? Trivially scoped — only flag when the receiver's TS type is a `BlockDefinition`. Use `@typescript-eslint/utils` and check the resolved type via `getTypeAtLocation`.
- `dispatcher.claim`, `worker.run` (in `dispatchAndExecute`'s body, which is *not* inside a handler): the rule's enclosing-`handler({})` requirement excludes free functions automatically.

Cost: ~150 LOC for the rule + tests. Effect: catches the `intent-router.ts:78` case at PR time. Catches LLM-generated code at edit time. Doesn't catch users who don't run lint.

### Tier 2 — type-level firewall

Currently both substrate and user code see the same `BlockDefinition.run(input, ctx)`. Split the type:

```ts
// Public surface — what users hold
export interface BlockDefinition<TIn, TOut> {
  kind: BlockKind;
  name: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  // No .run on the public type.
  connectInput<...>(...): BlockDefinition<...>;
  connectOutput<...>(...): BlockDefinition<...>;
}

// Internal surface — what the runtime sees
export interface BlockRuntime<TIn, TOut> extends BlockDefinition<TIn, TOut> {
  /** @internal */
  _run(input: TIn, ctx: InternalBlockContext): Promise<TOut>;
}
```

Substrate (`executeBlock`, `sequencer`, `router`, `generator` tool loop) imports the `BlockRuntime` type and casts at the boundary. Users who import a block from `@flow-state-dev/core` see the `BlockDefinition` type, which has no `_run` and no public `run`. Calling `someBlock.run(input, ctx)` from a handler becomes a TS error.

The CLI's `fsdev block run` is substrate too — it has legitimate use of `_run`. Same for testing harnesses. Both can import the runtime type.

A complication: `connectInput`/`connectOutput` return `BlockDefinition`; the substrate must rebuild a `BlockRuntime` when these are called. That's a small refactor in `buildBlock.ts`.

Cost: focused refactor of `buildBlock.ts`, the four block factory files, the substrate sites that call `.run`. Maybe 300 LOC touched. No public API change for users — they couldn't call `.run` from a handler legitimately anyway. Effect: makes the violation a type error. Catches every case at compile time.

This is the right answer if the maintainer wants *enforcement*, not *guidance*. The cost is low and the effect is total.

### Tier 3 — runtime guard

Have `_run` (or whatever the substrate hook becomes) detect that it's being invoked inside another block's execute and throw. The runtime can stamp a `Symbol(insideExecute)` onto the ctx before calling user code and check for it on entry. Throws `BlockNestingError` with a message pointing at BP-011 and the sequencer recipe.

This catches cases the type system might miss (users casting through `any`, or framework code that imports the runtime type for legitimate reasons but accidentally mis-uses it). It also gives a clear, actionable error message at runtime.

Cost: ~30 LOC in `executeBlock` and `BlockContext`. Effect: catches violations that slipped past TS. Slightly increases per-call overhead (one symbol read).

### Tier 4 — DX rename

Rename `.run` to `._run` or `.__execute` on the type. Even users who try to call it have to write `block.__execute(...)`, which is visibly internal. Combined with Tier 2, this is belt-and-braces.

Cost: search-and-replace in substrate code. Effect: psychological — the API stops *looking* user-facing. Mostly redundant once Tier 2 lands.

### Tier 5 — accept and require idempotency

Drop the rule. Document that handlers can call blocks freely but warn that handler bodies must be idempotent because a future durable resume runtime (FIX-141, already on the roadmap per `execution-and-errors.md:228`) will re-execute them. This is the Inngest stance: orchestration code re-runs on replay; only `step.run(...)` boundaries are durable.

This works *only if* the framework commits to making sequencer step boundaries the only durable checkpoint and tells users that handler internals are best-effort. Today `state_snapshot` is emitted at sequencer step boundaries (`execution-and-errors.md:232`), which is the right primitive — but the framework hasn't told users their handlers must be idempotent. Adopting this stance means a substantial doc and education effort, plus a clear rule for tool calls inside handlers (those are non-idempotent by default and must be wrapped).

Cost: high in education, low in code. Effect: trades crispness for flexibility. Loses the DX win of "you can't write a wrong handler."

---

## 4. How do durable-execution frameworks handle this?

The maintainer is right that this is the same problem Inngest, Trigger.dev, and Vercel Workflows solve. Their answers diverge.

**Inngest** uses `step.run(name, fn)`. The function passed to `step.run` is the durable unit. Code outside `step.run` (in the surrounding orchestration function) re-runs on every replay. Inngest documents this loudly: *"any code in your function that's not inside a step will re-run when the function is retried."* They don't try to prevent users from doing non-idempotent work in orchestration code. They tell users not to. The discipline lives in the rule, not in the type system.

**Trigger.dev v3** uses `task` and `subtask`, with `tasks.triggerAndWait()` for durable child tasks. Non-task code in a task body is similarly best-effort on retry. Same discipline-via-documentation stance.

**Vercel Workflows** (`@vercel/workflow`, the workflow runtime in the AI SDK 5 era) uses `step.do(name, fn)` and a checked rule that orchestration code must be deterministic. The runtime detects non-determinism on replay (a different result for the same step) and surfaces it as an error.

**Temporal**, the heavyweight reference, goes further: workflow code is run in a sandbox that mocks I/O calls, so non-deterministic code throws at runtime. Activities (the equivalent of `step.run`) are the only place I/O is allowed.

Across these systems, the consistent pattern is:

- A clear category split: orchestration vs. unit-of-work.
- Replay-safe orchestration; arbitrary I/O in unit-of-work.
- Enforcement strength varies from "documentation" (Inngest) to "sandbox" (Temporal).

`@flow-state-dev`'s sequencer is the orchestrator. Handlers and generators are the unit-of-work. The framework already has the right shape. What it lacks is the same discipline — and unlike Inngest, it has an opportunity to enforce by type rather than by rule, because the orchestration layer is a separate kind from the unit-of-work layer (`sequencer` vs. `handler`/`generator`/`router`).

The honest call: *the framework should pick its lane.* Either:

- **Strict (Temporal-style with TS enforcement):** handlers can never call blocks. Tier 2 + Tier 3 enforcement. Sequencers are the only composition primitive. This is the cleanest answer for the framework's stated four-block taxonomy.
- **Permissive (Inngest-style with rules):** handlers can call blocks but must be idempotent. This requires the FIX-141 durable resume runtime to land *with* a clear contract that handler internals re-run.

The hybrid (today) — discipline rule that the framework itself violates — is the worst of both worlds.

---

## 5. Re-examining the original review's claim

The review's `02-architecture-coherence.md:41`:

> "the line 'should this be a handler or a sequencer' is genuinely ambiguous in practice."

The maintainer's pushback is sharper: **handlers are leaves; sequencers compose; if you're asking "handler or sequencer" you're really asking "leaf or composer," and that question isn't ambiguous if you know whether the body calls other blocks.**

I think the maintainer is mostly right and the review's framing is slightly wrong. Here's the refinement:

The ambiguity the review identified ("handler with multiple awaits vs. three sequenced handlers") is a real question, but it isn't between handler and sequencer kinds — it's about **observability granularity**. A handler that does three async I/O calls (`fetch`, `parse`, `transform`) is one block in the trace; the same logic as three sequenced handlers is three blocks. That's a design choice about how much you want to see in devtools and what you want retry/rescue to apply to. It's not ambiguity in the type system.

The genuine ambiguity is what BP-011 forbids: *can a handler call another `BlockDefinition`?* If the framework removes that affordance (Tier 2 + 3), the answer is "no, never" and the question stops being ambiguous. Handlers do bounded work with their own ctx. Sequencers compose. Routers dispatch one of N. There is no overlap.

Said differently: today `handler` is overloaded as both "leaf operation" and "imperative orchestration escape hatch." The original review noticed the overload. The maintainer's fix is to remove the escape hatch.

I'd validate the review's claim as: the ambiguity is real *only because the type system permits the escape hatch*. Fix that and the four-kind taxonomy is genuinely clean.

---

## 6. Concrete API design proposal

Goal: a handler's `ctx` should not, by construction, allow it to invoke another block. State, resource, emit, and capability access should remain.

The design today already has the right shape on `ctx` — `BlockContext` exposes no `runBlock` accessor. The leak is on `BlockDefinition.run`, which handlers can reach via module imports.

The minimum-viable change:

```ts
// packages/core/src/types/block.ts

/** Public block type. No run() method. */
export interface BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  readonly kind: BlockKind;
  readonly name: string;
  readonly description?: string;
  readonly transient: boolean;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly declaredResources?: DeclaredResources;
  readonly requiresOrg: boolean;
  readonly config: BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>;

  connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<...>;
  connectOutput<TTo>(mapper: (output: TOutput, ctx: BlockContext) => TTo | Promise<TTo>): BlockDefinition<...>;
}

/** @internal Substrate dispatch surface. Not exported from index.ts. */
export interface BlockRuntime<...> extends BlockDefinition<...> {
  /** @internal */
  _run(input: TInput, ctx: BlockContext): Promise<TOutput>;
}

/** @internal Branded helper used by substrate to recover the runtime view. */
export function asRuntime<T extends BlockDefinition<any,any,any,any>>(b: T): BlockRuntime<...> {
  return b as unknown as BlockRuntime<...>;
}
```

`buildBlock.ts` keeps producing the same object; it just types the return as `BlockDefinition`. Substrate calls `asRuntime(block)._run(input, ctx)`. The CLI imports `asRuntime` from `@flow-state-dev/core/internal`. Tests get an exported `runForTest(block, input, ctx)` helper.

A handler that tries to do `await otherBlock.run(input, ctx)` gets a TS error: *"Property 'run' does not exist on type 'BlockDefinition'."* Combined with a runtime guard (Tier 3), even a cast through `any` throws.

What this preserves on the handler `ctx`:

- All scope handles (`request`, `session`, `user`, `org`).
- Resource registry.
- All emitters (`emitMessage`, `emitComponent`, `emitStatus`, `emitContainer`, etc.).
- `cap` namespace for capability helpers.
- `signal`, `attempt`, `parent`, `targets`, `getBlockOutput`/`getBlockResult`.

What this removes:

- The ability to invoke `someBlock.run(input, ctx)` from anywhere user code holds a block reference.

What this still allows (and probably should):

- Calling pure helper functions (`dispatchAndExecute` if it stops calling `.run` internally; or its rewrite as a sequencer).
- Calling LLM SDKs directly. This is intentional — the framework cannot prevent this and shouldn't try. A user who calls `generateText` from `ai` inside a handler bypasses the generator instrumentation, but that's a different problem (one BP-011 already names, narrowly).

---

## 7. What about `dispatchAndExecute`?

This helper deserves a separate decision. Today it is a free function whose docstring tells callers to invoke it inside handler bodies. It calls `worker.run(input, ctx)`.

Options:

1. **Delete it.** Replace each caller with the sequencer recipe: `claim → run worker → record result`. The substrate API is good enough that this is straightforward. Cost: rewrites the 5 patterns that document it as a substrate. Benefit: the temptation goes away.
2. **Replace with a block factory.** `dispatchAndExecuteBlock({ collection, dispatcher, workers })` returns a sequencer. Patterns compose it as `.then(dispatchAndExecuteBlock(...))`. Cost: small. Benefit: keeps the substrate, removes the handler-internal call site.
3. **Keep it but refactor internally to not invoke `worker.run`.** Have it return a sequencer-shaped recipe descriptor that callers compose. Cost: API change for the helper. Benefit: helper still exists; no longer carries the violation.

I'd take option 2. The helper is genuinely useful as a substrate; the only problem is its current shape encourages the anti-pattern.

---

## Path forward — ranked by impact-vs-cost

1. **Tier 1 (lint rule) + fix the existing violation in `intent-router.ts`.** Two days of work. Catches future LLM-generated and human-written violations at PR time. The existing violation gets fixed in the same change.

2. **Tier 2 (type-level firewall — rename public `.run` to internal `_run`).** One focused week. Makes the violation a TypeScript error in the entire codebase and for every consumer. Catches the cases lint misses and removes the temptation entirely.

3. **Replace `dispatchAndExecute` with a block factory (option 2 above).** Small, but removes the framework's own most-explicit endorsement of handler-internal block calls. Pair with Tier 2.

4. **Tier 3 (runtime guard).** Cheap belt-and-braces for `any`-cast escapes. Add the symbol stamp + check.

5. **Update BP-011.** Broaden from "no generator calls" to "no block calls." The existing rule is now a special case. Sequencer recipe is the only way.

6. **Doc update across `thought-fabric-core` examples.** Stop showing `block.run(...)` as a user-facing call shape in `@example` blocks.

7. **(Optional, longer term)** Decide whether to commit to the Inngest-style permissive stance once FIX-141 lands, or to stay strict. The ranked path above is the strict stance; if the framework wants the permissive stance instead, items 1–3 still help, but the ceiling is lower and discipline relies on documentation.

The original review's "handler vs sequencer is genuinely ambiguous" claim should be retired in favor of: **the four-kind taxonomy is clean if and only if handlers cannot call blocks.** Today, they can. Tier 2 closes that hole at type-system cost, not API cost. That's the cheapest correct move.
