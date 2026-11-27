# Round Robin: fact sheet (K-24)

Page: `catalog/patterns/round-robin`, type `catalog`, kept, 1,100 words.
Questions it answers: what stops the loop, what the referee changes, who reads the contributions.
Examples: `roundRobin` basic use, a referee.

Sources cited: the exported surface (`packages/patterns/src/round-robin/`), its tests
(`packages/patterns/test/round-robin.test.ts`), the package README, and the existing page
(`docs/contributing/docs-revamp/pages/catalog/patterns/round-robin.md`, identical in body to
`apps/docs/docs/patterns/round-robin.md`). Paths below are relative to `packages/patterns/` unless
they start with `docs/` or `apps/`. "index" is `src/round-robin/index.ts`.

## 1. What it is

1. `roundRobin(config)` returns a sequencer block. Input is `{ goal: string }`. Output is the
   synthesizer's output, or a `RoundRobinFinalShape` when `synthesizer: false`.
   index:164-171; schemas.ts:12-16.
2. A fixed roster takes turns. Each round runs every roster agent once, in declared order.
   index:1-5; test:38-65 (order alice, bob, carol, all round 1).
3. A round cycles: with two agents and `maxRounds: 3` the contributions run
   `1:a, 1:b, 2:a, 2:b, 3:a, 3:b`. test:67-90.
4. An agent never speaks twice within a round (one step per roster entry per loop pass).
   index:276-300.
5. An optional referee audits each round and its critique is readable by later rounds. It does not
   control termination. index:4-7, 127-133.
6. A synthesizer runs last by default. `synthesizer: false` skips it. index:6-9, 134-135, 330-349.
7. Reach for it when the set of perspectives and their order are known up front.
   Page text: existing page lines 11-13. Contrast pages: Routed Specialists (next speaker depends on
   context), Supervisor (per-task review with retry): existing page lines 13, 105-107.
   Not covered: debate's `moderator` is a different pattern; link to Debate only.
   Debate is documented in `docs/contributing/docs-revamp/pages/catalog/patterns/debate.md`.

## 2. Install and import

8. Import `roundRobin` from `@flow-state-dev/patterns` (src/index.ts:81) or from
   `@flow-state-dev/patterns/round-robin` (package.json:55-58, the subpath export).
   Both resolve to the same function.
9. Root-only renamed exports: `createReferee` is `createRoundRobinReferee`, `createSynthesize` is
   `createRoundRobinSynthesize`, `createInitContributions` is `createRoundRobinInitContributions`,
   `createRecordContribution` is `createRoundRobinRecordContribution`. src/index.ts:89-92. The
   subpath export uses the unprefixed names. index:73-77.
10. Config type is `RoundRobinConfig`, exported from the root. src/index.ts:95-98.

## 3. Config (everything in `RoundRobinConfig`, index:99-162)

| Field | Type | Default | Fact | Line |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name. Also the default `collectionId`. | index:102, 210 |
| `roster` | `RosterEntry[]` | required | Ordered. Names unique, at least one. | index:103, 186-200 |
| `maxRounds` | `number` | `5` | Hard cap on rounds. Must be > 0. | index:104-105, 175, 201-203 |
| `terminateWhen` | `(ctx: BlockContext) => boolean` | none | Early exit. | index:106-115 |
| `contributions` | `DefinedResource` | created internally | Shared transcript resource. | index:116-125, 212 |
| `referee` | `BlockDefinition` | none (no default referee) | Optional per-round auditor. | index:127-133, 302-304 |
| `synthesizer` | `BlockDefinition \| false` | built-in generator | Terminal step. | index:134-135, 334-349 |
| `outputSchema` | Zod schema | `z.string()` on the default synthesizer | Applies to the synthesizer's output. | index:136-137; default-synthesizer:42 |
| `instructions` | string or `(input, ctx) => string` | none | Reaches default blocks only. | index:138-139, 289; default-roster-agent:22-24, 104-111 |
| `model` | `string` | roster agent `"intent/chat"`; referee and synthesizer `"intent/synthesize"` when built via their factories | The config doc comment says default `"intent/chat"`; the synthesizer factory's own default is `"intent/synthesize"` (default-synthesizer:41). The pattern passes `model` through to the roster agent and synthesizer only, not to a referee (the pattern builds none). | index:140-141, 285, 344-346; default-roster-agent:95; default-synthesizer:41; default-referee:43 |
| `uses`, `tools`, `context` | slots | none | Forwarded to default roster agents and the default synthesizer. | index:142-147, 286-288, 340-343 |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Applies to the default synthesizer only. | index:148; default-synthesizer:46 |
| `collectionId` | `string` | `name` | Id of the audit task collection. | index:149-150, 210 |
| `accessorKey` | `string` | `"contributions"` | Resource accessor key used by the pattern's internal blocks. | index:151-161, 211 |

11. Config errors throw at build time, not run time:
    - empty or non-array roster: `[round-robin] roster must contain at least 1 entry in "<name>"` (index:186-188; test:354-361);
    - missing or non-string roster name (index:191-193);
    - duplicate roster name: `[round-robin] duplicate roster name "<n>" in "<name>"` (index:194-198; test:363-373);
    - `maxRounds <= 0` (index:201-203; test:375-383);
    - `outputSchema` set with `synthesizer: false` (index:204-208; test:385-394).
12. `RosterEntry` is `{ name, role?, block? }`. index:80-97.
    - `name`: unique within the roster. It is the agent's name on contributions, and the `assignee` on the audit task.
    - `role`: injected into the default agent's prompt. Ignored if `block` is set.
    - `block`: replaces the default LLM agent.
13. Default roster agent prompt opens "You are <role> contributing to a round-robin coordination
    process." (or "an agent" with no role) and tells it its name. default-roster-agent:77-79, 112-116.
14. Default roster agent streams plain text (no `outputSchema`), so `message` items stream live. Its
    generator carries `agentName` equal to the roster entry's name. Its `itemVisibility` default is
    `{ client: true, history: false }`. default-roster-agent:80-99.
15. A custom roster `block` must produce a string or `{ text: string }`. Any other value is coerced
    with `String()` and a `console.warn` is emitted once per agent name.
    shared/coerce.ts:8-36; index:91-95; test:325-352. Custom blocks own their own prompts, tools
    and resources: the pattern's `instructions`/`uses`/`tools`/`context` are not applied to them
    (index:138, 142-147; existing page line 140).

## 4. What stops the loop

16. Two things stop it: `maxRounds` and `terminateWhen`. index:6-8, 306-317.
17. The check happens after each round, after the referee if there is one.
    Order is roster, referee, loop check. index:299-317.
18. Exit rule, in order: if `round >= maxRounds` stop; else if `terminateWhen(ctx)` returns true
    stop; else loop. `terminateWhen` is not called once `maxRounds` is reached.
    index:308-314. Test: `terminateWhen: () => false` with `maxRounds: 2` gives `rounds: 2`
    (test:116-134).
19. `terminateWhen` returning true after round 2 with `maxRounds: 5` gives `rounds: 2` and 2
    contributions for a one-agent roster. test:92-114.
20. `terminateWhen` reads `ctx.sequencer.state` (`round`, `refereeCritiques`, `goal`) and
    `ctx.session.state`. index:106-111; schemas.ts:46-50.
21. `terminateWhen` must be pure and total. A throw surfaces as a loop runtime error.
    index:112-114.
22. Round count is 1-based: the first round is `round: 1`. schemas.ts:19-21 (`min(1)`),
    index:234-244 (state starts at 0, incremented before the roster runs).
23. `maxRounds: 1` runs a single round. index:316 (`maxIterations = maxRounds - 1`); test:38-65.
24. The referee does not stop the loop. It has no way to: its output is `{ critique }` only.
    schemas.ts:29-31; default-referee prompt "Do not decide whether more rounds are needed"
    (default-referee:70-73).
25. A roster agent that throws fails the run: result carries an error. test:270-296. No retry or
    skip is applied.
26. The referee runs on the last round too (it sits before the loop check). Test:
    `maxRounds: 3` with a referee gives referee calls at rounds 1, 2, 3. test:162-197.

## 5. What the referee changes

27. With a referee, after every round's roster turns the pattern runs it and stores its
    `{ critique }`. Without one, the referee step and its stash are absent from the pipeline.
    index:302-304; test:136-160.
28. The referee is any block returning `{ critique: string }`. `referee?: BlockDefinition`.
    index:127-133; schemas.ts:29-31.
29. Each critique is stored in the sequencer's state as
    `refereeCritiques: { round, critique }[]`, appended per round. index:247-261;
    schemas.ts:36-50; test:162-197.
30. The default roster agent's prompt carries "Referee critiques so far" listing
    `[Round N] <critique>` for every critique so far, sorted by round. Round 1 agents see none;
    round 2 agents see round 1's. default-roster-agent:44-53, 132-136; test:199-240.
31. Custom roster blocks are not given critiques by the pattern. They can read
    `ctx.sequencer.state.refereeCritiques` themselves (the test's observer does:
    test:208-221). Must be stated carefully: the sequencer state is readable only in a block
    that declares `sequencerStateSchema` for it (default-roster-agent:97 does this). Verify at
    page-write time that a custom block without that declaration cannot read it; this sheet has
    only the test's evidence (test:208-221, a handler with no declared schema read
    `ctx.sequencer!.state`).
32. The final shape carries all critiques, and the default synthesizer is shown them under
    "Referee critiques:". default-synthesizer:53-58; test:242-268.
33. The referee does not rewrite, reorder or remove contributions. Contributions are only appended
    by the record step. record-contribution:44-49.
34. No default referee exists. `createReferee(opts)` is exported as a ready-made generator you pass
    as `referee`. default-referee:38-95; index:74; existing page line 35.
    Requires `{ name, contributions }`. default-referee:24-36.
    Its prompt looks for exaggeration, dismissed opposing points, unsupported claims, vague
    retreat, and rehashing; it returns a short critique naming contributors, does not declare a
    winner, does not decide on more rounds, and does not propose new questions.
    default-referee:61-74. Model default `"intent/synthesize"`; `itemVisibility` default
    `{ client: true, history: false }`. default-referee:43, 47.
    `createReferee` reads the full transcript so far, not just the latest round:
    default-referee:84-92.
    Note: the referee's own prompt text says "multi-agent debate". Its use fits an assigned-stance
    roster (existing page line 148).
35. A custom referee that reads the transcript declares the contributions resource under the
    pattern's accessor key (default `"contributions"`) and reads `ctx.resources.contributions.state.entries`.
    Existing page lines 150-173 (example); default-referee:45, 82-84.
    The existing page example passes `contributions: panelContributions` and a `generator` with
    `resources: { contributions: panelContributions }`. The page's example needs
    `createRoundRobinContributions()` to declare `panelContributions`; it is not defined there.
    Fix when writing (index:116-125; schemas.ts:67-73).

## 6. Who reads the contributions (the transcript)

36. Each turn appends `{ round, agentName, text }` to a session-scoped resource.
    schemas.ts:18-26, 54-59, 67-73; record-contribution:44-49.
37. Readers:
    - **Default roster agents** render all prior entries, grouped by round, into their prompt as
      "Prior contributions". They see earlier rounds and earlier turns of the current round.
      default-roster-agent:26-42, 128-131.
    - **The default referee** reads the full transcript so far. default-referee:82-92.
    - **The synthesizer** receives `RoundRobinFinalShape` as its input, which carries every
      contribution and critique; it does not read the resource. default-synthesizer:48-66.
    - **Your own blocks after the loop** read the final shape as the pattern's output (with
      `synthesizer: false`) or, if you passed an external `contributions` resource, read it
      through `ctx.resources`. index:116-125; test:396-413.
    - **Custom roster blocks** see only what they declare. The pattern passes them their input
      (the previous step's value) and nothing injected. index:138, 291-299.
38. The pattern's output when `synthesizer: false` is `RoundRobinFinalShape`:
    `{ rounds: number, contributions: RoundRobinContributionEntry[], refereeCritiques: RoundRobinRefereeCritique[] }`.
    `rounds` is the count of rounds actually run. schemas.ts:75-80; index:318-328; test:50-64.
    `refereeCritiques` is `[]` when no referee. test:58, 136-160.
39. Passing `contributions: createRoundRobinContributions()` shares the resource: consumer blocks
    outside the pattern read it via `ctx.resources` by declaring the same resource. Register it on the flow's `resources` map.
    index:116-125; existing page lines 79-112; test:396-413 (pattern runs with an external one).
    Under `accessorKey`: consumer blocks declare it under whatever key they like on their own
    `resources:` map; the pattern's internal blocks use `accessorKey`. index:151-161.
40. Two `roundRobin()` instances in one sequencer chain need distinct `accessorKey` values; the
    same key pointing at different resources is rejected at build. index:151-161; package
    README lines 192-210.
41. The transcript is cleared at the start of every run (`entries: []`). Per-run isolation holds even
    for a shared resource. init-contributions:30-34. A shared resource therefore holds the
    latest run's transcript after the run; it is not a history across runs.

## 7. Storage: the four questions (owner, who sees it, where stored, how many)

**Contributions resource** (`entries`)
- Owner: the pattern creates and owns it by default (index:212). With `contributions:` set, you own
  the definition and the pattern reads and writes it. The pattern clears it at run start
  (init-contributions:30-34) and appends after every roster turn (record-contribution:44-49).
- Who sees it: scope is `session`, `writable: true` (schemas.ts:67-73). No `client` config is set,
  so it is not visible to clients (core `resource.ts:323`, "Omit to keep the resource invisible to
  clients"). Blocks that declare it see it: the pattern's roster agents, referee factory and
  record tap, plus any block you give the same resource.
  Session scope means every request in that session shares one instance. See the scope section of
  Resources; do not restate scopes here.
- Where stored: the session store, whatever store the app uses. Not verified further here.
- How many: one per session per `accessorKey` (one resource instance; the entries array grows by
  one per roster turn, `rounds x roster.length` per run, then resets next run).

**Referee critiques and goal and round counter** (`refereeCritiques`, `goal`, `round`)
- Owner: the pattern, in the sequencer's own state. schemas.ts:45-51; index:222-261.
- Who sees it: blocks inside this sequencer through `ctx.sequencer.state`, `terminateWhen`, and the
  final shape. index:106-111.
- Where stored: sequencer state of the run. Not a session or user resource.
- How many: one `round` and `goal` per run; one critique per round when a referee is present.

**Audit task collection**
- Owner: the pattern. Created in the init step; `collectionId` defaults to `name`.
  init-contributions:35-42; index:149-150, 210.
- Who sees it: DevTool timeline; it emits `task-change` items, one task per turn. test:415-441
  (at least 4 `task-change` items for 2 agents x 2 rounds). Page text: existing page line 33.
- Where stored: `backing: "state"`, in the sequencer's state. init-contributions:37-42;
  record-contribution:51-56.
- How many: one task per (round, agent) turn, created, claimed and completed in the record step,
  with `goal: "<agent> (round <n>)"`, `assignee: <agent>`, `metadata: { round }`, and result
  `{ text }`. record-contribution:57-65.

## 8. Synthesizer

42. The default synthesizer is a generator that merges the contributions and critiques into one
    deliverable. Input is the final shape; output is `z.string()` unless `outputSchema` is given.
    default-synthesizer:33-66, 42.
43. Pass your own block as `synthesizer` to take over; it receives `RoundRobinFinalShape`. A
    custom synthesizer's input is the final shape. test:298-323 (custom synth over the final shape);
    test:242-268.
44. `outputSchema` applies to the default synthesizer. Setting it with `synthesizer: false` throws
    at build. index:204-208. It is not applied to a custom `synthesizer` block by the pattern
    (only `createSynthesize` receives it, index:334-343): verify before stating otherwise.
    The config comment says "applied to the synthesizer's output" (index:136-137).

## 9. Example used on the page (suggested, from the existing page and README)

Names stay in the page's one app (`src/flows/<flow>/...`). Suggested scenario, from the existing
page and the README (README lines 172-210): an editorial review with `writer`, `fact-checker`,
`copy-editor`, `maxRounds: 3`. Existing page lines 37-52 for basic use. The existing basic-use
snippet has no imports of its own flow beyond `roundRobin`, no title, no `goal` caller. When writing,
title the block with its path and show how a flow calls it (`.step(editorial)` with input
`{ goal }`). The example for a referee: existing page lines 150-173 needs the missing
`createRoundRobinContributions` and `generator` and `z` imports, a defined `panelContributions`, and `roster` is a placeholder. Fix, do not copy. The `prompt` string field and `user` function in that example match the `generator`
slots used in default-referee:51-93, which is the evidence it type-checks; the page's check is pass 4.

## 10. Where the existing page and neighbours disagree with the code

- **`apps/docs/docs/patterns/overview.md:63`** says "After each round a judge decides whether to
  keep going." Wrong: a referee never decides; `maxRounds` and `terminateWhen` do (index:306-317).
  It also says "Every agent contributes once per round, in declared order, seeing the full prior
  transcript", true for default agents only. And overview:65 calls the Debate judge "the loop
  terminator" vs "verdict-producer"; not this page's job, flag for the Patterns overview owner.
  Fix every copy.
- `packages/patterns/README.md:188-190` is accurate on the referee.
- Existing page line 31, "Every agent sees the full prior transcript", holds only for default roster
  agents; custom blocks see what they declare (see 37).
- Existing page line 120 names `record-contribution` and `coerceText`: internal names, cut.
- Existing page line 114 names `init-contributions` tap, internal, cut.
- Existing page line 17-29 pseudo-pipeline names internal steps (`stampGoal`, `incrementRound`,
  `buildOutput`). Not observable by a reader except in DevTool; do not repeat as a pipeline.
  Observable: block names in traces are `<name>-init`, `<name>-stamp-goal`, `<name>-increment-round`,
  `<name>-roster-<agent>`, `<name>-record-<agent>`, `<name>-stash-referee`, `<name>-synthesizer`
  (init-contributions:27; index:223, 235, 248; default-roster-agent:94;
  record-contribution:29; default-synthesizer:40). DevTool users see these. Optional.
- Existing page line 87 imports from `@flow-state-dev/patterns/round-robin`; both paths work.
- Existing page links `./routed-specialists`, `./debate`, `./supervisor`, `./overview` (plain
  slugs). Revamp slugs: use `./kebab-case.md` links per the sitemap.
- The sequencer carries `container: { component: "roundRobin" }` (index:270): a UI hint, not
  documented on the existing page; no observable behaviour verified here. Leave out unless the
  Patterns reference needs it.
- Not verified, leave out unless checked: whether `terminateWhen` can read `ctx.session.state`
  keys across requests (index:108-111 says it can); what the roster agent sees when `goal` is
  empty.

## 11. Limits a reader would otherwise assume away

- No default referee exists (index:127-133; existing page line 35).
- Referee never ends the loop or changes who speaks (schemas.ts:29-31).
- Roster order is fixed; nobody is skipped or reordered by what was said (index:276-300).
- Every roster entry speaks every round. There is no per-agent round limit.
- `terminateWhen` is checked after a full round; it cannot stop mid-round (index:306-317).
- A throwing roster agent or `terminateWhen` fails the run (test:270-296; index:112-114).
- Pattern-level `instructions`, `uses`, `tools`, `context`, `model` reach default blocks only
  (index:138, 142-147).
- A shared `contributions` resource holds only the last run's transcript (init-contributions:30-34).
- Output is not structured unless a synthesizer with `outputSchema` or a custom block makes it so;
  the default synthesizer returns a string (default-synthesizer:42).

## Revise round 1

- Page now carries no config table, output-shape block, termination-option list, exported-API list or pipeline step names: those are rows for R-41 (`reference/patterns.md`). Facts 9, 10, 14-15, 20, 38-41 and sections 3, 7 stay here as the source for those rows.
- Fact 34 clarified on the page: no referee unless you pass one; `createReferee({ name, contributions })` is a ready-made one you pass as `referee`.
- Page states: each turn is a task in DevTool's timeline assigned to the roster `name` (section 7, audit task collection); the transcript is cleared at the start of every run (fact 41).
- Examples now carry paths, import what they use, and type-check against the package source. The referee example declares `editorialContributions` via `createRoundRobinContributions()` (fact 35).

## Revise round 2

- Fact 15 verified (shared/coerce.ts): an override returns a string or `{ text }`; any other value, structured results included, is stored as `String(value)` with a one-time warning. The page no longer says an override gives structured output into the transcript.
- Fact 37 (custom blocks see only what they declare) now shown on the page: `legalReviewer` declares `editorialContributions`, and the pattern is passed the same resource via `contributions`.
- Fact 40: `accessorKey` is a `roundRobin` option (and a `createReferee` option); a custom referee's own `resources` key is free. Page example added as a complete titled file (legal-review.ts) with its own roster and `createRoundRobinContributions()`.
- Section 7, audit task collection: DevTool shows the tasks on the Tasks tab (apps/docs/docs/devtool/overview.md, "Tasks tab"), not the timeline.
