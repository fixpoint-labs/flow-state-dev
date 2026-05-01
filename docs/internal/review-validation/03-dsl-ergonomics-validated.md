# DSL Ergonomics — Validation Pass

A second-pass review of the original `02-architecture-coherence.md` and `03-core-package-review.md` claims about the sequencer DSL, plus the universal "schemas required on toy handlers" claim. The maintainer pushed back on three specific points; this validator read the relevant code and does not always agree with the original review.

The short version: two of the three pushbacks land. The schema-requirement claim was wrong. The "collapse five conditional variants into `branch(condition, if, else)`" recommendation does not survive a careful look at what `tap`, `work`, and `then` actually mean in the chain. The "DSL must shrink" framing is right in spirit and wrong in prescription — the real fix is documentation tiering plus a small set of genuine deletions, not a wholesale API cull.

---

## Pushback 1 — `branch(condition, if, else)` as a replacement for `thenIf`/`tapIf`/`workIf`/`exitIf`

### What the existing methods actually do

The five conditional variants have different fluent semantics. The differences are not cosmetic.

`thenIf(condition, block)` — **runs a block conditionally; output replaces the chain value**.
The chain's `TOutput` widens to `TOutput | TNext`. From `sequencer.ts:897-963`, the operation either returns `{ value: output, descriptor: ref }` (condition matched, block ran, new value flows) or `{ value }` (skipped, value passes through). Crucially, the descriptor is a `ref` to the new emitted item only on the matched path.

`tapIf(condition, block)` — **runs a block conditionally for side effects; chain value is unchanged**.
From `sequencer.ts:1538-1585`. The block's output is awaited but discarded. The next step receives the *original* `TOutput`, not the tap result. `tapIf` also accepts a plain function (not just a block), which `thenIf` doesn't.

`workIf(condition, block)` — **dispatches a background side-chain conditionally; main chain value is unchanged and not blocked**.
From `sequencer.ts:1389-1440`. The block runs in a separate `executeBlock(..., { phase: "work" })` that pushes its promise onto `runtime.workTasks`. The main chain returns `{ value }` immediately, before the block has finished. Background failures emit `step_error` items but do not abort the parent.

`exitIf(condition)` — **terminates the chain when the condition holds**.
The current value becomes the sequencer output. There is no "else block" — the alternative is "continue the chain."

These four methods sit on three fundamentally different points along two axes:

| Method | Output replaced? | Main chain blocks on it? |
|--------|------------------|--------------------------|
| `thenIf` | yes (when matched) | yes |
| `tapIf` | no | yes |
| `workIf` | no | no |
| `exitIf` | n/a (terminates) | n/a |

A unified `branch(condition, ifBlock, elseBlock)` resembling a normal if/else cannot express any of `tapIf`, `workIf`, or `exitIf`. It can only express `thenIf` (with an extra arm).

### What `branch` actually is in the framework today

Worth correcting the original review's framing here. `branch` already exists (`sequencer.ts:1601-1641`) and it is **not** `branch(condition, if, else)`. It is multi-arm:

```ts
pipeline.branch({
  urgent: [(input) => input, (input, ctx) => input.priority === "high", urgentBlock],
  normal: [(input) => input, (input, ctx) => input.priority !== "high", normalBlock],
});
```

Each arm is a `[connector, condition, block]` tuple. The first arm whose condition is truthy runs. If none match, the operation **throws** `"branch had no matching route"`. The output type is `BranchStepOutput<TBranches[keyof TBranches]>` — a union of all arm output types.

Real-world usage of `branch`: zero non-doc callers in `apps/`, `examples/`, and `packages/patterns/src/`. The two hits are both documentation. The cousin `thenIf` has 22 callers. The framework already has a "multi-path conditional" primitive that nobody uses, while the binary `thenIf` carries the actual conditional load.

### A toy `branch(condition, ifBlock, elseBlock)` rewrite

Suppose we tried to add this overload to subsume `thenIf`:

```ts
branch<TIfOut, TElseOut>(
  condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
  ifBlock: BlockDefinition<any, TIfOut>,
  elseBlock?: BlockDefinition<any, TElseOut>
): SequencerDefinition<TInput, TIfOut | TElseOut | TOutput>
```

To replace `thenIf`, you call `branch(cond, block)`. Output type widens. Fine. But to replace `tapIf`, you'd need:

```ts
branch(cond, sequencer().tap(block))   // and somehow signal "discard output"
```

…which doesn't work, because a sub-sequencer's output *is* the chain output by construction. There is no syntactic switch that says "run this branch but throw away the result." You'd have to introduce a `mode: "tap" | "then" | "work"` parameter, which is not "cleaner than `thenIf`" — it is a mode-flagged version of all four methods at once, with looser typing because the mode isn't reflected in the type system without further machinery.

To replace `workIf`, the same problem arises plus a lifetime issue: `work` is non-blocking, so a `branch` that took a `work`-mode arm would have to internally refrain from awaiting the result and instead push the promise to the runtime's workTasks queue. That's `workIf` with a different name and a less obvious shape.

The honest version of "unify into `branch`" looks like:

```ts
pipeline.branch(condition, {
  if: { mode: "then", block: blockA, connector? },
  else: { mode: "tap", block: blockB }
});
```

…which is more verbose than the four current methods combined for any single use site, and weakens the type-level guarantee that a `tap` arm doesn't change the chain output.

### Verdict on Pushback 1

**The maintainer is right.** `branch(condition, if, else)` is not a credible replacement for the `thenIf` / `tapIf` / `workIf` / `exitIf` family. They differ in their fluent semantics, and the differences are exactly the things that make the DSL useful: the chain knows whether the next step receives the original value or the new one, whether it waits for the side chain, and whether the chain even continues.

The original review's recommendation to "fold all five conditionals into one `branch`" is incorrect. The cleanest position is: keep the conditional variants because they encode different chain semantics in different methods, which is what types and fluent APIs are *for*.

A weaker version of the recommendation does survive: the multi-arm `branch({ key: [conn, cond, block] })` shape has zero non-doc callers and could go away. Use cases for it look identical to a chain of `.thenIf()` with mutually exclusive conditions, and the failure mode (throw on no match) is rarely what an author actually wants.

---

## Pushback 2 — Schemas are optional with `z.any()` defaults

### What the code actually does

From `packages/core/src/blocks/internal/build-block.ts:131-132`:

```ts
const resolvedInputSchema = (config.inputSchema ?? z.any()) as TInputSchema;
const resolvedOutputSchema = (config.outputSchema ?? z.any()) as TOutputSchema;
```

That is unambiguous. Handlers, sequencers, and routers do not require `inputSchema` or `outputSchema` to be declared. If absent, they default to `z.any()` and the runtime parses through.

Generators are slightly different. From `generator.ts:1415`:

```ts
const outputSchema = (config.outputSchema ?? z.string()) as ZodTypeAny;
```

Generators default `outputSchema` to `z.string()` (because the AI SDK's text-generation path needs a string-shaped expectation). `inputSchema` is still optional with the `z.any()` default coming from `build-block`.

### What this means for the original review

The original review never quite said "schemas are required at runtime." But it claimed (`02-architecture-coherence.md:17`):

> handler `inputSchema?: ZodTypeAny; outputSchema?: ZodTypeAny;`

…and then critiqued the framework for forcing schema declarations everywhere by listing 21 sequencer methods and the schema-bubbling subsystem. The maintainer's reading is that the review was implicitly treating schemas as ceremony when they are in fact opt-in.

**Concrete confirmation:**

```ts
// This compiles and runs:
const echo = handler({
  name: "echo",
  execute: async (input) => input,   // input is `unknown`, output is `unknown`
});
```

The handler has no `inputSchema`, no `outputSchema`. `build-block.ts` substitutes `z.any()`. The block runs.

The cost of skipping schemas:

1. **Type inference is gone.** `input` is `z.infer<z.ZodAny>` which is `any`. You lose the headline benefit of the framework — typed end-to-end composition.
2. **Runtime validation is gone.** Whatever shape the previous step emits flows through unchecked. You only find out at the LLM call (or the database write, or the UI render) that the shape was wrong.
3. **Inference into `clientData`, `targetStateSchemas`, capability merging** — anywhere a downstream type depends on this block's I/O — silently widens to `any`.

So the maintainer's framing is correct: schemas are not required for runtime, they are required for *types*, and the type inference is the entire point of declaring them. The review's complaint about schema ceremony on toy handlers reads as a misread of what is mandatory and what is "you bought into the framework's type story."

That said, there is a minor caveat. The `quick-start.md` example still declares `inputSchema: z.string()` and `outputSchema: z.string()` on the counter handler. A reader might reasonably conclude that these are required because every example shows them. The fix is editorial (a "minimal handler" snippet that omits both) rather than API surgery.

### Verdict on Pushback 2

**The maintainer is right and the original review was wrong on this point.** Schemas are optional. Defaults are `z.any()` (handler/sequencer/router) and `z.string()` (generator output). The friction the review described isn't an API requirement — it's the cost of opting into the type system, which is what people use the framework for.

What the review should have said: docs lean too heavily on full-schema examples, when a "no schemas at all" minimal handler would teach the four-block taxonomy faster. That's a docs change, not an API change.

---

## Pushback 3 — Progressive disclosure, not API removal

The maintainer's framing: the framework is allowed to be deep. The question is whether you can teach a beginner to `then` / `tap` / one conditional / `forEach` / `rescue` and have everything else live in a "you'll find this when you need it" tier of the docs.

### Per-method classification

Numbers below are real-world callers in `apps/kitchen-sink/flows`, `examples/hello-chat`, and `packages/patterns/src/`. Doc files are excluded.

| Method | Real callers (apps + flows) | Pattern callers | Total | Classification |
|---|---|---|---|---|
| `then` | 11 | many | 299 | **ESSENTIAL** |
| `map` | 15 | many | 184 | **ESSENTIAL** |
| `tap` | 10 | many | 91 | **ESSENTIAL** |
| `work` | 5 | many | 79 | **ESSENTIAL** (also defines `.background()` alias) |
| `thenIf` | 1 | many | 22 | **ESSENTIAL** |
| `parallel` | 0 | 22 | 22 | ADVANCED-BUT-KEEP |
| `forEach` | 0 | 21 | 21 | ADVANCED-BUT-KEEP |
| `rescue` | 0 | 20 | 20 | **ESSENTIAL** (concept, not call count) |
| `workIf` | 1 | 13 | 13 | ADVANCED-BUT-KEEP |
| `waitForWork` | 0 | 11 | 11 | ADVANCED-BUT-KEEP |
| `loopBack` | 0 | 8 (3 patterns) | 8 | ADVANCED-BUT-KEEP |
| `doUntil` | 0 | 7 | 7 | ADVANCED-BUT-KEEP |
| `tapIf` | 3 | 6 | 6 | ADVANCED-BUT-KEEP |
| `forEachBackground` | 0 | 6 | 6 | ADVANCED-BUT-KEEP |
| `exitIf` | 0 | 5 | 5 | ADVANCED-BUT-KEEP |
| `background` | 0 | 4 | 4 | **REDUNDANT-ALIAS** (delete) |
| `thenAll` | 0 | 4 | 4 | RARELY-NEEDED (consider deletion) |
| `doWhile` | 0 | 3 | 3 | ADVANCED-BUT-KEEP (parity with `doUntil`) |
| `branch` | 0 | 2 | 2 | RARELY-NEEDED (consider deletion) |
| `thenAny` | 0 | 2 | 2 | RARELY-NEEDED (consider deletion) |
| `race` | 0 | 2 | 2 | RARELY-NEEDED (consider deletion) |
| `validate` | 0 | 0 | 0 | **DELETE** (broken heuristic, no callers) |

### Notes on the classifications

**`background` is a literal alias for `work`.** From `sequencer.ts:1381-1387`:

```ts
background<TStepIn>(arg1, arg2?, arg3?) {
  return definition.work(arg1 as any, arg2 as any, arg3 as any);
}
```

That is duplication, not progressive disclosure. The doc rationale ("`background` reads more naturally in fan-out contexts") is style; if the chain reads better with a different verb, the user can write a one-line wrapper. Cost of keeping it: every contributor learns two names for one thing. Recommendation: deprecate, then remove.

**`validate` is broken.** `sequencer.ts:1859-1889` walks `_def?.typeName` to compare declared vs actual. The original review confirmed this fails for `ZodEffects`, `ZodOptional`, `ZodDefault`. Zero callers. Classic dead code.

**`loopBack` is genuinely used.** Original review claimed it was "a feature looking for a use case." That's wrong. Three patterns use it: `task-board`, `routedSpecialists`, `plan-and-execute` — three of the most realistic agentic-loop patterns the framework ships. The pattern is "after a series of steps, return to a named earlier step until convergence," which is exactly what plan-and-execute loops need. `doUntil` doesn't model this — `doUntil` re-runs *one* block until a condition; `loopBack` re-runs *the segment between two named steps*. Different shape. Keep it. Demote it in the docs to "Advanced control flow."

**`branch`, `thenAny`, `race` are rarely-needed.** Two callers each, all in patterns. `thenAny` and `race` are sequential-vs-concurrent variants of "first-success-wins." `branch` is a multi-arm conditional with a throw-on-no-match failure mode that's almost always not what authors want. These are real features but the cost-benefit is questionable: each adds a public surface that beginners must skip past, and the use cases (provider fallback, parallel speculation, multi-arm dispatch) are infrequent enough that an inline `try { … } catch` or a `thenIf` chain works.

**`thenAll` overlaps `parallel`.** The doc explicitly says "use `.parallel()` when you need named access; use `.thenAll()` when you have a dynamic list or prefer array indexing." Real usage is 4 vs 22. The dynamic-list case is genuinely awkward in `parallel` (you'd build the keys yourself). Keep `thenAll` as advanced.

### What progressive disclosure looks like

The five-method beginner tier:

1. `.then(block)` — sequential.
2. `.map(fn)` — pure transform.
3. `.tap(block)` — side effect.
4. `.thenIf(cond, block)` — conditional run.
5. `.rescue([{ when, block }])` — error recovery.

A flow author with these five can build 80% of the kitchen-sink. Add `.work()` for the "fire-and-forget analytics" use case and you cover essentially every quick-start example.

The advanced tier (kept in the API, demoted in the docs to a "Control flow reference" page):

`forEach`, `forEachBackground`, `parallel`, `thenAll`, `doUntil`, `doWhile`, `loopBack`, `workIf`, `tapIf`, `exitIf`, `waitForWork`.

The deletion tier:

`validate` (broken, zero callers), `background` (alias for `work`).

The "consider deletion" tier (rarely-used, not deeply integrated):

`branch` (multi-arm; zero non-pattern callers; arguably replaceable with chained `thenIf` or a router), `thenAny`, `race`.

This is **not** "cut from 21 to 8-10." It is "cut from 22 to 19, and reorganize the docs so a reader sees 5 of them in the first hour."

---

## Pushback 4 (interpretation) — Documentation tiering vs API removal

The original review's specific complaint about the DSL was (`01-newcomer-dx.md`, paraphrased by the synthesis): "the docs present all 22 with no 'you only need three of these' guidance."

That's a docs problem. The proposed fix in the same review was an API problem ("cut to 8-10"). The two don't match.

Reading `apps/docs/docs/sequencers/control-flow.md` and `side-chains.md`, the docs do present every method with roughly equal weight. There is no "minimal vs advanced" structure. A first-time reader scrolling through `control-flow.md` sees `branch`, `thenAny`, `race`, `exitIf`, `loopBack` interleaved with `then`, `map`, `tap`. No signal that the first five are advanced.

The fix: **two-tier reference docs.**

1. **A "Composing blocks" page** that teaches `then`, `map`, `tap`, `thenIf`, `rescue` end to end with worked examples. This is the page a beginner reads in their first hour.
2. **A "Control flow reference" page** that catalogs the rest: parallelism, looping, side chains, branches. The reader gets here when they have a specific problem.
3. **Remove `validate` and `background` from the public API.** These aren't progressive disclosure; they are stale.

The framework keeps depth. The first-hour experience stops feeling overwhelming. Power users still have everything.

---

## Refined DSL recommendation

### Stays in the API, surfaced in the beginner docs

`then`, `map`, `tap`, `thenIf`, `work`, `rescue` — six methods covering every quick-start and most flow definitions in the wild.

### Stays in the API, demoted to a reference page

`parallel`, `forEach`, `forEachBackground`, `thenAll`, `doUntil`, `doWhile`, `loopBack`, `workIf`, `tapIf`, `exitIf`, `waitForWork` — eleven methods covering pattern-level control flow, error-handling specialization, and concurrent execution.

### Goes away

- `validate` — broken heuristic, zero callers, deletes cleanly.
- `background` — pure alias for `work`, deletes cleanly. Ship a deprecation warning for one minor version, then remove.

### Reconsider, don't rush

- `branch` — zero non-doc callers in the multi-arm form. Could go, but worth letting it sit until the docs are tiered to see if the absence of a "match-style multi-arm" is felt.
- `thenAny` / `race` — two callers each. Specialized but real. Demote in docs and reassess in 6 months.

### Net change

- API: 22 methods → 20 methods. (`validate`, `background` go.)
- Docs: a 22-method-flat-list becomes a 6-method beginner page plus a reference. The advertised cognitive cost on day one drops from 22 to 6 without losing any capability.

### What this rejects from the original review

1. **"Collapse five conditionals into `branch(condition, if, else)`."** Rejected. `tap`, `work`, `then` differ in chain semantics; merging them into a `branch` either drops semantic distinctions or balloons into a mode-flagged super-method that's worse than what's there.

2. **"Cut `loopBack`."** Rejected. Three real patterns use it. The pattern (re-run a named segment) is genuinely distinct from `doUntil`/`doWhile`.

3. **"Schemas are required ceremony on toy handlers."** Rejected. They are optional with `z.any()` defaults. The fix is a "minimal handler" doc snippet, not API surgery.

4. **"DSL must shrink from 21 to 8-10."** Rejected as a hard count. The cleaner framing is documentation tiering (6 essential, 11 advanced, 2 deletions) and revisiting 3 rarely-used methods after a docs pass.

### What this accepts from the original review

1. **`validate` is dead.** Delete.
2. **`background` is a pure alias.** Delete.
3. **The DSL implementation has duplication.** The Tier 2 internal refactor (extract `runChild`, `runBackground`, `resolveCallShape` helpers) still makes sense. That's about implementation, not public surface.
4. **Beginner docs are flat and overwhelming.** Tier them.

---

## Closing call

The maintainer's pushback was substantive on every point. Schemas are not required ceremony. Conditional variants are not redundant aliases — they encode chain semantics that `branch(cond, if, else)` cannot subsume without becoming a worse version of the same thing. The "21 → 8" prescription was the right diagnosis (cognitive overload on first read) with the wrong treatment (API removal).

The framework's stated goal — "easy to get started, advanced when you need it" — is achievable here with editorial work and two specific deletions. The other 19 methods can stay. They earn their keep at the pattern level even when they don't show up in `apps/kitchen-sink`.

Where the original review was strongest was in identifying *implementation* bloat: 1,934 LOC for the sequencer file, 12 methods re-implementing child-path derivation inline, the `block.kind === "generator"` special case leaking from generator into sequencer. Those critiques stand and the recommended internal refactor (Tier 2 in the synthesis) does not change the public API. That work is still worth doing.

Where the review overreached was in conflating "the docs present too much at once" with "the API has too much in it." Those are different problems. The first is a docs problem and the fix is tiering. The second is an API problem and the fix here is small: two methods out, the rest stay.
