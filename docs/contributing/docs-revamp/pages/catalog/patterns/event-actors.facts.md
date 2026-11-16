# Event Actors (K-26) — fact sheet

Page: `catalog/patterns/event-actors`, type `catalog`, kept, budget 900 words (plan: "Actors react to
topics they watch; no controller"). Pass 1.
Questions the page answers: You add an actor, what else changes? One actor throws, what happens to the
others? How does an actor trigger another?
Examples: `eventActors` basic use; topic matching.

Sources cited: the exported surface and its comments (`packages/patterns/src/eventActors/`), its tests
(`packages/patterns/test/eventActors.test.ts`, `packages/patterns/test/task-caps-writers.test.ts`), the
package README, the existing page (`docs/contributing/docs-revamp/pages/catalog/patterns/event-actors.md`,
body identical to `apps/docs/docs/patterns/event-actors.md` apart from frontmatter), and the exported
surface of the board it runs on (`packages/orchestration/src/task-board/index.ts`). Paths are from the
repo root. "index" is `packages/patterns/src/eventActors/index.ts`; "test" is
`packages/patterns/test/eventActors.test.ts`; "caps-test" is `packages/patterns/test/task-caps-writers.test.ts`.

Facts marked CODE-ONLY were read from implementation and no test or doc states them. Each is something a
caller can observe by running the pattern, but the page needs a run or a test before it states one.

## 1. What it is

1. `eventActors(config)` returns a handle `{ emit, workspace, actors }`. `emit` is a sequencer block,
   `workspace` is the resource that stores the entry log, `actors` is the frozen list you passed.
   index:208-215, 464-468.
2. An actor is a name, a list of `watch` patterns and a block. When an entry is emitted, every actor whose
   pattern matches the entry runs, each with the entry as its input. There is no controller block that
   picks who runs. index:106-123, 275-280; test:283-321 (two matching actors both run); existing page
   lines 9, 11-16.
3. An entry is an object `{ type: string, topic: string, body: unknown }`. index:72; test:119-123.
4. The pattern is for event-driven or monitoring problems where agents react independently to shared
   state, with no central orchestrator and with actors you can add without editing the others. Existing
   page lines 11-16. The contrasting pattern is Routed Specialists, a controller that reads shared state
   and picks the next specialist each iteration (existing page line 18; that page is at
   `docs/contributing/docs-revamp/pages/catalog/patterns/routed-specialists.md`).
5. Adding an actor needs no change to existing actors: each actor only declares what it watches, and the
   matching is done per entry against the whole list. index:275-280; existing page line 9. An added
   actor's name must be unique: the worker table is keyed by `name`, so a second actor with the same name
   replaces the first one's block in that table. index:106-108, 330-334. CODE-ONLY on the replacing; the
   doc comment on `name` says "Unique name for this actor". No check throws on a duplicate.
6. `eventActors` throws at construction if `actors` is empty: message names the pattern and says "must
   have at least one actor". index:236-240; test:428-433.
7. `actor(config)` throws at construction if `watch` is empty: "must have at least one watch pattern".
   index:128-135; test:98-111. It returns a frozen descriptor. index:134; test:84-96.

## 2. Import

8. Import from the package root: `import { eventActors, actor, createEventActorsWorkspace } from
   "@flow-state-dev/patterns"`. packages/patterns/src/index.ts:62-78.
9. Or from the subpath `@flow-state-dev/patterns/event-actors` (hyphenated).
   packages/patterns/package.json:51-54 (source export), 98-101 (published export). The integration
   test imports it this way: packages/integration-tests/src/scenarios/event-actors-wake-storm.test.ts:29-33.
10. The existing page, the README and `apps/docs` all write the subpath as `@flow-state-dev/patterns/eventActors`
    (camelCase). `package.json` has no export by that name: the exports map lists only `./event-actors`
    (package.json:51, 98). The code contradicts those pages. Write the hyphenated subpath or the root
    import. README lines 82 and 111, existing page lines 38, 168-173.
11. Other root exports of this pattern: `matchTopic`, `compilePattern`, `createAppendEntry`,
    `normalizeToEntries`, and the types `EventActorsConfig`, `EventActorsHandle`,
    `EventActorsWorkspaceConfig`, `ActorConfig`, `Actor`. src/index.ts:62-78. The workspace state schema
    (`eventActorsWorkspaceStateSchema`), type (`EventActorsWorkspaceState`) and
    `createEventActorsWorkspaceResource` are exported from the subpath only. index:60-66.

## 3. Setup, the minimum

12. Three calls: `createEventActorsWorkspace({ name, entries })` makes the workspace, `actor({ name, watch,
    block })` makes each actor, `eventActors({ name, workspace, actors })` wires them and returns `emit`.
    index:128, 156, 221; test:127-143.
13. `createEventActorsWorkspace` takes `name` and `entries` (a Zod schema). The schema is documentation
    only: the function ignores its config (parameter is `_config`) and the resource stores entries as
    `z.any()`. Nothing validates an emitted entry against it. index:141-160; schemas.ts:5-8 (comment),
    87-89. The returned shape is `{ workspace: DefinedResource }`, which is what `eventActors` takes as
    its `workspace` option. index:156-159, 170-171.
14. An actor's block can be any block kind. It receives the entry itself as input, not the task wrapper.
    index:117-122, 438-439 (`.map((input) => input.input)`); test:151-158 (block gets the seed entry
    verbatim).
15. Use `emit` as a step in a sequencer: `sequencer({ name }).step(someBlock).step(feedback.emit)`.
    Existing page lines 98-104. `emit`'s input schema is `z.any()` (index:455-459), so any entry-shaped
    value is accepted.
16. Required: nothing else is wired per flow. `emit` and its internal blocks declare the workspace
    resource themselves (index:319, append-entry.ts:125), so putting `emit` in a flow installs it. The
    handle's doc comment says to "Declare on your flow's `resources`" (index:211-212); the test runs
    `emit` through `testBlock` with the resource only seeded as session state, never declared on a flow
    (test:160-163). CODE-ONLY that declaring it on the flow is optional; the page should say what the
    handle's comment says or leave it out.
17. `eventActors` options, `name`, `workspace`, `actors` required. Optional: `concurrency` (default 4),
    `reEmit` (default false), `maxDepth` (default 3), `maxTotalTasks` (default 500), `maxEnqueuedTasks`
    (default 100). index:166-206, 230-232; defaults 500 and 100 from
    packages/orchestration/src/tasks/collection/task-caps.ts:221,224. Pass `null` for either cap to
    remove it; pass a number to raise or lower it. index:197-205; caps-test:373-432 (all four capped
    patterns accept and honor an override; `maxTotalTasks: 0` is refused at line 418).
18. `concurrency` is how many actors run at once on the board. Default 4. index:179, 230; existing page
    lines 117, 127. The existing page and README say the default was lowered to align with peer patterns;
    that is history, leave it off the page.
19. `name` is the instance name: block names are prefixed with it and it names the task collection
    (`eventActors:<name>`). index:167, 242. Two instances in one request need different names, so each gets
    its own collection. CODE-ONLY on the collision; the doc comment on `name` says "Block-name prefix and
    TaskCollection id".

## 4. Topic matching

20. A pattern is matched against the string `${type}:${topic}`, for example `observation:slack.message`.
    index:110-115, 276; match-topic.ts:1-5.
21. `*` matches one segment: any run of characters except `:` and `.`. match-topic.ts:7-10, 34-36
    (compiles to `[^:.]*`).
22. `**` matches any number of segments, including none. match-topic.ts:9, 31-33 (compiles to `.*`).
    Note `**` is not segment-bound: `.*` crosses `:` and `.`. So `observation:**` matches
    `observation:slack.msg.edit`, and `**` alone matches everything. test:23-37.
23. Any other character matches itself; regex metacharacters in a pattern are escaped, so `.` in a pattern
    is a literal dot. match-topic.ts:11, 37-39.
24. The whole key must match (anchored). `observation:*` does not match `observation:slack.msg`.
    match-topic.ts:46; test:18-21.
25. Examples that hold, each from the test or the file header: `observation:*` matches `observation:slack`
    and not `observation:slack.msg` (test:19-20); `observation:**` matches `observation:slack` and
    `observation:slack.msg.edit` and not `event:slack` (test:24-26); `*:slack` matches `event:slack`
    (test:30); `observation:slack.*` matches `observation:slack.message` and not `observation:slack.a.b`
    (test:31-32); `**` matches `anything:goes` (test:36).
26. An actor lists several patterns in `watch`; it runs when any one of them matches. index:277-279
    (`a.watch.some(...)`).
27. An actor runs once per matching entry, not once per matching pattern. One task per actor per entry.
    index:293-298.
28. `matchTopic(pattern, key)` and `compilePattern(pattern)` are exported for testing a pattern by itself.
    match-topic.ts:24, 52; src/index.ts:66-67. `compilePattern` caches compiled patterns. match-topic.ts:19,
    25-26.
29. An entry whose `type` or `topic` is missing is matched against `":"`-joined empty strings, so it only
    matches broad patterns. index:276 (`entry.type ?? ""`). CODE-ONLY. Skip unless needed.

## 5. What `emit` does, in order

30. `emit` runs three steps: record the entry in the workspace, create one task per matching actor, drain
    the board until every task has settled. index:455-462, 6-30 (header comment); existing page lines
    24-29.
31. Recording appends the entry to the workspace's `entries` array, unless an entry with the same `type`
    and `topic` is already there; a duplicate is skipped and nothing is appended. append-entry.ts:137-147;
    test:188-246 (workspace still holds the single seeded entry after emitting its duplicate).
32. Dedupe key is `type` + `topic` only. The body is not compared. Two entries with the same type and topic
    and different bodies count as duplicates. append-entry.ts:139-141; test:216-228.
33. A duplicate seed entry still wakes its actors. The record step returns early on a duplicate, and the
    spawn step runs after it regardless. index:316-324, 460-461; append-entry.ts:143. CODE-ONLY: the test
    at 188-246 asserts the entry count only, not whether actors ran.
34. Each recorded entry also emits a keyed data item, `dataType` `rb-entry`, with `value` `{ type, topic, body }`, key
    `entry-<n>`, client only, not history. append-entry.ts:59-67; index:409-413. A container `evented-actors` wraps the
    emit sequencer. index:458. Surface for custom renderers; the existing page does not mention it.
35. The tasks the actors run as are created in one batch per entry, so an entry's matching actors are all
    dispatched or none are. index:301-313; caps-test:123-196 (a two-actor fan-out that would cross the cap
    dispatches nobody, `emit` errors, no actor runs).
36. When no actor matches, no task is created and the drain finds nothing to run; the entry is still
    recorded. index:309-310 (`inits.length === 0` return); append step runs first (index:460).
    CODE-ONLY for the observable result.
37. The actors run on a board that claims first-in-first-out and ends when no task is pending or running.
    index:443-453 (`claimOrder: "fifo"`, `onIdle: "complete"`); packages/orchestration/src/task-board/index.ts:56-59.
    Up to `concurrency` actors at a time. index:450.
38. The tests assert that `emit` finishes with `error` null in the normal cases. test:165, 279, 319, 368,
    424.

## 6. How an actor triggers another (`reEmit`)

39. With `reEmit: true`, an actor's output that is entry-shaped is recorded and dispatched to matching actors.
    With `reEmit` false (the default), output is ignored. index:182-188, 343 (`if (!reEmit) return`).
40. Output counts as entries when it is an object with a string `type`, a string `topic` and a `body`
    property; or an array of such objects; or an object `{ entries: [...] }` holding them. Anything else
    in the output is dropped silently. index:72-100; test:44-77. An empty or null output emits nothing.
    index:80; test:73-76.
41. A cascade, shown by test: tier 1 watches `request:**` and returns `[{ type: "observation", topic:
    "found", body: "result-1" }]`; tier 2 watches `observation:**`. Emitting a `request` entry runs tier 1
    once and tier 2 once, with that observation as its input. test:323-373 (run with `concurrency: 1`).
42. Each re-emitted entry is recorded in the workspace (same duplicate rule as fact 31) and its matching
    actors are created as new tasks. index:367-386, 406-419.
43. A repeated entry (same type and topic as one already in the log) is not recorded again but still
    dispatches its actors. The code says this is intentional: dispatch is "NOT gated on the dedup".
    index:376-385. CODE-ONLY.
44. Because of fact 43, an actor that watches the topic it emits makes a loop. The only stop is `maxDepth`.
    CODE-ONLY inference from index:376-385 and 353-355; test:375-426 shows the cap holds for a chain, not
    for a self-loop. A self-loop example must be run before the page states it.
45. Depth: entries emitted by `emit` create tasks at depth 1. An entry re-emitted from a depth-d task
    creates tasks at depth d+1. Tasks are created only while depth+1 <= `maxDepth`. index:322, 353-356,
    385. Default `maxDepth` is 3. index:195, 232.
46. At the limit, actors still run and what they output is still recorded in the workspace; it is not
    dispatched further. index:190-195 (doc comment: "actor bodies still run but their output is appended
    without further dispatch"), 376-385. test:375-426 asserts the third-tier actor does not run when
    `maxDepth: 2` and does not assert the recording.
47. `maxDepth` has no effect unless `reEmit` is true. index:190-191.
48. Order: every entry from one re-emission is recorded before any of its tasks is dispatched, so a
    downstream actor sees all of them in the log. index:388-405; caps-test:273-370.
49. Re-emitted output is not the only way: an actor block is any block, so it can do its work and return
    an entry as its output. There is no other documented way for an actor to start another actor except
    calling `emit` on the handle from inside a block, which the sources do not show.
    The page should say "return an entry".
50. Actors never see each other's task or each other's output directly. Each gets one entry as its input.
    The shared log is the only shared state, and an actor reads it only by declaring the workspace
    resource itself. index:438-439. CODE-ONLY on how an actor reads the log; the entry log's name is the
    resource key `eventedActors` (index:243), and tests seed it that way (test:162).

## 7. One actor throws

51. A throwing actor does not stop the others. Its task is recorded as failed, the other tasks continue
    and `emit` finishes. Source: the board's `onError` default is `"skip"` ("capture error on the failing
    task via `fail`, siblings continue"). packages/orchestration/src/task-board/index.ts:495-501, 691;
    existing page lines 142-143. `eventActors` does not pass `onError`, so it takes the default
    (index:443-453), and there is no `onError` option on `EventActorsConfig` (index:166-206): the policy
    is not configurable.
52. "Fails the offending task only": siblings already running are unaffected.
    task-board/index.ts:507-509. The orchestration tests that pin the skip behaviour are
    packages/orchestration/test/task-board/record-error-ends-for-good.test.ts:78 and
    packages/orchestration/test/task-board/lease-settlement-boundary.test.ts:153. No test in
    `packages/patterns/test` makes an actor throw and checks the others. The page needs a run (or a new
    test) before it states a result for a real throw.
53. A task already settled when the error arrives (cancelled, or completed by the actor itself) keeps its
    status; no failure is recorded over it. Existing page lines 142-143 only. Not verifiable from the
    sources a fact sheet may cite beyond that page; leave out unless confirmed.
54. A failed actor produces no re-emission. The re-emit step is the last step of the actor's pipeline,
    after the actor's block, so an error in the block skips it. index:432-440. CODE-ONLY.
55. A failed task is not retried: `eventActors` creates its tasks without `maxAttempts`, so none retries,
    and it takes no retry budget option. index:252-259, 260-264; README line 56; caps-test:540-565 (a
    `maxTotalRetries` option is refused by the type).
56. Two other failures do stop `emit`, both at the creation bounds (fact 17):
    (a) a fan-out that would cross a bound at the first emit errors `emit` and dispatches none of that
    entry's actors. caps-test:123-196.
    (b) a re-emission that would cross a bound errors the source actor's task, and nothing from that
    output is dispatched. All of one output's entries are checked together. index:361-366, 399-405;
    caps-test:198-271 (dispatches nobody when one output's entries together cross the bound).
    In case (b) the entries are already recorded in the log, though the actors for them never ran.
    index:399-405 (comment). The test at caps-test:198-271 asserts no tasks created; it does not
    assert that entries are recorded.
    Defaults: 500 tasks created in all, 100 waiting at once. Raise or remove with `maxTotalTasks` and
    `maxEnqueuedTasks`. index:197-205; task-caps.ts:221, 224.

## 8. Stored parts: who owns, who can see, where, how many

The entry log (the workspace resource):

57. Owner: the flow that includes `emit`. It is a resource declared by the pattern's own blocks, scoped
    `session`, writable. schemas.ts:76-85; index:319; append-entry.ts:125.
58. Who can see it: the client can read the `entries` field and nothing else (`client.expose: ["entries"]`),
    so a UI can show the chain live. Writable means blocks can write it; the actors write it through
    `emit`. schemas.ts:72-74, 81-83.
59. Where it is stored: as session-scope resource state, under the resource key `eventedActors`. It lives
    as long as the session, in whichever store the app uses. index:243; schemas.ts:78. The page may say
    "stored with the session"; which store holds it is the app's choice and not decided by this pattern.
60. How many: one workspace per `createEventActorsWorkspace` call, one `entries` array in it. Entries are
    appended and never removed by the pattern. A (type, topic) pair is stored once. schemas.ts:67-70
    (append-only array, user-defined shape); append-entry.ts:139-147. The pattern puts no cap on the
    array's length.
    CODE-ONLY on "no cap": no limit appears in schemas.ts or append-entry.ts.
61. Several instances sharing one workspace: the resource key is the same constant `eventedActors` for
    every instance (index:243), so two `eventActors` instances built over one workspace share one log.
    CODE-ONLY; not a case a test or the existing page shows. Leave out unless needed.

The tasks (one per actor invocation):

62. Owner: the board `eventActors` builds inside itself; the app never declares it. index:443-453.
63. Where it is stored: on the request, under the collection id `eventActors:<name>`, so tasks last the
    request, not the session. index:242, 266-273 (`backing: "state"`);
    packages/orchestration/src/tasks/collection/get-or-create.ts:66-69 (state omitted: tasks live on the
    request and end with it), 212. The existing page says the same ("request-scoped `TaskCollection`",
    line 40).
64. Who can see it: the stream carries task-change items while it runs, and the existing page says the
    tasks show in `<Plan />` and the devtool with the actor name as `task.assignee`. Existing page lines
    40, 148-150; the assignee is set at index:295. The claim about `<Plan />` and the devtool is the
    existing page's only; confirm in a run before stating.
65. How many: one task per matching actor per entry, so an emit with k matching actors makes k tasks, and
    each re-emitted entry makes more. Each task's goal is `"<actor name> on <type>:<topic>"`, its
    input is the entry, its metadata is `{ depth, type, topic }`. index:293-298.
    Bounded by `maxTotalTasks` (500) and `maxEnqueuedTasks` (100) unless raised or set to `null`.

## 9. What it won't do (for a Reference row, not the page)

66. No controller and no ordering between actors. The board claims FIFO and runs up to `concurrency` at
    once, so two actors on one entry run in either order. test:283-321 sorts the call order before
    comparing (`calls.sort()`). Say the order is not guaranteed.
67. Entries are not validated against the `entries` schema (fact 13).
68. An actor cannot ask a question of the others and wait for the answer: it returns an entry and ends.
    CODE-ONLY inference from the pipeline shape, index:432-440. Leave out unless a cold read shows the gap.
69. No retry (fact 55) and no `onError` choice (fact 51).
70. Tasks do not survive the request (fact 63); the entry log does (fact 59).

## 10. Where the existing page and the code disagree, or are stale

71. Import path `@flow-state-dev/patterns/eventActors` does not exist as an export (fact 10).
72. The existing page's "Config reference" omits `maxTotalTasks` and `maxEnqueuedTasks` (facts 17, 56).
73. The existing page says "Earlier releases echoed the entry back" for `createAppendEntry` and tells the
    reader to compose it with `.tap()`. The `.tap()` instruction is behavior (append-entry.ts:112-115,
    "compose with `.tap(...)`, never `.step()`, it returns nothing"); the "earlier releases" sentence is
    diff narrative and stays off the page. The block is a remixing helper; the K-26 plan does not list it.
74. The existing page's "Two-tier reactive/deliberative" example and its "Substrate notes" and "Exported
    API" sections are beyond the K-26 plan. The plan names basic use and topic matching.
75. The existing page's wake-filter sentence ("`wakeOn` wake filter so transient workspace patches do not
    impose a per-worker scan cost") is mechanism; it describes a cost fix, not behavior. Leave it off.
76. The existing page's "Failure isolation" paragraph carries the settled-task caveat (fact 53) with no
    test behind it.

## 11. Example material available

77. Basic use, from the existing page and tests, ready to type-check: the entry schema (a Zod object
    `{ type: z.string(), topic: z.string(), body: z.any() }`, test:119-123), a workspace, two actors
    (`observation:slack.*` and `event:alert.**`, existing page lines 51-75), the `eventActors` call
    (existing page lines 77-82). Blocks are handlers with `inputSchema: z.any()`, `outputSchema: z.any()`
    and an `execute` that takes the entry. test:147-155.
78. No file under `examples/`, `labs/`, `apps/kitchen-sink/src` or `goals/` uses `eventActors`: the only
    callers are `packages/patterns/test/`, `packages/orchestration/test/task-board/drain-pays-owed-cascade.test.ts`
    and `packages/integration-tests/src/scenarios/event-actors-wake-storm.test.ts`. The page's example is
    the existing page's example, made to fit the app layout in `docs/contributing/user-docs.md`.
79. The integration test runs 16 concurrent workers with one actor re-emitting 10 entries and a sink actor
    that returns nothing, so the cascade ends at depth 2. packages/integration-tests/src/scenarios/event-actors-wake-storm.test.ts:35-80.
    It is a stress check, not a model for the page.

## 12. Open items for the page's author and later passes

- Fact 51 and 52: run one actor that throws beside one that does not, with `emit` as a step, and confirm
  `emit` finishes and the sibling's output exists. Until then the page states the board's documented
  `skip` policy only.
- Fact 44: run a self-loop before stating it.
- Fact 16: whether `resources` must be declared on the flow.
- The K-26 questions map to: add an actor (facts 5, 17, 26, 27); one throws (51-56); one triggers another
  (39-50).

## 13. Revise round 1: what the page now states, and what moved to Reference

Page facts, all backed above: import from `@flow-state-dev/patterns` (fact 8); `entries` is documentation
only, nothing validates it (fact 13); actor `name` unique, shown as the run's assignee (facts 5, 65);
emit records then runs every matching actor up to `concurrency` (facts 30, 37); topic table (facts
20-25); `reEmit` output shapes and `maxDepth` (facts 39-40, 45-46); failing actor does not stop siblings
and is not retried (facts 51, 55); the log keeps one entry per type and topic (fact 31); the client reads
`entries` (fact 58). The page does not state: a self-loop (fact 44), that a failed actor re-emits nothing
(fact 54), the settled-task caveat (fact 53), or whether a duplicate entry still wakes its actors
(facts 33, 43). The page's example type-checks against the package source.

For the patterns Reference page, not the page:

- Config tables: `createEventActorsWorkspace` (`name`, `entries`; returns `{ workspace }`), `actor` (`name`,
  `watch`, `block`; frozen descriptor), `eventActors` (`name`, `workspace`, `actors`, `concurrency` 4,
  `reEmit` false, `maxDepth` 3, `maxTotalTasks` 500, `maxEnqueuedTasks` 100; returns `{ emit, workspace, actors }`).
- Exports of the `@flow-state-dev/patterns/event-actors` subpath: `eventActorsWorkspaceStateSchema`,
  `matchTopic`, `compilePattern`, `normalizeToEntries`, `createAppendEntry`.
- `createAppendEntry`: appends the entry to the workspace and emits its `rb-entry` data item unless an
  entry with the same type and topic is already there; it returns no output, so compose it with `.tap()`.
  With `.step()` the next step receives `undefined`.
- Storage: tasks are request-scoped (`eventActors:<name>`), the log is a session-scoped writable resource
  whose client expose list is `["entries"]` (schemas.ts:22-30). It is not a `client.data` projection.
- Actor runs execute inside the emit request on the board, so background-queue guarantees do not apply.
- Failure row: a task already cancelled or completed keeps that status and no failure is recorded
  (unconfirmed, fact 53).
- Cut, not moved: block-by-block composition, the wake-filter and default-concurrency history, the
  two-tier router example (beyond the plan, fact 74).

## 14. Revise round 2

Run against the package (a probe test, removed): two actors, one throwing. Emitting the same
`observation:slack.message` twice with different bodies runs the non-throwing actor both times (fact 33
now confirmed by a run, and fact 43 by the code comment), `emit` returns `error: null` in both, and the
throwing actor does not stop its sibling (facts 51, 52 confirmed for a real throw). The output of `emit`
is the drain loop's status entries (`{ shouldContinue: false, reason: "drained" }`), no actor results; the
page says the output holds no actor results and does not show the shape. Page now states: a repeated
type and topic is not recorded but still runs its actors (facts 31, 33); `emit` finishes without error
and a failed actor does not change that; depth counting (emitted entry's actors are depth 1, fact 45);
`reEmit` is an option of `eventActors`; the two cap options by name and default (fact 17).

## 15. Revise round 3

Checked against index:337-420 and the `maxDepth` comment (index:190-195): with `reEmit` off, the re-emit
step returns at once, so an actor's output never becomes an entry. With `reEmit` on, entry-shaped output
is appended to the log (deduped on type and topic) and tasks are created only while depth+1 <= `maxDepth`.
So entries returned at depth `maxDepth` are in the log and trigger no actor (fact 46 confirmed by code).
Whether an actor's output is stored on its task was not confirmed in the board source, so the page says
only that it never becomes an entry, and points to the log and the tasks for what ran.
