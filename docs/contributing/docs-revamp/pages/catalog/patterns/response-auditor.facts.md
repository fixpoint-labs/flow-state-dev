# Response Auditor: fact sheet (K-27)

Page: `catalog/patterns/response-auditor`, type `catalog`, kept, 1,000 words.
Questions it answers: what does an analyzer return, where does the audit show, how do you add your own analyzer.
Examples: the auditor after a generator; a custom analyzer.

Sources cited: the exported surface (`packages/patterns/src/response-auditor/`), its test
(`packages/patterns/test/response-auditor.test.ts`), the goal
(`goals/response-auditor/emits-audit-annotation/goal.md`), the ui renderer
(`packages/ui/registry/components/audit-annotation.tsx`, `chat-assistant.tsx`), one example that uses it
(`apps/kitchen-sink/flows/chat-agent/run/bias-check.ts`), the existing page
(`docs/contributing/docs-revamp/pages/catalog/patterns/response-auditor.md`, same body as
`apps/docs/docs/patterns/response-auditor.md`) and other existing user docs and READMEs. Paths are relative to
`packages/patterns/` unless they start with `packages/`, `apps/`, `docs/` or `goals/`.
"index" is `src/response-auditor/index.ts`, "schemas" is `src/response-auditor/schemas.ts`,
"test" is `test/response-auditor.test.ts`.

Facts marked **[ran]** were observed by running the pattern in a throwaway test (deleted afterwards). They are
not covered by the shipped test; the page may state them, and a cold fact check can reproduce them with
`testBlock(responseAuditor({...}))`.

## 1. What it is

1. `responseAuditor(config)` returns a sequencer block named `response-auditor`.
   index:188-229; test:301-308 (`kind === "sequencer"`, `name === "response-auditor"`).
2. It takes a finished answer and the question it answered, and runs it through a list of analyzer
   blocks. Each analyzer scores the answer and annotates it. The auditor collects the results,
   averages the scores, and picks which results to surface. index:1-12, 188-229.
3. It only analyzes. It does not change the response. Page text, existing page line 16; nothing in
   index modifies `response` (the sequencer's output is `{ results, surfacedResults, overallScore }`).
4. Input is `{ userInput: string, response: string }`. schemas:32-35 (`auditorInputSchema`).
5. Input is validated: a missing `response` fails the block with
   `input validation failed at "response": Required`. **[ran]** (test file not covering it;
   `inputSchema` at index:213).
6. It is meant to be attached with `.sideChain()` after a generator, so the answer streams to the user
   first and the audit arrives after. index:1-12, 170-187; existing page lines 58-93; kitchen-sink
   `bias-check.ts` is composed as a `.sideChain(biasCheck)` in
   `apps/kitchen-sink/flows/chat-agent/run/run.ts:50` (`.sideChain(biasCheck)`).
   The auditor is an ordinary sequencer, so `.step()` also works; a step blocks the next step on the audit.
   Existing page "Composability", lines 268-294 (uses `.stepIf` after a `.sideChain`).
7. A side chain's failures do not abort the main pipeline and do not show in the user-visible stream.
   `apps/docs/docs/advanced/sequencer-side-chains.md:11-13, 63-66` ("Work failures never abort the
   pipeline"; "Error isolation").
8. Reach for it when you want a score and annotations on an answer after it is written. If you need to
   rewrite on findings, chain a revision step after it. Existing page lines 11-16.

## 2. What an analyzer is and what it returns

1. An analyzer is any block that takes `{ userInput, response }` and returns an `AnalyzerResult`.
   schemas:59-60 (config doc comment: "Each receives `{ userInput, response }` and returns
   `AnalyzerResult`"); `analyzers` typed `BlockDefinition<any, any>[]` at schemas:60-61, so the compiler
   does not check the analyzer's input or output.
2. `AnalyzerResult` fields. schemas:17-24 (`AnalyzerResultSchema`):

   | Field | Type | Notes |
   | --- | --- | --- |
   | `analyzerId` | string | |
   | `category` | string | |
   | `score` | number, 0 to 1 inclusive | `.min(0).max(1)` |
   | `shouldSurface` | boolean | forces the result into `surfacedResults` |
   | `annotations` | array of annotation | may be empty |
   | `supplementary` | record of unknown, optional | extras the renderer may read |

3. An annotation has `type`, `label`, `description` (strings), `severity` (`"info"`, `"warning"` or
   `"critical"`) and optional `evidence` (string). schemas:7-13 (`AuditAnnotationSchema`).
4. Higher score means more concern. The threshold keeps results whose score is at or above it, and the
   card colors the gauge red as the score rises. index:110-112; `audit-annotation.tsx` ScoreGauge
   (`score < 0.3` info, `< 0.7` warning, otherwise critical; lines 245-247).
5. The results are validated when collected. An analyzer that returns a bad shape does not get dropped
   quietly: the whole auditor fails. **[ran]** With one analyzer returning `score: 2` and another a good
   result, the auditor errored with `Block "aggregate-results" input validation failed at "0.score":
   Number must be less than or equal to 1`; an annotation missing `label` failed with
   `... at "0.annotations.0.label": Required`. Cause is `aggregateResults`' `inputSchema`
   `z.array(AnalyzerResultSchema)`, index:74. Contrast with a thrown analyzer (section 3.3).
   So give a custom analyzer an `outputSchema: AnalyzerResultSchema` to catch the mistake at the
   analyzer. Kitchen-sink does this on its adapter: `bias-check.ts:17-25` (comment at 20-23).
6. `AnalyzerResultSchema`, `AuditAnnotationSchema`, `auditorInputSchema` and
   `responseAuditorStateSchema` are exported from `@flow-state-dev/patterns/response-auditor`.
   index:22-27; `package.json` exports `./response-auditor` (lines 47-49 and 94-96).
   Types `AnalyzerResult`, `AuditAnnotation`, `AuditorInput`, `ResponseAuditorState`,
   `ResponseAuditorConfig`, `DisplayMode` are exported too. index:29-36.
7. The scores `0.3` and `0.7` appear as the card's gauge colour breakpoints and `0.3` as the default
   threshold. They are not part of the analyzer contract.

## 3. What the auditor does with the results

1. Pipeline order. index:211-228:
   `tap(captureContext)` → `map` to one copy of the input per analyzer → `forEach` over the analyzers →
   `map` dropping falsy results → `step(aggregateResults)` → `step(thresholdBlock)` →
   `tapIf(surfacedResults.length > 0, emitAuditAnnotation)`.
   The page should not walk this as a pipeline (mechanism); it is the source for the statements below.
2. Analyzers run in parallel by default. `maxConcurrency` caps how many run at once; with
   `maxConcurrency: 1` all three of three analyzers still ran. index:220-224; schemas:68-69;
   test:263-282.
3. A thrown analyzer is skipped. Each analyzer is wrapped with `.rescue()` onto a fallback that returns
   `null`, and nulls are filtered out. The auditor does not fail, the other analyzers' results are
   kept, and there is no entry for the failed analyzer in `results`. index:153-158, 193-199, 225;
   test:220-240 (echo + throwing analyzer → `error` null, `results` length 1, id `echo`).
   Nothing in the output records which analyzer failed. The failure shows in the DevTool trace
   (`apps/docs/docs/advanced/sequencer-side-chains.md:63-66`: "the failed `block_trace` reaches the
   DevTool via the trace channel").
4. `overallScore` is the mean of the scores of the results that came back (failed analyzers are not
   counted). Two analyzers scoring 0.5 and 0.9 give 0.7. With no results it is 0.
   index:81-84; test:132-154 (0.5, 0.9 → 0.7), test:385-402 (empty list → 0).
5. `threshold` defaults to 0.3. index:189; schemas:62-63; test:284-299 (a 0.1 result is filtered by the
   default).
6. A result is surfaced when its `shouldSurface` is true or its `score` is greater than or equal to the
   threshold. Equality surfaces. index:110-112 (`r.shouldSurface || r.score >= threshold`);
   **[ran]** score 0.3 at threshold 0.3 surfaced. `shouldSurface: true` surfaces a 0.05 result at
   threshold 0.5 (test:182-218). The existing page says "above"; the code is "at or above".
7. `results` holds every result; `surfacedResults` holds the subset. A threshold that filters everything
   leaves `surfacedResults` empty and `results` full. test:156-180, 242-261.
8. Output shape: `{ results: AnalyzerResult[], surfacedResults: AnalyzerResult[], overallScore: number }`.
   index:103-107, 116-120; test:107-130.
9. An empty `analyzers` list is valid: `results` and `surfacedResults` are empty and `overallScore` is 0.
   test:385-402.
10. Analyzer order in `results` follows the order of the `analyzers` array (each analyzer is picked by
    index in `forEach`). index:220-223. Not asserted by a test with more than one result in order; the
    page should not promise it beyond "one result per analyzer".
11. `ResponseAuditorConfig` also declares `displayMode` (`"inline"` or `"message"`) and `alwaysRun`
    (default `true`). Neither is read anywhere in `src/response-auditor/` (grep: only the type
    declaration at schemas:57, 65, 67 and a JSDoc example at index:183). **Do not document them.**
    Flag to the caller: they are inert config on the public type.
12. The state the auditor keeps while it runs holds `userInput`, `response`, `results`,
    `surfacedResults`, `overallScore`. schemas:43-49 (`responseAuditorStateSchema`). See section 7 for
    who owns it.

## 4. Where the audit shows

1. Two paths: a rendered card on the chat surface, and the block's output for code.
2. When at least one result surfaces, the auditor emits a data item whose `dataType` is `audit-annotation`
   and whose `value` is the same `{ results, surfacedResults, overallScore }`.
   index:125-143 (`ctx.emit.data("audit-annotation", input, { itemVisibility: { client: true, history: false } })`, line 141), 228 (`tapIf` on
   `surfacedResults.length > 0`); test:348-366 (one card, `surfacedResults` length 1).
3. When nothing surfaces, no card is emitted. test:368-383.
4. The item is append-only: no `key`, so each auditor run in a request gets its own card and later runs
   do not overwrite earlier ones. index:131-133, 141 (no `key` passed to `emit.data`).
5. A data item is persisted by default (`transient: false`), so the card is still there after a
   page refresh. `packages/core/src/types/block.ts:153-154,514`.
   The `.tapIf` emits from the auditor sequencer, and the emission is a side effect of the block,
   so it reaches the client's item stream like any emitted item. (The emit passes
   `{ client: true, history: false }`, which is also the data default, `packages/contracts/src/items/resolve-visibility.ts:42,52`:
   the card goes to the client and is not put into the model's history.)
6. The renderer is in the `@flow-state-dev/ui` registry as `audit-annotation`.
   `chatAssistantRenderers` maps `data: { "audit-annotation": AuditAnnotation }`, so a chat surface
   built on `chatAssistantRenderers` shows the card with no extra code.
   `packages/ui/registry/components/chat-assistant.tsx:63-66`. The card takes `{ item: DataItem }` and
   reads `item.value` (`packages/ui/registry/components/audit-annotation.tsx:90-91`).
7. Without `chatAssistantRenderers`, install the card with `fsdev ui add audit-annotation` (the docs
   write `pnpm fsdev ui add audit-annotation`) and register it under
   `renderers.data["audit-annotation"]` (`packages/react/src/registry/block-renderers.ts:53-58`). A data
   item no renderer names renders nothing. `packages/react/src/components/ItemRenderer.ts:263-267`.
8. What the card shows. `audit-annotation.tsx`:
   - Header "Response Audit" with a count badge, "N finding(s)", the total annotations across the
     surfaced results (lines 97-121).
   - Severity of the header icon is the highest severity among all annotations of the surfaced results
     (lines 68-77, 97).
   - One section per surfaced result: `analyzerId`, a score gauge with the score as a percent
     (lines 138-160, `ScoreGauge` at 245-247).
   - `supplementary.summary`, if a string, as a line under the header of that analyzer
     (lines 162-166).
   - Each annotation: a severity icon, `label`, `description`, and `evidence` in quotes if present
     (lines 211-240).
   - `supplementary.counterArguments`, if an array of `{ claim, counterpoint, strength }`, in a
     collapsed "N counter-argument(s)" list (lines 181-205).
   - It renders nothing when `surfacedResults` is empty or missing (lines 93-95).
   So `supplementary` is how a custom analyzer gets extra text onto the card: only `summary` and
   `counterArguments` are read; other keys are carried and not shown.
9. The card lists surfaced results only. Results below the threshold are in the output and the item
   data but not drawn. `audit-annotation.tsx:93-101`.
10. The same card data is available to code: the auditor block's output.
    - Inside a `.sideChain()` pipeline, the existing page reads it with `ctx.getBlockOutput(auditor)`
      in a later step (existing page lines 93, 289). `getBlockOutput` is
      `packages/core/src/types/block.ts:435-437` (returns `undefined` when there is no output).
      Not covered by a shipped test or goal for the sideChain case; the goal deliberately does not
      assert on it (`goal.md`, "Anti-game"). **Reconcile in the fact check**: confirm
      `getBlockOutput` of a side-chained block is populated in a later `.stepIf`, or drop the
      `.stepIf` example. If a step needs the verdict, `.waitForSideChain()` is the documented barrier
      (`apps/docs/docs/advanced/sequencer-side-chains.md:97-102`).
    - Used as a normal step, the output is the step's value.
11. The goal confirms the end to end result with a real analyzer: a data item
    `audit-annotation` with a non-empty `surfacedResults` appears in the run's item stream for a
    one-sided response. `goals/response-auditor/emits-audit-annotation/harness.mts:75-76` (matches `type === "data"` and `dataType === "audit-annotation"`).

## 5. Add your own analyzer

1. Any block works if it takes `{ userInput, response }` and returns an `AnalyzerResult`. A handler
   works directly; a generator needs a step after it to build the result. Existing page lines
   184-237; test:22-41 (a handler `echoAnalyzer` with `inputSchema: auditorInputSchema`,
   `outputSchema: AnalyzerResultSchema`).
2. Smallest custom analyzer, no model: a handler. Tested shape (test:22-41, 46-64):
   `handler({ name, inputSchema: auditorInputSchema, outputSchema: AnalyzerResultSchema, execute })`
   returning `{ analyzerId, category, score, shouldSurface, annotations }`.
3. Model-backed analyzer: a sequencer of a generator that returns a typed object, then a handler that
   turns it into an `AnalyzerResult`. Existing page lines 188-228 (`tone/detect` generator with
   `outputSchema` of `{ tone, confidence, issues }`, then `tone/format` handler,
   `.step(detect).step(format)`). A generator with no `itemVisibility` runs silently and its typed
   output is the next step's input (existing page comment, lines 204-205).
   Example code uses `openai/gpt-6-luna`.
4. Add it to `analyzers`: `responseAuditor({ analyzers: [biasAdapter, toneAnalyzer] })`.
   Existing page lines 230-237.
5. Give the analyzer a distinct `analyzerId`. The card keys each result's section by `analyzerId`, so two
   results with the same id collide in the card. `audit-annotation.tsx:127` (`key={result.analyzerId}`).
   Nothing in the auditor enforces uniqueness. (The `analyzers` array and the id are unrelated: an
   analyzer block can return any `analyzerId`.)
6. Name the analyzer block's `name` uniquely too. Existing page uses `tone/detect`, `tone/format`
   (names with a slash are used throughout the kitchen-sink and existing page). Do not state a rule.
7. A throwing analyzer is skipped (3.3). A returned bad shape fails the whole audit (2.5). A cheap
   guard is `outputSchema: AnalyzerResultSchema` on the analyzer's last step, which is what
   kitchen-sink does on the sequencer wrapping `biasAnalyzer` (`bias-check.ts:17-25`).
8. A third-party analyzer whose output differs needs an adapter. The kitchen-sink example wraps
   thought-fabric's `biasAnalyzer` (input `{ userInput, aiResponse }`, output its own schema) in a
   sequencer: `.map` input to `{ userInput, aiResponse }`, `.step(biasAnalyzer({ model }))`, `.map`
   output to `AnalyzerResult` (`bias-check.ts:17-53`; `shouldSurface` set to `score >= 0.3` at line 38;
   `supplementary` carries `summary`, `label`, `sycophancyScore`, `counterArguments` at 46-51).
   `biasAnalyzer` is from `@thought-fabric/core/metacognition`. Decision for the page: link to this
   as the worked adapter; do not teach the six bias types or the bias pipeline (that is
   thought-fabric's page).

## 6. Use it after a generator

1. Wire it as a side chain with a connector that builds `{ userInput, response }`:
   `.step(chat).sideChain((chatOutput, ctx) => ({ userInput, response }), auditor)`.
   Existing page lines 60-91; connector signature `(output, ctx) => payload` per
   `apps/docs/docs/advanced/sequencer-side-chains.md:46-58`. Connector runs in the main thread, only the
   block is backgrounded (same file, line 58).
2. `userInput` from the parent request: existing page uses `ctx.parent?.input?.message`. Kitchen-sink
   does the same in its `.map`: `bias-check.ts:64-69` (`ctx.parent?.input?.message`, cast).
   The auditor requires both fields to be strings; the page's connector must `String(...)` them.
3. `response` must be a string. The existing page stringifies a non-string output
   (`typeof chatOutput === "string" ? chatOutput : JSON.stringify(chatOutput)`, existing page line 87).
4. The kitchen-sink app runs the auditor only when a session feature is on:
   `.stepIf((_input, ctx) => !!ctx.session.state.features.biasCheck, auditor)`
   (`bias-check.ts:70-73`), and itself sits behind `.sideChain(biasCheck)` (`run.ts:50`). A conditional
   audit is a normal `.stepIf` or `.sideChainIf`. (`.sideChainIf` documented at
   `apps/docs/docs/advanced/sequencer-side-chains.md:10`.)
5. Cost to name: every analyzer that calls a model is one more model call per answer, in the
   background. The kitchen-sink app skips the whole audit when its flag is off to avoid them
   (`bias-check.ts:7-8`).

## 7. Stored data (the four questions)

The auditor stores nothing the user owns. It has two stored parts: the sequencer's working state and the
emitted `audit-annotation` item.

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| Sequencer state (`userInput`, `response`, `results`, `surfacedResults`, `overallScore`) | The one run of the auditor sequencer | Nobody reads it back as an app. It streams live as `state_change` items (`apps/docs/docs/advanced/block-state.md:119`), is checkpointed at each step boundary so an interrupted run resumes (`apps/docs/docs/advanced/sequencer-state.md:7, 121-125`), and the final checkpoint is retained for inspection unless `flow.request.cleanupCheckpointsOnTerminal` is set (same file, line 137) | The checkpoint store, keyed by request id and block instance id; latest record only (sequencer-state.md:123) | One per auditor run, overwritten at each step |
| `audit-annotation` data item | The request that ran the audit | The client on the item stream; shown by the registered renderer (`index:141`; `chat-assistant.tsx:63-66`) | The request record, persistent (`block.ts:153-154`) | One per auditor run that surfaces something; none if nothing surfaces. Never replaced by a later run in the same request (append-only, no key: index:131-133) |

The page can state in one line that the audit lives with the request that produced it and is not
saved to session, user or org state. Nothing in `index.ts` writes to session, user or org scope or to a
resource (grep for `session`, `user`, `org`, `resource` in `src/response-auditor/`: no writes).
The auditor adds no resource to the flow.

Nothing is stored between turns: a next turn's auditor starts with the schema defaults (`""`, `[]`, `0`;
schemas:43-49).

## 8. Limits and edges worth a line

1. It does not rewrite the answer (1.3).
2. It does not score by itself: with no analyzers there is no score (3.9) and `overallScore` is 0, which
   a reader may take for "clean".
3. `overallScore` is a plain average, so one 0.9 among four 0.0 reads as 0.18. The per-analyzer scores
   and `shouldSurface` are how a single bad result still shows. Derived from index:81-84.
4. `captureContext`, `aggregateResults` and `applyThreshold(n)` are exported for remixing. index:56,
   72, 164. `captureContext` is composed with `.tap()`, never `.step()`: it returns nothing, so a
   `.step()` hands `undefined` to the next step. index:53-54; test:325-346 (the trace output is an
   empty inline value). Most readers never remix; this is Reference, not the page. `applyThreshold` is
   `createApplyThreshold` exported under another name (index:164).
5. The package's own README says response-auditor is not part of the benchmark, since it is a post hoc
   side chain and not `goal → answer` shaped (`packages/patterns/README.md:337`). Not for the page.
6. The benchmark, the thought-fabric bias pipeline detail, the six bias types and the retired
   `captureContext` echo (existing page lines 180-182, 264) are not on the page: the first two are
   other pages' subject and the last is history.
7. Existing page "Exports" table (lines 239-252) is Reference material: `responseAuditorStateSchema`,
   `captureContext`, `aggregateResults`, `applyThreshold`. Move to the patterns Reference page.

## 9. Reconcile before writing

- Existing page says "above the threshold". Code is "at or above" (3.6). Use the code.
- Existing page and the `responseAuditor` JSDoc example (index:176-186) list `displayMode: 'inline'`.
  `displayMode` does nothing (3.11). Leave it out of the page; JSDoc example is the caller's to fix.
- Existing page shows `pipeline.sideChain(auditor)` with no connector (line 278). That passes the
  pipeline value, which only works when that value is already `{ userInput, response }`. Prefer the
  connector form.
- Existing page "See also" links `./parallelTasks`, `./overview`: old slugs. Use the page-plan slugs
  (`./parallel-tasks.md`, `./supervisor.md`) and the Reference page for exports.
- Existing page says each analyzer is wrapped "in a mini-sequencer with `.rescue()`". The code now puts
  `.rescue()` on the analyzer block itself (index:193-199). Say only that a throwing analyzer is skipped.
- `getBlockOutput(auditor)` after a side chain (4.10) is not covered by a test. Verify or cut.
- Model names in examples: `openai/gpt-6-luna` for small and fast. The existing page's chat generator uses
  `openai/gpt-6.1-sol`; keep only what the one example needs.

## 10. Revise round 1 (page state)

- The page states "at or above" the threshold (3.6) and says only that a throwing analyzer is left out (3.3, 9).
- `getBlockOutput(auditor)` (4.10) is not on the page: unverified for a side-chained block, cut. The page says only that used with `.step()` the output is the next step's input.
- Moved to the patterns reference (R-41) and not on the page: exports table, annotation fields table, bias types, bias block names, `captureContext`/`aggregateResults`/`applyThreshold` detail. `.tap()` against `.step()` is for R-03.
- The bias adapter example (5.8) is `bias-check.ts` retitled into the page's support flow; it adds `outputSchema: AnalyzerResultSchema` and drops `label` and `sycophancyScore` from `supplementary` (the card reads only `summary` and `counterArguments`, 4.8).
- Cost line: bias audit is two or three model calls (counterpoint skipped below threshold).

## Revise round 2 additions

- **[ran]** An analyzer with `outputSchema: AnalyzerResultSchema` that returns `score: 2` fails inside its own `.rescue()`: the audit succeeds and `results` holds only the other analyzer's result. The same analyzer without an `outputSchema` fails the whole audit (`execution_error` on `response-auditor`, no output).
- `biasAnalyzer` (`packages/thought-fabric-core/src/metacognition/bias-detection-blocks.ts:371-375`) skips counter-arguments below its own `counterpointThreshold`, default 0.4 (`bias-detection-helpers.ts:19`). It is not the auditor's `threshold`.
- `openai/gpt-6.1-sol` is a current name (the default model in the fsdev README); the small model is `openai/gpt-6-luna`.

## Revise round 3 additions

- The page names the block that carries `outputSchema: AnalyzerResultSchema`: the analyzer's outer block (the sequencer in the example), per the round 2 **[ran]** fact.
- Duplicate `analyzerId`: the card uses it as the React `key` (`audit-annotation.tsx:127`), so duplicates can render wrongly. The exact visible effect was not run; the page says only "can render wrongly".
- Whether a generator inside a side-chained analyzer emits to the chat stream is unverified. The page no longer says it (the `tone/detect` code comment is cut; fact 5.3's "runs silently" is not on the page).
- `.tap()` against `.step()` is not on the page; the Change it section links only the patterns reference.
