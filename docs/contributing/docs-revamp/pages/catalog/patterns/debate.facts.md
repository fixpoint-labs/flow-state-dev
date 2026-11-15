# Facts for Debate (K-23, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a Reference row; the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[drop]** true but mechanism or design rationale; leave it off.

Abbreviations: `ix` = `packages/patterns/src/debate/index.ts` · `sc` = `packages/patterns/src/debate/schemas.ts` · `dj` = `packages/patterns/src/debate/blocks/default-judge.ts` · `dd` = `.../blocks/default-debater.ts` · `dm` = `.../blocks/default-moderator.ts` · `ds` = `.../blocks/default-synthesizer.ts` · `it` = `.../blocks/init-transcript.ts` · `ra` = `.../blocks/record-argument.ts` · `t` = `packages/patterns/test/debate.test.ts` · `ex` = `apps/docs/docs/patterns/debate.md` (the page this one keeps and trims) · `draft` = `docs/contributing/docs-revamp/pages/catalog/patterns/debate.md` (same text as `ex` plus the catalog frontmatter) · `pk` = `packages/patterns/package.json` · `pi` = `packages/patterns/src/index.ts`.

## Flags against the existing page (read first)

1. **Contradiction: the focus section's heading.** `ex:186` says the default debater's prompt gets a section titled "The moderator has asked the next round to focus on". The code renders `Focus for this round:` for `newAngle` (`dd:284-287`) and `Briefing from the moderator:` for `briefing` (`dd:280-283`). The code wins. **[page]** may describe the two sections by what they carry, not by quoted headings.
2. **Contradiction: "built on the Round Robin chassis".** `ex:313` and `packages/patterns/README.md:231` say Debate is built on Round Robin. `ix` imports nothing from `round-robin`; it builds its own `sequencer` (`ix:43`, `ix:417-422`, `ix:583-588`). The only shared code is `coerceText` (`packages/patterns/src/shared/coerce.ts:1-4`, used at `ra:246`). **[drop]** the "chassis" claim. The page may say Round Robin is the sibling to reach for when you want a deliverable and not a winner (that comparison is behavior, fact 9.2).
3. **Contradiction: `model` default.** `ex:279` gives `"intent/chat"` for all built-in generators. The default is per block: debater `intent/chat` (`dd:219`), judge `intent/synthesize` (`dj:101`), moderator `intent/synthesize` (`dm:62`), synthesizer `intent/synthesize` (`ds:74`). When `model` is set it applies to all four (`ix:320`, `ix:437`, `ix:405`; `createModerator` takes its own `model`, `dm:47`, and `debate()` never builds the moderator). **[ref]**
4. **Incomplete: the moderator decision shape on the raw output.** `ex`'s `DebateRawOutput` snippet lists `moderatorDecisions` entries without `briefing`. The type has it (`sc:70-77`, `sc:115-122`). **[ref]**
5. **Moderator is not built by `debate()`.** `debate()` takes a `moderator` block; the default one comes from `createModerator`, which the caller builds and passes (`ix:154`, `dm:59`). With no `moderator`, none is created (`ix:416`). The draft's second snippet (import from `@flow-state-dev/patterns/debate`) is right. `createModerator` and the debate transcript/moderator schemas are not exported from the package root (`pi:100-113` lists `debate`, four schemas, `createDebateTranscript`, `createDebater`, three types), only from the `./debate` subpath (`pk:59-62`, `ix:75-100`). **[page]** (the import line the snippet needs)
6. **Winner semantics are ambiguous.** The schema comment says `winner` is the "Name of the stance the judge sided with, or null for synthesis" (`sc:33`). Tests use stance strings (`t:73`, `t:177-181`: `winner: "for"` with debater names `a`/`b`). The UI fixture uses a debater-looking value (`goals/design-system/skins-reused-components-from-one-token-set/host/fixtures.ts:157`: `winner: "pro"` with debaters named `pro`/`con` and stances `for`/`against`, lines 152-154). The default judge prompt never says which to return (`dj:119-123`), and the judge sees stances only by default (fact 5.4). **[page]** says `winner` is a stance, as the schema documents, and `null` means the judge combined stances. Do not claim the model always returns a stance string.
7. **Sycophancy and bias claims are not testable here.** The existing page says models "tend to abandon correct positions" and that the mitigations work. The only citable fact is what the code does (the no-concession prompt, `dd:254-256`; the two judge toggles; the warn above 4 rounds). A code comment says the prompt is non-conceding "per the sycophancy literature" (`dd:211-212`), which is not a result. **[gap]** for any claim that debate improves answers, or that a mitigation removes a bias. The page states the settings and what they change.
8. **No example app uses `debate`.** `examples/` has `hello-chat`, `guides`, `knowledge-base`; `labs/` has no `debate(` call (grep). The only caller outside `packages/patterns` is a UI fixture (`goals/.../host/fixtures.ts:147-162`) and a `kitchen-sink` chat mode that is a prompt, not the pattern (`apps/kitchen-sink/flows/chat-agent/run/assistant/prompts/debate.prompt.md`, not a use of `debate()`). **[gap]** for "one example that uses it". The page's code must be written from `ex` and the tests. It must type-check against `ix` (pass 4).
9. **Counts for the sitemap's three questions are derived, not stated anywhere.** See sections 5, 6 and 8; each is marked.

## 1. What it is

- 1.1 `debate(config)` returns a sequencer block. Input `{ question: string }`. Output is the synthesizer's output, or `DebateRawOutput` when `synthesizer: false`. `ix:201-208`, `sc:13-17`. **[page]**
- 1.2 It takes two or more debaters, each a `name` and an assigned `stance`. `ix:102-125`, `ix:227-229`. **[page]**
- 1.3 Debaters argue across rounds, then one judge runs once after the loop and returns `{ verdict: string, winner: string | null, reasoning: string }`. `ix:312-326`, `sc:30-37`; judge runs exactly once: `t:153-176`. **[page]**
- 1.4 Debate does not derive stances from the question. `stance` is required and non-empty: `ix:109-113`, `ix:235-239`, `t:403-413` (throws `/non-empty stance/`). **[page]**
- 1.5 Every turn after the first sees every earlier argument (this and prior rounds): `t:100-128`. Within a round debaters speak in order, so later ones see earlier ones: `ix:598-600`, `t:776-813` (with a moderator), `t:71-98` (declared order, no moderator). **[page]**
- 1.6 The pipeline internals (`initTranscript`, `stampQuestion`, `incrementRound`, `loopBack`, `forEach`, `keyedRouter`) are mechanism. `ex` has a "How it works" box of them. **[drop]**; the page may keep one sentence of the order of events: moderator (if any), debaters, loop, judge, synthesizer.

## 2. Install and import

- 2.1 `import { debate } from "@flow-state-dev/patterns";` works (`pi:100`). The subpath `@flow-state-dev/patterns/debate` also exports `debate` plus every `create*`, schema and type (`pk:59-62`, `ix:75-100`). **[page]**
- 2.2 `zod` is used for `outputSchema` in the examples (`ix:57`, `ex` snippets). **[page]** (import line only)
- 2.3 Package install command: not stated for this package on a cited surface other than the existing README. **[gap]** for a specific command; the catalog index (`catalog/index.facts.md`) owns the install story. The page links to it.

## 3. Basic use

- 3.1 Minimum config: `name`, `debaters` (2+, unique names), optional `maxRounds` (default 2), optional `outputSchema`. `ix:127-132`, `ix:209-212`. **[page]**
- 3.2 `outputSchema` is applied to the default synthesizer's output. With no `outputSchema` the default synthesizer's output is a plain string (`ds:75`, `ix:396-409`). **[page]**
- 3.3 `outputSchema` with `synthesizer: false` throws `[debate] cannot set outputSchema when synthesizer: false`. `ix:258-262`, `t:440-453`. **[page]** (one clause)
- 3.4 Validation at construction (throws, `[debate] ...`): fewer than 2 debaters (`ix:227-229`, `t:394-401`), a debater without a non-empty name (`ix:232-234`), without a non-empty stance (`ix:235-239`), duplicate names (`ix:240-244`, `t:415-425`), `maxRounds <= 0` (`ix:247-249`, `t:427-438`), `moderator: false` (`ix:263-267`, `t:1287-1299`). **[ref]** (a rows list); the page may name two.
- 3.5 `judge` cannot be `false` ("the verdict is Debate's identity", `ix:136-138`). Typing is `BlockDefinition`; a `false` is not guarded at runtime (no `throw` for it in `ix`). **[ref]**; the page states only that a judge always runs.
- 3.6 The basic-use snippet in `ex` (`name: "feature-debate"`, `advocate`/`skeptic`, `maxRounds: 2`, `outputSchema` of `{ decision, rationale }`) matches `DebateConfig` (`ix:127-199`). **[page]**
- 3.7 What the caller sees on screen: the pattern wraps its run in a container item `{ component: "debate" }` (`ix:421`, `ix:588`) and emits data items (`ctx.emit.data`, client only, not history) with `dataType` `debate-turn-pending` (before each debater, `ix:337-350`), `debate-turn` (after each, `ra:64-68`), `debate-decision` (with a moderator, `ix:552`) and `debate-verdict` (after the judge, `ix:355-369`). Test: `t:338-346` (matches `type === "data"` and `dataType`). `@flow-state-dev/ui` ships a `debate` renderer that draws them (`packages/ui/registry/components/debate.tsx:1-80`). **[page]** (one short passage; the item type names go to Reference)

## 4. Who ends the debate

- 4.1 The loop ends when any of three things holds after a round: the round count reaches `maxRounds`; the moderator's decision for that round has `done: true`; `terminateWhen(ctx)` returns true. `ix:604-621` (moderated), `ix:460-473` (not moderated: the first and third only). **[page]**
- 4.2 They are checked in that order, and `terminateWhen` is not called once an earlier one ends the loop. `ix:607-617`; `t:1225-1262` (both fire after round 2, 2 rounds). **[page]** (as "any of")
- 4.3 `maxRounds` defaults to 2 (`ix:212`). Test: `t:71-98` (2 rounds ran). **[page]**
- 4.4 `maxRounds` above 4 logs a console warning (`ix:250-257`). It does not throw. **[page]**
- 4.5 `terminateWhen` receives the block context. It runs after each round, on both paths (`ix:174`, `ix:464-468`, `ix:612-616`). With no moderator, `terminateWhen` returning true after round 2 gives `rounds: 2` (`t:922-947`); with a moderator, same (`t:949-979`). The doc comment says it should be a pure, total function (`ix:171-173`). **[page]**
- 4.6 A `terminateWhen` that throws fails the run; the thrown message is in `result.error` (`t:1263-1285`). **[page]**
- 4.7 A moderator with `done: true` still gets that round played: both named speakers speak, then the loop exits (`t:888-920`: `rounds` 1, 2 transcript entries, judge ran once, `maxRounds: 5`). The schema doc says the same (`sc:51-53`). **[page]**
- 4.8 `maxRounds` caps a moderator that never says `done` (`t:981-1008`: `maxRounds: 3` gave 3 rounds and 3 decisions). **[page]**
- 4.9 `done: true` with `nextSpeakers: []` is valid; the round counts but no one speaks in it (`sc:62`, `t:1225-1262` script second decision `nextSpeakers: []`, `done: true`, `rounds` 2). `done: false` with an empty `nextSpeakers` is rejected by the schema with the message "Moderator must return non-empty nextSpeakers when done is false." (`sc:62-67`, `t:1360-1372`). **[page]** (one sentence); the whether-the-empty-round-shows-in-the-transcript detail is not asserted by a test, so **[gap]** on "no entries for that round" beyond the code reading `speakersForRound` (`ix:562-571`).
- 4.10 A debater that throws, or a moderator that throws, fails the whole run; `result.error` carries the thrown message (`t:262-288`, `t:1195-1223` with "moderator-boom"). There is no skip-and-continue. **[page]**
- 4.11 The default moderator is told to leave the `maxRounds` cap to the framework ("you do not need to track it", `dm:126-127`). **[drop]**

## 5. Who picks speakers, briefs and decides: the moderator

- 5.1 Optional `moderator` block. Without one every debater speaks every round in declared order. `ix:7-10`, `ix:416-476`; `t:71-98`. **[page]**
- 5.2 With one, it runs at the top of each round and returns `{ nextSpeakers: string[], briefing: string | null, newAngle: string | null, done: boolean }`. `sc:55-61`, `ix:11-17`. **[page]**
- 5.3 The moderator sees the transcript of prior rounds only, because the round's speakers have not run (`ix:143-148`; `t:694-737`). Default moderator input: the question, the whole transcript with agent names and stances, and its own prior decisions (`dm:139-181`). Names are not anonymized for it (`dm:7-10`). **[page]**
- 5.4 Speakers run in the order the moderator names them, one at a time. `ix:598-603`, `t:738-775`. **[page]**
- 5.5 The same name twice in one round gives two turns by that debater (`t:1040-1071`: transcript `1:a, 1:a, 2:b`). **[page]**
- 5.6 A name not in the roster fails the run; the message contains the bad name in quotes and `Available: a, b` (`t:1010-1038`, lines `1029-1036`). **[page]**
- 5.7 `briefing` and `newAngle` are each optional and independent; either may be null. The default debater shows the current round's `briefing` and `newAngle` in its prompt when set (`dd:272-296`; `t:814-887`). A custom debater block reads `state.moderatorDecisions` itself (`dd:277-279` shows the read; the doc line is `ex:186`, whose heading text is wrong, see flag 1). **[page]**
- 5.8 The moderator can have tools. `createModerator({ tools, uses })` passes them to its generator (`dm:49-50`, `dm:76-77`). Tool calls appear as ordinary tool items (`goals/.../host/fixtures.ts:151`). The default prompt asks it to fold findings into `briefing` so every debater argues from the same facts (`dm:98-102`). **[page]**
- 5.9 `createModerator({ name, rosterNames, transcript, ... })`: `rosterNames` constrains its choices in the prompt (`dm:39-46`, `dm:87-96`). The default prompt tells it to name the full roster by default and use `newAngle` instead of dropping a debater (`dm:104-116`, `dm:131-133`). **[page]**
- 5.10 Custom moderator: any block whose output matches `debateModeratorOutputSchema` (`sc:55-67`, `t:653-693`). If it reads the transcript it must be handed the same `transcript` resource as `debate()` (`ix:155-165`). **[page]**
- 5.11 `moderatorDecisions` on the raw output: one entry per round, `[]` with no moderator. `sc:82-91`, `sc:115-122`, `t:1073-1126`. **[ref]**
- 5.12 Decisions the moderator made about briefing do not reach the judge; the judge's user prompt carries the question, the list of stances, and the transcript only (`dj:129-150`). The default synthesizer does receive the briefings and angles ("Framing notes", `ds:86-101`). **[page]**

## 6. Pick a winner or synthesize: who chooses

- 6.1 The judge chooses. Its prompt: "Decide which position is best supported", and it "may also synthesize a position that combines the strongest points of multiple stances; in that case set winner=null"; it must cite specific arguments (`dj:119-123`). **[page]**
- 6.2 `winner: null` means the judge combined stances (`sc:33`, `t:205-230`). A custom judge returns the same shape; null is supported (`ix:134-138`). **[page]**
- 6.3 The caller cannot force one or the other through config. The only lever is `instructions` (inserted into default blocks only, `ix:176-177`, `dj:110-117`) or a custom `judge`. **[page]**
- 6.4 A custom `judge` receives `{ question }` plus the transcript resource, and must return `{ verdict, winner, reasoning }` (`ix:133-139`; `dj:103` shows the resource the default declares). **[page]**
- 6.5 The default synthesizer is a third step after the judge. It writes the final answer to `outputSchema` from `DebateRawOutput`; its prompt says to lead with the conclusion, present a synthesized view as its own, and not mention the debate, debaters, judge, rounds or verdict (`ds:45-70`, `ds:81-119`). **[page]**
- 6.6 `synthesizer: false` returns `DebateRawOutput` (`rounds`, `question`, `transcript`, `verdict`, `moderatorDecisions`) as the output (`ix:393-395`, `sc:115-122`, `t:88-96`). A custom `synthesizer` block receives the same shape (`t:232-260`, `t:1127-1162`). **[page]**
- 6.7 The raw `transcript` has entries `{ round: number (>=1), agentName, stance, text }` (`sc:20-25`). **[page]**

## 7. Stances and debaters

- 7.1 `DebaterConfig`: `name` (unique, also the task assignee, `ix:104-108`), `stance` (required), `role?` (persona line, ignored when `block` is set, `ix:114-118`, `dd:214-216`), `block?` (replaces the default LLM debater; must return a string or `{ text }`; other shapes are coerced with `String()` and warn once per debater, `ix:119-124`, `ra:246`, `packages/patterns/src/shared/coerce.ts:20-36`). **[page]**
- 7.2 The default debater's prompt: it argues the assigned stance, addresses the strongest counter-arguments, is told "Hold your position" and "Do not concede" (`dd:250-257`). **[page]**
- 7.3 It reads the prior transcript tagged by stance, never by name: `[for] ...` (`dd:181-191`, `dd:268-271`; `t:505-563`). **[page]**
- 7.4 Three or more debaters are allowed; they speak in declared order (`t:129-152`, `ix:229`). **[page]**
- 7.5 The default debater streams plain text (`outputSchema: z.string()`, `dd:220-225`). Its items are visible to the client and not saved to model history by default (`debaterVisibility` default `{ client: true, history: false }`, `dd:232`). Judge and synthesizer default to `{ client: true, history: true }` (`dj:105`, `ds:79`); the moderator `{ client: true, history: false }` (`dm:66`). `ItemVisibility = { client: boolean; history: boolean }` (`packages/contracts/src/items/types.ts:13-16`). **[ref]**
- 7.6 Stance words in the page's own example ("ship now" vs "do not ship now") come from `ex`; any stance string works. **[page]**

## 8. The judge's view

- 8.1 The judge sees the question, the list of stances, the round count and the full transcript grouped by round (`dj:129-150`). **[page]**
- 8.2 `anonymizeTranscript` (default `true`): the judge's view tags each argument `[stance]` with no name. `false`: `[agentName, stance]`. `dj:84-90`, `ix:221`; `t:565-651`, `t:455-503`. **[page]**
- 8.3 `shuffleForJudge` (default `true`): argument order within each round is shuffled for the judge. `dj:73-82`, `ix:222`; `t:484-503` (deterministic with an injected RNG, not reachable from `debate()` config). **[page]**
- 8.4 `anonymizeTranscript: false` with an explicit `model` and no custom judge logs a warning (`ix:268-274`). **[ref]**
- 8.5 `formatTranscriptForJudge(entries, { anonymize, shuffle, random? })` is exported to render the same view in a custom judge (`dj:52-60`). **[ref]**
- 8.6 The moderator is not subject to either toggle (`dm:7-10`). **[page]** (one clause)

## 9. When debate is the wrong tool

- 9.1 Cost shape, observable from the code: each turn's prompt includes every prior argument (`dd:268-271`), so prompt size grows with turns taken. Generator calls per run: debaters x rounds, plus one judge, plus a synthesizer unless `synthesizer: false`, plus one moderator call per round when a moderator is set (`ix:416-476`, `ix:578-621`, `t:153-176`). `ix:131` (>4 rounds: "diminishing returns"; `ix:254-256` warns about "sycophantic convergence and rapid token growth"). **[page]**
- 9.2 Against Round Robin, behavior differences the page may state from code: Debate returns a verdict and a (default) synthesized answer, needs a stance per debater, and runs a judge once at the end. Round Robin's referee and termination are in `ex`'s comparison table (`ex` and `apps/docs/docs/patterns/round-robin.md:142-146`). Verify each Round Robin row against `packages/patterns/src/round-robin` at pass 5 before the page states it. **[page]** with that check
- 9.3 Nothing citable says when a single call is enough, or that a question is "factual enough" for debate to add nothing. `ex`'s "When NOT to use it" list (discrete-answer lookup, uncontroversial answers, one-call budgets) is advice, not observed behavior. **[gap]**; the page may keep it as the author's advice, framed as a judgment, and not as a measured result.
- 9.4 Limits the page can state flat: stances are caller-supplied; a failing turn fails the run (4.10); no debater may be `false` and a judge always runs; the default synthesizer is told not to reveal the debate (6.5). **[page]**

## 10. Stored parts (the four questions)

The pattern stores three things. Answers cite the code; where a reading is by code inspection only it says so.

**10.1 The transcript (session resource).**
- Who owns it: the pattern. `debate()` creates one with `createDebateTranscript()` unless `transcript` is passed (`ix:277`). `createDebateTranscript()` is `defineResource({ scope: "session", stateSchema, writable: true })` (`sc:106-112`). Caller-owned when passed in (`ix:155-165`). **[page]**
- Who can see it: server-side blocks that declare it (`resources: { transcript }` on the default debater, judge, moderator, `dd:230`, `dj:103`, `dm:64`). No `client` config is set, so the resource is not shown to clients as a resource (`sc:106-112`; `packages/core/src/types/resource.ts:323` "Omit to keep the resource invisible to clients"). What clients do see is each turn's text in the `debate-turn` component items (`ra:279-283`) and, per `debaterVisibility`, the debater messages (7.5). **[page]**
- Where it is stored: the session's resource store (session scope). `sc:107`. Which store backs it depends on the app's store configuration, not on the pattern. **[ref]**
- How many: one per session per `transcript` resource instance, holding `{ entries: [...] }` (`sc:95-98`). Each run starts by setting `entries` to `[]`, so a second run in the same session overwrites the first run's transcript (`it:204-206`). A run appends one entry per turn (`ra:253-259`). **[page]** The raw `transcript` in the run's output is a copy taken at the end (`ix:372-383`).
- Two `debate()` blocks in one flow with default transcripts: `ix:155-165` says resources "must share the resource reference, otherwise the framework's resource-merge rejects two `defineResource()` instances declared against the same key". That sentence concerns a custom block declaring the transcript; whether two separate `debate()` calls collide is not asserted by any test. **[gap]**; the page must not say either way. Say: pass one `transcript` to a custom moderator, judge or synthesizer that reads it, as the doc comment instructs.

**10.2 The audit task collection (sequencer state).**
- Who owns it: the pattern; one `TaskCollection` per run keyed by `collectionId` (default `name`). `ix:276`, `ix:197-198`, `it:207-212`. **[page]**
- Who can see it: DevTool and anything reading `task-change` data items. Each turn emits at least one `task-change` item; 2 rounds x 2 debaters gave at least 4 (`t:386`). **[page]**
- Where it is stored: `backing: "state"`, on the debate sequencer's own state (`it:209-211`, `ra:261-266`; `packages/orchestration/src/tasks/collection/state-backed.ts:3-14`). That file says only a sequencer's state is checkpointed and restored on resume. **[ref]**
- How many: one task per (round, debater) turn: `goal` `"<agentName> (round <n>)"`, `assignee` the debater name, `metadata` `{ round, stance }`, completed with `{ text }` (`ra:267-275`). A moderator naming a debater twice in a round makes two tasks. **[page]**

**10.3 Sequencer state (per run).** `question`, `round`, `moderatorDecisions` (`sc:82-91`). Owner: the debate sequencer. Visible: server blocks via `ctx.sequencer.state`; the final values go out in the raw output (`ix:372-383`). Stored: in the run's sequencer state. Count: one per run, `moderatorDecisions` grows by one per round with a moderator. `moderatorDecisions` is not seen by clients except as `debate-decision` items (`ix:552`). **[ref]**

## 11. Exports and config

- 11.1 Exported from `./debate`: `debate`, `createDebateTranscript`, `createDebater`, `createJudge`, `createModerator`, `createSynthesize`, `createInitTranscript`, `createRecordArgument`, `formatTranscriptForJudge`, seven schemas, and the types `DebateInput`, `DebateState`, `DebateContributionEntry`, `DebateVerdict`, `DebateTranscriptState`, `DebateRawOutput`, `DebateModeratorOutput`, `DebateModeratorDecision` (`ix:75-100`). `DebateConfig` and `DebaterConfig` are exported from the file (`ix:103`, `ix:127`) and from the root (`pi:109-113`). **[ref]**
- 11.2 Config fields and defaults: `name` (required), `debaters` (required), `maxRounds` 2, `judge`, `synthesizer`, `moderator`, `terminateWhen`, `transcript`, `outputSchema`, `instructions`, `model`, `uses`, `tools`, `context`, `anonymizeTranscript` true, `shuffleForJudge` true, `judgeVisibility`, `synthesizerVisibility`, `debaterVisibility`, `collectionId` (defaults to `name`). `ix:127-199`, `ix:209-225`, `ix:276`. **[ref]**
- 11.3 `instructions` reaches the default debater, judge and synthesizer, inserted as "Overall Instructions" in their system prompts (`dj:110-117`, `dd:242-249`, `dm:79-86`, `ds:80`); it is "Pattern-level instructions injected into default blocks only" (`ix:176-177`). `debate()` does not pass `instructions` to a `createModerator` the caller built; the caller sets it on the moderator (`dm:51`). **[ref]**
- 11.4 `uses`, `tools`, `context` are forwarded to the default debater, judge and synthesizer (`ix:321-325`, `ix:402-404`, `ix:438-441`). **[ref]**

## 12. Cross-links the page may carry

- Round Robin (`catalog/patterns/round-robin`), the sibling for a deliverable; Routed Specialists, for context-driven next speaker (`apps/docs/docs/patterns/routed-specialists.md`); the patterns overview (`apps/docs/docs/patterns/overview.md:65`, `:94`). `ex:311-315`. **[page]** (verify the routed-specialists page exists in the revamp sitemap; if it is not planned, drop the link)

## 13. Needs a decision before the draft

- The sitemap's one-line job names three questions. 1 (who ends it): facts section 4, answerable. 2 (winner or synthesis): section 6, answerable, with flag 6 on what `winner` holds. 3 (when is it the wrong tool): only 9.1 and 9.4 are citable; 9.3 is advice without evidence. The page must frame that part as the author's guidance and state the cost and failure behaviors as facts.
- No runnable example uses the pattern (flag 8). The draft's code must come from `ex`'s two snippets (they match `DebateConfig` and `createModerator`'s options) and be type-checked.

## Revise round 1

- Page cut to about 1,100 prose words. It carries no config table, `DebaterConfig` table, exported-API list, `DebateRawOutput` shape block, `moderatorDecisions` shape, pipeline step names, validation list or default-model list: those are rows for R-41 (`reference/patterns.md`). Sections 3.4, 3.5, 5.11, 7.5, 8.4, 8.5, 10.3, 11 and facts 4.4, 4.9, 5.3, 5.6 (names), 7.1 (coercion with `String()` and a one-time warning) stay here as the source for those rows.
- Moderator opens every round, round 1 included (`ix:520-530`). The page no longer says "rounds 2+".
- `briefing` and `newAngle` apply to the current round: the default debater picks the decision whose `round` equals the current round (`dd:123-127`) and renders `Briefing from the moderator:` and `Focus for this round:` (`dd:128-135`).
- Debaters see arguments as `[<stance text>] <text>`, the stance string itself, not a for/against label (`dd:29-38`). The page's example shows `[ship now] ...`.
- Each `moderatorDecisions` entry is `{ round, nextSpeakers, briefing, newAngle, done }` (`sc:67-73`). The page lists the four fields a moderator returns; the entry shape is Reference.
- Imports: `debate` comes from the root or from `./debate`; `createModerator` and `createDebateTranscript` need `@flow-state-dev/patterns/debate` (`pi:100-113`, `pk:59-62`). Every example imports `z` and what it uses, and all three type-check against the package source.
- Round Robin is a sibling to pick when you want a deliverable, not what Debate is built on (flag 2). The page does not say "chassis".
- Transcript mismatch: the page says only that the moderator must share the debate's transcript (`ix:155-165`); when the rejection happens is not asserted by a test, so it is not stated.
- Page cites no mitigation as proven; it names the two judge toggles and the warning above 4 rounds as settings. Mitigation defaults beyond those are Reference.

## Revise round 2

- `moderator: false` is rejected at construction (`ix:263-267`, `t:1287-1299`): leave `moderator` out. `judge: false` is typed out, not guarded at runtime (3.5); the page says only that a judge always runs.
- Custom debaters read the moderator decisions from sequencer state, `ctx.sequencer.state.moderatorDecisions`, picking the entry whose `round` equals `state.round` (`dd:109-127`).
- `createModerator({ name })` names its block `<name>-moderator` (`dm:59-60`), so the moderator in the page's example does not collide with the debate block's name.
- Debaters see stances, not names (`dd:268-271`); the judge's view is governed by `anonymizeTranscript` (8.2).

## Revise round 3

- Findability of the build-time failures: the page now says an empty `stance` and fewer than two debaters each throw at construction with a `[debate]` message (3.4, 1.4, `ix:227-229`, `ix:235-239`, `t:394-413`), that stances are never derived (1.4), and, under "What it won't do", names duplicate names and `maxRounds <= 0` too. `outputSchema` with `synthesizer: false` and `moderator: false` were already on the page. The full list stays a Reference row (3.4).

## Review fix (Codex): what a custom debater block receives

- **[page]** A debater entry with `block` replaces the default debater whole: `debate()` runs `entry.block ?? createDebater({ ..., stance, transcript, ... })` (`ix:427-445` without a moderator, `ix:496-513` with one), so the stance, the transcript and every pattern-level option go only to the default.
- **[page]** Its input is not the question. Without a moderator the first debater of a round gets `incrementRound`'s `{ round }` (`ix:299-310`) and each later one gets the previous step's output; with a moderator each speaker's sub-sequencer gets the speaker name from `.forEach` (`ix:577-581`, `ix:601-603`). The page states only that the input is not the question.
- **[page]** The question and the round are on the debate sequencer's state, `{ question, round, moderatorDecisions }` (`sc:83-91`), read through `ctx.sequencer.state` when the block declares `sequencerStateSchema: debateStateSchema`, as the default debater does (`packages/patterns/src/debate/blocks/default-debater.ts:79`, `:112-113`). The per-speaker sub-sequencer declares no `stateSchema`, so `ctx.sequencer` resolves to the debate sequencer on the moderated path too (`ix:486-493`). `debateStateSchema` is exported from `./debate` and the root (`ix:75-84`, `pi:102`).
- **[page]** Earlier turns are in the transcript resource, `{ entries: { round, agentName, stance, text }[] }` (`sc:20-25`, `sc:95-98`), appended in turn order (`ra`, `packages/patterns/src/debate/blocks/record-argument.ts:40-45`). A block reads it by declaring `resources: { transcript }`, as the default debater does (`default-debater.ts:78`, `:113-115`), with the same resource passed to `debate({ transcript })` (`ix:155-165`). A second `createDebateTranscript()` under the same key throws `Resource conflict: "transcript" is declared with different defineResource() references` (`packages/core/src/blocks/internal/build-block.ts:77`). `createDebateTranscript` and the `DebateTranscriptState` type are exported from `./debate` (`ix:83`, `ix:90`).
- **[page]** The stance is not exposed to a custom block at run time; the block writes it into its own prompt. No helper or hook passes it (`ix:102-125`, `ix:75-100`).
- Evidence: the page's three examples type-checked in `apps/kitchen-sink/zz-fix-g-debate/` (only the planted error; a probe confirmed `ctx.sequencer!.state` is typed as `DebateState`), deleted afterwards. A throwaway vitest (`packages/patterns/test/zz-custom-debater.test.ts`, deleted) ran the page's block in a two-round debate with and without `createModerator`: the block saw `Question: Ship billing?`, `Round 1.`/`Round 2.` and the stance-tagged earlier turns. Passing a fresh `createDebateTranscript()` to `debate` instead of the shared one failed with the resource-conflict error above.
