# Routed Specialists: fact sheet (K-25)

Page: `catalog/patterns/routed-specialists`, type `catalog`, kept, 700 words.
Questions it answers: who decides which specialist runs next, what specialists share, what ends it.
Example: `routedSpecialists` minimal example.

Sources cited: the exported surface (`packages/patterns/src/routedSpecialists/`), its tests
(`packages/patterns/test/routedSpecialists.test.ts`), `packages/patterns/package.json`, the package
README, the existing page (`docs/contributing/docs-revamp/pages/catalog/patterns/routed-specialists.md`,
body the same as `apps/docs/docs/patterns/routed-specialists.md`), the kitchen-sink renderer
(`apps/kitchen-sink/components/flow-state/routed-specialists.tsx`) and
`packages/core/src/utility/keyed-router.ts`. Paths are relative to `packages/patterns/` unless they
start with `docs/`, `apps/` or `packages/`. "index" is `src/routedSpecialists/index.ts`, "schemas" is
`src/routedSpecialists/schemas.ts`, "test" is `test/routedSpecialists.test.ts`.

## 1. What it is

1. `routedSpecialists(config)` returns a sequencer block. index:351-356, 596-600, 653-655.
2. A controller decides, each pass, which specialist runs next, or that the work is done. The
   specialist runs, writes to the shared workspace, and the controller decides again. index:1-8,
   342-350; test:115-159 (researcher, then analyst, then done).
3. The controller's decision is `{ specialist: string | null, done: boolean, reasoning: string }`
   (`controllerOutputSchema`). `specialist` names a registered specialist when `done` is false and
   is `null` when `done` is true. schemas:91-100.
4. The default controller is an LLM generator. It is told the registered specialist names and the
   iteration number, reads the workspace state as JSON, and is told to say done when the problem is
   solved and not to invoke the same specialist repeatedly unless its last contribution was
   incomplete. index:170-253.
5. You can replace the controller with any block that returns the same decision shape
   (`controller`). index:105-111, 383-396; test:37-58 (a scripted controller).
6. Who decides: the controller does, the specialists do not choose each other and do not run
   concurrently. One specialist runs per pass. index:596-629.
7. Reach for it when the next move depends on what is already in the workspace and a single pass of
   one specialist cannot solve the problem. Existing page lines 9-15. Contrast pages named by the
   existing page: Event Actors (react to topic-keyed entries concurrently, no controller), Round
   Robin (fixed roster, declared order), Task Board (concurrent drain with dependency gating),
   Supervisor (plan, execute, review, replan). Existing page lines 15, 117-122.

## 2. Install and import

8. Import `routedSpecialists` and `createWorkspace` from `@flow-state-dev/patterns` (src/index.ts:55-58,
   `controllerOutputSchema` too) or from the subpath `@flow-state-dev/patterns/routed-specialists`
   (package.json:43-46, and 90-93 for the published build).
9. CONTRADICTION in the existing page and README: both import from
   `@flow-state-dev/patterns/routedSpecialists` (README:63, existing page line 41). The package's
   `exports` map has no such key; the key is `./routed-specialists` (kebab case), like
   `./round-robin` and `./event-actors`. package.json:35-66. The page must use the kebab-case path
   (or the root). Code wins.
10. The subpath module also exports `routedSpecialistsControlSchema`, `createDispatchSpecialist` and
    `createCheckLoop`. The root exports only `routedSpecialists`, `createWorkspace`,
    `controllerOutputSchema` and the type `RoutedSpecialistsConfig`. index:62-72;
    src/index.ts:54-62. These three extras are building blocks, not needed for use; leave them
    to Reference.

## 3. What specialists share: the workspace

11. `createWorkspace(stateSchema)` returns a resource with `scope: "session"` and `writable: true`.
    The caller supplies the whole schema; the pattern puts no structure on it. schemas:19-33.
12. A specialist reads it as `ctx.resources.workspace.state` and writes it with
    `ctx.resources.workspace.patchState({...})`. index:84-88; test:61-72.
13. A specialist must declare `resources: { workspace }` on itself to read or write it. The pattern
    does not install the workspace into the specialist for you. index:91-95; test:61-72 and 75-83.
14. `initialState`, an object or a function of the pattern input (sync or async), seeds the workspace
    once at the start with `setState`. Omit it and the workspace keeps whatever it held.
    index:124-132, 364-380.
15. The controller's prompt includes the workspace state as JSON on every pass. index:249-252.
16. Specialists do not get the workspace passed to them as input. The router passes the controller's
    decision on as the specialist's input; specialists read the workspace from the resource.
    index:485, 604; src/routedSpecialists/blocks/dispatch-specialist.ts:134-155.
17. A specialist is any block (`Record<string, BlockDefinition>`). The registry is keyed by name,
    and the controller picks a key. At least one is required, and `routedSpecialists` throws at
    build time with "At least one specialist is required" otherwise. index:96, 358-362; test:276-284.

## 4. What ends it

18. The loop ends when the controller returns `done: true`. The check step reads `done` and
    continues while it is false. check-loop.ts:112-122; index:576-577, 625-629; test:90-113
    (done on the first pass: `iterations: 1`, empty history, no specialist ran).
19. `maxIterations` (default `10`) is a hard cap. The loop stops when the controller never says
    done. index:113, 354, 626-629; test:245-274.
20. The cap counts loop-backs, not total passes: with `maxIterations: 3` and a controller that never
    says done, the run makes 4 controller decisions, 4 specialist runs, and returns
    `iterations: 4` and four history entries. test:271-273 (comment: "1 initial + 3 fires = 4
    total"). The page must say "up to maxIterations repeats after the first pass", or give this
    count, not "at most N iterations".
21. Hitting the cap is not an error. `result.error` is null and the output is returned. test:269.
22. A controller that returns `specialist: null` with `done: false` does not end the run. The
    dispatch throws "Controller returned null specialist without done=true", the failure is rescued
    like any specialist failure, and the loop carries on (it then ends by `maxIterations` or a later
    done). test:286-312 (top-level `error` is null); index:483-525;
    dispatch-specialist.ts:147-153.
23. A controller that names a specialist not in the registry also fails the dispatch, with the
    registered names listed, and is rescued the same way. keyed-router.ts:8-9, 54-57.

## 5. When a specialist fails

24. A specialist that throws does not stop the loop. The iteration is recorded as failed, a status
    message `specialist failed: <message>` is emitted, and the controller picks again.
    index:483-525; test:213-243 (broken, then recovery; `iterations: 3`, history holds only
    `recovery`).
25. A failed iteration is not in `history` and not in the controller's "Previous decisions" list,
    since both read completed iterations only. index:208, 634; test:240-242. So a default controller
    does not see that the failed specialist was tried; the workspace is what it sees.
26. A specialist that suspends (`ctx.suspend()`) is not rescued; it parks the run. index:609-621.
    Not needed on the page; Reference.
27. Writes a failed specialist made to the workspace before it threw stay. Not tested; do not state
    it. (No code path undoes workspace writes: index:483-525.)

## 6. What comes back

28. By default a synthesizer runs last: an LLM generator that receives
    `{ workspace, iterations, history }` and produces the pattern's output. `outputSchema` is the
    schema of the default synthesizer's output. index:149-157, 258-298, 579-593.
29. `synthesizer: false` returns the raw `{ workspace, iterations, history }`. A custom block can be
    passed as `synthesizer` and receives that same shape. index:149-154, 580-583, 630-655;
    test:90-113.
30. `history` is the completed iterations, oldest first, each
    `{ iteration, specialist, reasoning, output }`, where `output` is what the specialist returned
    and `reasoning` is the controller's reason for picking it. index:630-651; test:145-158.
31. `iterations` is the count of controller decisions, including the final `done` one. Two
    specialists then done is `iterations: 3`, `history` length 2. test:145-148.
32. `iterations` is the controller's pass count, so a first-pass `done` gives 1 and an empty
    history. test:110-111.

## 7. Config (everything in `RoutedSpecialistsConfig`, index:78-164)

| Field | Type | Default | Fact | Line |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name. Prefix of the generated block names; also the default collection id. | index:81-82, 356 |
| `workspace` | `DefinedResource` | required | From `createWorkspace`. | index:84-89 |
| `specialists` | `Record<string, BlockDefinition>` | required, at least one | Registry the controller picks from. | index:91-96, 358-362 |
| `controller` | `BlockDefinition` | LLM generator | Must return the decision shape. | index:105-111 |
| `maxIterations` | `number` | `10` | Hard cap, see 19-20. | index:113, 354 |
| `maxHistory` | `number` | all | How many of the most recent completed iterations the default controller's prompt lists. The full record is kept. | index:116-122, 212-215 |
| `initialState` | object or function | none | Seeds the workspace once. | index:124-132 |
| `instructions` | `InstructionsSlot` | none | Added to the default controller's and default synthesizer's prompts. Ignored for a replaced block. | index:98-103, 192-199, 285 |
| `model` | `string` | `"openai/gpt-6-luna"` | For the default controller and synthesizer. | index:134-135, 184, 279 |
| `context`, `uses` | slots | none | Applied to the default controller and synthesizer. | index:137-141 |
| `controllerVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default controller's items reach the client and are not kept in the model's history. | index:143, 188 |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | | index:146, 281 |
| `synthesizer` | `BlockDefinition \| false` | LLM generator | See 28-29. | index:149-154 |
| `outputSchema` | `ZodTypeAny` | none | Default synthesizer's output schema. | index:156-157, 282 |
| `collectionId` | `string` | `name` | Override of the iteration record's id. | index:159-163, 356 |

Reference table (not the page) carries this. The page shows `name`, `workspace`, `specialists`,
`maxIterations`, `initialState` only, as the existing example does (existing page lines 66-72).

## 8. Stored parts (the four questions)

The pattern stores two things. Where code does not settle a question, it says so.

**The workspace** (`createWorkspace`)
- Owner: the flow that includes the pattern; the app author's schema, written by the specialists
  (and seeded by `initialState`). schemas:19-33; index:364-380.
- Who can see it: every block that declares `resources: { workspace }` (the specialists, the
  default controller, the default synthesizer); index:186, 280; test:61-72. The client sees a copy of
  it through the live snapshot (see 36). Direct client reads of the resource itself are not
  established by this surface; do not state them.
- Where: a session-scoped resource, so it lives in the session and outlives one request.
  schemas:28-31. Whether it persists depends on the store behind the session (not stated here).
- How many: one per session per workspace resource. Two instances of the pattern given the same
  `workspace` share it. Two given different `createWorkspace` results do not. schemas:25-33
  (each call defines a resource).

**The iteration record** (a `TaskCollection`, one `Task` per controller decision that named a
specialist)
- Owner: the pattern instance, id `collectionId` (default `name`). index:356, 304-314.
- Who can see it: the default controller reads it to build "Previous decisions"; the pattern reads
  it to build `history`. index:202-228, 633-645. Specialists are not given it.
  The existing page says it is queryable after the run with `collection.list({ status: "completed" })`
  (existing page lines 112-113); the pattern itself calls exactly that (index:208, 634).
- Where: in the pattern's own sequencer state (`backing: "state"`, the `tasks` slot of the control
  state), not in the workspace. The existing page says the same. index:304-313; schemas:35-37, 77.
- How many: one Task per iteration where the controller named a specialist. None is made on the
  `done` pass. A Task has `assignee` = the specialist's name, `goal` = the controller's reasoning
  (or `iteration N` if empty), and `metadata.iteration` and `metadata.reasoning`. After the
  specialist returns the Task is completed with the specialist's output; after a failure it is
  failed. index:402-436, 497-503, 534-543.

Also kept in the sequencer's control state: `iteration`, `currentSpecialist`, `done`,
`currentTaskId`, `currentClaim`, and a legacy `currentAttempt`. schemas:69-78. Mechanism; none of it
goes on the page.

## 9. Shown to the user while it runs

34. Each pass emits a status line: `[routedSpecialists:<name>] invoking specialist: <name>`; on
    done, `converged after <n> iterations`. index:471-479.
35. Note: the converged message prints `state.iteration` read before the patch, so its number is one
    below the final `iterations`. index:414, 471-474 (`state` is captured before `patchState`).
    Whether the object is live or a snapshot is not shown by a test. Do not quote the number.
36. After each pass the pattern emits one keyed data item with `dataType` `routedSpecialists` (key = `name`)
    inside a container `routedSpecialists`, carrying the `value`
    `{ state: <workspace state>, iteration, specialist, done }`, client only, not history.
    `packages/patterns/src/routedSpecialists/index.ts:555-574` (`ctx.emit.data`, 563-572), 599.
37. A client renders it by registering a container renderer under `routedSpecialists`:
    `renderers={{ container: { routedSpecialists: RoutedSpecialists } }}`; the kitchen-sink has one
    that shows the workspace entries, the current specialist, and a finished state.
    `packages/ui/registry/components/routed-specialists.tsx:24-34` (reads the container's data item through
    `useContainerItems`); `packages/ui/registry/components/chat-assistant.tsx:58-62`.
38. CONTRADICTION: the existing page and README say the snapshot renders "live in `<Plan />`" and
    the decision sequence "renders natively in `<Plan />`" (existing page lines 28, 112; README:59).
    The code emits a `routedSpecialists` container and data item, rendered by a container renderer
    the app registers; nothing in this surface names `<Plan />`. Not verified that `<Plan />`
    renders it. The page should describe the container item and renderer registration, or omit
    rendering. No claim about `<Plan />`.

## 10. Example: the minimal example's facts

The existing example (existing page lines 33-72) is the page's one example. Checks against the code:

39. `createWorkspace(z.object({...}))` result is passed as `workspace`, and each specialist handler
    declares `resources: { workspace }`. Matches 11-13.
40. Specialists in the example are sequencers whose last step is a handler writing with `patchState`
    and returning `{ contributed: true }`. A specialist's return value becomes that iteration's
    `output` in `history`. Matches 30; test:157-158.
41. `initialState: (input: { topic: string }) => ({ goal: input.topic })` is the form; the function
    form is supported. index:128-132. The tests drive the pattern with `{ message: ... }` input and a
    static `initialState`, so the input type is the caller's; the pattern's init step accepts any
    input (`inputSchema: z.any()`). index:366.
42. The example's `researcher` and `analyst` are sequencers that begin with `generator({ /* ... */ })`
    placeholders. Those must be filled in with complete generators before the page ships ("no
    phantom names", user-docs.md "Code examples"). Needs: `name`, `model`, `prompt`/`user` slots.
    The example also passes `out as string` into `patchState`; type-check at pass 4.
43. The example sets no `controller`, so the default LLM controller picks, with
    `model` default `openai/gpt-6-luna`, and no `synthesizer: false`, so a default synthesizer
    produces the final answer. index:134, 580-593.
44. Layout for the page's example app (user-docs.md "Code examples"): specialists would live in
    `src/flows/<flow>/blocks/<name>.ts`, one export per file, the flow in `src/flows/<flow>/flow.ts`.
    The existing example exports `research` from one file; the page must rework this to the layout.

## 11. Limits worth stating (one line each, otherwise Reference)

45. One specialist per pass; no concurrency. See 6. For concurrent reactions use Event Actors.
46. The default controller sees only workspace state and completed-iteration reasoning, so a
    specialist that failed leaves no trace in its prompt. 25.
47. `maxIterations` counts repeats after the first pass (20).
48. The pattern is not a durable-job system; it runs inside one flow action's block, as any
    sequencer does. Not shown by tests; do not state.

## 12. Items the page must not state (no observable surface found)

- That the loop is resumable or retried after a crash, or lease-renewal behaviour. The code renews a
  claim on each iteration's record while a specialist runs (index:402-455) and stops it on
  completion, rescue or suspension (index:487-552, 619-621), and a late write from a superseded
  attempt is declined (test:356-403). Reference-only mechanism. Do not put on the page.
- Anything about `Plan`.
- That workspace writes are rolled back on failure (27).
- Legacy checkpoint fields (`currentAttempt`): Upgrading or nothing.

## 13. Neighbour pages (links for Next)

- `./round-robin.md` (K-24), `./event-actors.md`, `./supervisor.md`, `./debate.md`,
  `../orchestration/task-board.md`. Same slugs as in the existing page's See also, normalised to
  `.md` links.
- Reference page for the detail: a `../reference/patterns.md`-style row set carrying the config
  table (7), the output shape (6) and the limits (20-23, 25). Slug to be set by the sitemap; not
  found in this surface.

## 14. Corrections the page needs against the existing text

| Existing claim | Existing page line | What the code says | Fact |
| --- | --- | --- | --- |
| Import from `@flow-state-dev/patterns/routedSpecialists` | 41; README:63 | The subpath is `./routed-specialists` | 9 |
| Pipeline lists `recordIteration`, `dispatch`, etc. as the page structure | 18-27 | Mechanism; internal step names are not exposed except through status messages | cut |
| "Renders in `<Plan />`" | 28, 112 | Emits a `routedSpecialists` container item | 38 |
| `maxIterations`: "Hard cap on iterations" | 98 | Cap on repeats; a run can make `maxIterations + 1` passes | 20 |
| `initialState` type `object \| (input) => object` | 100 | Also accepts an async function | 14 |

## 15. Revise round 1 (pass 8)

- Page rewritten: opens on the reader's situation; example split to the layout (`workspace.ts`,
  `blocks/researcher.ts`, `blocks/analyst.ts`, `blocks/research-board.ts`) and type-checked. `initialState`
  is typed `(input: unknown)` in the config, so the example casts input (index:124-132).
- Moved to R-41 (`../../reference/patterns.md`, page links it): the config table (section 7), the output
  shape (6, 28-32), the block sequence in run order (init, controller, record-iteration, dispatch,
  record-completion, snapshot, loop check, loop back, map, synthesizer; index:596-655), and the Task
  fields of an iteration record (section 8: `assignee`, `output`, `goal`, `metadata.reasoning`,
  `metadata.iteration`; the default controller reads completed Tasks for "Previous decisions").
- Moved to R-24: where the records live (one Task per iteration in a TaskCollection with id
  `collectionId`, default `name`; workspace is a separate session-scoped writable resource).
- Convergence pass: record-iteration, record-completion and snapshot run every pass; the Task is only
  created when `!done`, dispatch only runs when `!done` (`stepIf`), then the check ends the loop to the
  synthesizer (index:596-629). The page no longer states a step list.
- `<Plan />` removed everywhere (38): the snapshot is a `routedSpecialists` data item inside a `routedSpecialists` container
  with `{ state, iteration, specialist, done }`, rendered by a renderer the app registers (36-37).
- A custom `controller` gets the block's normal input and no history; only the default controller reads
  the collection (index:213-232, 480-490). `maxHistory` is "most recent N completed iterations in the
  default controller's prompt" (index:116-122, 212-215), a Reference row.
- Page states cap as repeats after the first pass (20), cap is not an error (21), unregistered or
  null-without-done controller fails the pass and is rescued (22-23), failed pass not in `history`
  (25). Workspace rollback on failure is not stated (27).

## 16. Revise round 2 (pass 8)

- `blocks/analyst.ts` is now shown in full (same shape as `researcher`, reads `research`, writes `analysis`), so the
  `./analyst` import in `research-board.ts` resolves (type-check finding).
- Rendering: the page registers the renderer under the container name `routedSpecialists` (36-37). The `name` option is
  only the item's key inside the container; the page no longer says "keyed by `name`".
- The iteration record is no longer queried on the page (`collection.list` cut: no handle is introduced there); the page
  links R-41 for where the records live and how to read them (section 8).
- A custom controller receives the pattern's input, not the history (index:480-490).
- Cut the duplicate "show a failed specialist to the default controller" bullet (the failure section states it, 25).
