# Facts for Standing rules (K-09, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example. No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read. Every surface named here is built, so no fact is a spec's name marked for reconciling. Tracker ids in code comments and goal files were ignored and never go on the page.

Paths are from the repo root. Abbreviations:

- `sr` = `apps/docs/docs/workforce/standing-rules.md` (today's page; the draft at `docs/contributing/docs-revamp/pages/catalog/workforce/standing-rules.md` is the same text)
- `wf` = `packages/workforce/src`
- `st` = `packages/workforce/src/standing-rules/`
- `tk` = `packages/workforce/test/standing-rules.test.ts`
- `tl` = `packages/workforce/test/standing-rules-list.test.ts`
- `g1` = `goals/standing-rules/a-note-outlives-its-session/goal.md`
- `g2` = `goals/standing-rules/the-rules-page-edits-what-the-worker-follows/goal.md`
- `rd` = `packages/workforce/README.md` (live; the cut copy is `docs/contributing/docs-revamp/readmes/workforce.md`)
- `kit` = `packages/workforce/src/kit/workforce-kit.ts`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/workforce`); the page links, does not state it. **[verify]** only an existing page backs it; pass 5 must read the code before it reaches the page. **[cut]** history or mechanism; never on the page. **[checked]** read against code or a test in this pass.

## Flags against the page plan and today's page (read first)

1. **There is nothing to turn on.** The plan's example "Turning it on" has no switch behind it. The agent flow always lists the standing-rules capability in its `uses` (`wf/agent-worker-flow.ts:1081-1085`), declares the `standingRules` action (`wf/agent-worker-flow.ts:1506`), and the coordinator flow declares the action (`wf/coordinator/coordinator-flow.ts:1770`) and marks user turns (`wf/coordinator/coordinator-flow.ts:754`). The kit's config and slots hold no rules option (`kit:138`, `kit:178-183`). An app that installs the kit with `agent` (and `coordinator`) has it. The page's "install it" and "turning it on" parts are the same step. State that flat and show the kit line from the example below. **[checked]**
2. **Standing rules are not a kit.** The plan puts the page on the kit template. They are a feature of the `workforce` kit's worker flows. The kit declares no slot for them, fills no slot, and serves no view. The "slots" parts of the template have nothing to hold; say so in a clause or drop them. `kit:178-183` (slots are `workerFlows`, `uses`, `flows`). **[checked]**
3. **A third flow keeps rules: the error reporter.** Its flow declares the action (`wf/error-reporter/flow.ts:726`) and reads the list into its prompt (`wf/error-reporter/flow.ts:279-286`, the operator's rules, `instructionsOf`). Today's page says "agent or coordinator" only; `sr:70` and `sr:41` omit it. The page may name it in one clause and link `error-reporter.md` (`apps/docs/docs/workforce/error-reporter.md:98` already says "always label these P2" saves a rule). It marks user turns itself (`markUserTurnStep`, `wf/error-reporter/flow.ts:18`); whether its tools are offered was not run. **[verify]** the tools on the reporter; the action and the prompt read are **[checked]**.
4. **The user-facing "Rules page" is Shift Manager, an app, not the kit.** Code comments and goals say "the Rules page" and "Settings"; no workforce export draws it (`st/rules-list.ts:159`, `st/rules-action.ts:66`). `g2:3-12` describes Shift Manager's worker settings: a Rules section where a user adds, edits and deletes, marked "added here". The page may say an app can draw a screen over `standingRules` and that Shift Manager does. It must not describe Shift Manager's layout beyond that. **[checked]** against the goal text; the app's source was not read.
5. **A rule's `sessionId` is `null` for a rule added through the client.** Source comment says "`null` when it was added on the Rules page" (`st/rules-list.ts:159`); the action always passes `null` (`st/rules-action.ts:67`), the tool passes the session id (`st/rules-capability.ts:134`). Today's page says it right (`sr:115`). **[checked]**
6. **Today's page claim "Memory ... is shared by all of a user's workers" is not backed.** The memory overview says the episodic, semantic and digest tiers have scope `user` and working is `session` (`apps/docs/docs/memory/overview.md:32-38`). It does not say "shared by all workers". The recall behaviour ("comes back when a search finds it", `sr:57`) is on `memory/recall-tool.md`, not read in full. The page may say rules differ from memory in that a rule is put in front of the model on every turn; it must not state memory's sharing without reading the memory pages. **[verify]**
7. **Today's page example has a free variable.** `sr:93-96` uses `userId` and `baseUrl` undeclared. The new page declares them as parameters of a function. **[checked]**
8. **"The tool writes these lines, not the model."** True, and a guarantee the reader can see (`st/rules-capability.ts:146-153`: `ctx.emit.message(...)` with `itemVisibility: { client: true, history: false }`). Keep the guarantee ("you see them; the model does not get them back as history"); cut the field names. **[page]** **[checked]**
9. **Most of today's page is Reference.** Keep on the page: what a rule is, saving one in conversation, where it applies, whose it is, how to remove one, rule or brief, and the kit line. Move to `reference/workforce`: the client action's four-input table, the refusal list (stale version, full, text, mismatch), the output shape, the limits table, `rules: true` on the inventory row, the `sessionId` meaning, the tool names table. The page keeps one sentence per row and links. **[ref]**

## 1. What a standing rule is (opening)

- A standing rule is a note a user asks a worker to keep. The worker saves it, and every later turn it takes for that user follows it. `sr:3-8`, `st/rules-capability.ts:171-175` (the add tool's own description: "Save a note this user gave you as a standing rule you follow in every later conversation with them. Use it when they tell you how to work from now on."). **[page]** **[checked]**
- The note is one line of text, 1 to 300 characters, in the worker's words (`MAX_RULE_CHARS = 300`, `st/rules-list.ts:152`; the tool description says "in your words", `st/rules-capability.ts:174`). The text is trimmed before it is stored (`st/rules-list.ts:223`). **[page: one line; the trim is ref]** **[checked]**
- A worker keeps at most 20 rules per user (`MAX_RULES = 20`, `st/rules-list.ts:149`). **[page]** **[checked]**
- Every rule shows in the conversation as a line when it is written (section 2). **[page]**
- The worker saves a rule without asking first. The add tool's description tells it to use the tool "when they tell you how to work from now on" (`st/rules-capability.ts:173`). No confirmation step exists in the code. `sr:19` ("It doesn't ask first") is backed by this. **[page]** **[checked]**

## 2. Saving a rule in a conversation (the page's example)

The page's one scenario is the engineering lead and a user, Alice. The names below come from `sr` and the tests, which use `alice` and a worker `eng-lead`/`lead`.

- A user tells the worker "Always name the project before the status." and the worker calls `rules/add`. `tk:257-262`.
- The conversation shows the line `✎ Rule added (1 of 20): "Name the project before giving a status."` The line is `✎ Rule added (<count> of 20): "<text>"`. `st/rules-list.ts:233`, `tk:261`. **[page]** **[checked]**
- The count is the list length after the add, not the rule's number; an add always goes at the end, so the two agree. `st/rules-list.ts:232-233`. **[checked]**
- A change shows `✎ Rule 1 changed: "<old>" → "<new>"`. `st/rules-list.ts:261`, `tk:271`. **[page]** **[checked]**
- A remove shows `✎ Rule 1 removed (0 of 20 left): "<text>"`. `st/rules-list.ts:250`, `tk:272`. **[page]** **[checked]**
- The line is a message in the session, posted under the agent name `standing-rules` (`STANDING_RULES_LINE`, `st/keys.ts:20`), visible to the client and kept out of the model's history. `st/rules-capability.ts:153`, `tk:106`. A renderer can tell the line from a reply by that name. **[ref]** (the name), **[page]** (the guarantee)
- A change keeps the rule's `addedAt` and `sessionId`; only the text changes. `st/rules-list.ts:157`, `st/rules-list.ts:257`, `tl:65-70`. **[ref]**
- A remove renumbers the rest. `tl:72-76`. **[page, one clause]** **[checked]**
- A user changes or removes a rule by asking in words; the worker calls `rules/change` or `rules/remove` naming the rule by number and quoting its current text. The change or remove is refused, and nothing changes, when the quoted text is not that rule's text or the number names no rule. `st/rules-capability.ts:184-199`, `st/rules-list.ts:236-243`, `tl:78-85`. **[page]** **[checked]**
- Four tools: `rules/read` lists the rules numbered, with the cap (`{ rules: [{ number, text }], max }`, `st/rules-capability.ts:115`, `:157-168`); `rules/add`, `rules/change`, `rules/remove`. Names in `RULE_TOOLS`, `st/keys.ts:9-14`. **[page: names and one clause each; shapes ref]** **[checked]**
- The read tool's description tells the worker the rules are "already in your instructions every turn; read them here before changing one". `st/rules-capability.ts:160`. **[ref]**
- A tool answer is either `{ rules, max, line }` on success or `{ rules, max, refused }` on refusal, the refusal being `Refused: <reason>.`. A write that cannot be stored answers `Not saved: <reason>` and the turn goes on. `st/rules-capability.ts:119-155`, `tk:277-290` (no saved line is posted). **[ref]**
- A failed store write posts no line and loses no existing rule. `tk:277-290`. **[page, one sentence]** **[checked]**
- When a list is full, an add is refused, nothing is saved, and the user sees `✎ Rule not added: the list is full (20 of 20); merge or drop a rule before adding one.` The worker is told, in the add tool's description, to ask which rule to merge or drop. `st/rules-list.ts:226-230`, `st/rules-capability.ts:144-150`, `st/rules-capability.ts:174-175`, `tk:292-305`. Only the full case posts a line for a refusal; a stale quote or a bad text comes back to the model only. `st/rules-capability.ts:144`. **[page]** **[checked]**

## 3. Where a rule applies

- Every turn the worker takes for the user gets the user's rules in the prompt: a conversation turn, a task turn the worker runs for that user, and a coordinator's turn. `st/rules-capability.ts:1-7` (the capability's header: a task turn reads the filing user's list because it runs at that user's scope), `tk:323-335` (a task for `otto` filed by Alice carries Alice's rule and not Bob's). **[page]** **[checked]**
- The rules are put in the prompt after the worker's own instructions. `tk:309-321` (the worker's instruction text appears before `Standing rules`). Today's page also says "after ... its team's instructions and its packages" (`sr:46`); the README says the same (`rd:790`). The ordering against team instructions and packages was not run. **[page: "after the worker's instructions"]** for the first; **[verify]** the rest.
- The text: the heading `Standing rules (notes this user asked you to keep; follow them on every turn):` then `1. <text>` per rule. An empty list adds nothing. `st/rules-list.ts:271-277`, `tl:99-104`. **[ref]** (exact heading); **[page]** "numbered, under a heading; none when there are none".
- A rule counts from the next turn, with no new session. `tk:309-321`. **[page]** **[checked]**
- The list is read when the turn reads it, not when the request starts (`prefetchMode: "lazy"`, `st/rules-record.ts:70`). **[cut]**
- If the rules cannot be read (the store is down, the record is malformed), the turn runs without them, emits one status line, `This turn runs without standing rules: they couldn't be read (<reason>).`, and does not fail. `st/rules-capability.ts:100-113`, `tk:337-364`. **[page]** one sentence; the line's text **[ref]** **[checked]**
- A task a worker runs follows the filing user's rules and cannot change them. `tk:128-143`, `tk:323-335`. **[page]** **[checked]**
- The worker is not told who saves a rule vs who reads it; a rule applies to every conversation of that user with that worker, in any session, including tasks the user filed. `tk:309-335`. **[page]** **[checked]**
- Tools are offered only on a turn a user's own message started. Not offered on: a task turn (a coordinator's filing of a task for an agent), the coordinator turn a task's ending wakes, a coordinator's routed task to an agent delegate, a user's message inside a task's session or a conversation's delegate session. `tk:116-153`, `tk:210-230`. **[page]** (the first three as one sentence) **[checked]**
- A rule tool called by name on an unmarked turn refuses, writes nothing and answers `Standing rules change only on a turn a user started; this one can't edit them.` `st/rules-capability.ts:126-130`, `tk:232-253`. **[ref]**
- The mark is set at two doors only: the agent flow's `respond` action and the coordinator's first post from a user. Every other entry never sets it. `st/user-turn.ts:1-14` (header), `wf/agent-worker-flow.ts:1480`, `wf/coordinator/coordinator-flow.ts:754`. **[cut]** mechanism; the guarantee in the line above is the page's.
- A user's message after a task and all its follow-ups have ended is "still no user's turn" (no rule tools) in that task's session. `st/user-turn.ts:243-252`, `tk:210-230`. **[ref]**
- The tools are `controlTools` of the capability, so a `tools:` line in `WORKER.md` neither lists them nor removes them. `st/rules-capability.ts:212`, `st/rules-capability.ts:1-3`, `tk:116-126`, `rd:718-719`, `apps/docs/docs/workforce/built-in-worker.md:58`. **[page]** **[checked]**

## 4. Whose rules they are (the four questions)

The stored part is one: the **rules list**, a record named `standing-rules` (`STANDING_RULES_RESOURCE`, `st/rules-record.ts:52`). Its fields: `version` (an integer counting writes, default 0) and `rules`, each `{ text, addedAt, sessionId }` (`st/rules-list.ts:155-175`).

- **Who owns it.** One worker, for one user. The record is keyed by the worker the session is verified to run as (`verifiedWorkerOf`, `st/rules-record.ts:86-89`), not by anything the caller sends; a request that names a user is refused (`st/rules-action.ts:10`, `:22-35` use `.strict()` schemas; `tk:410-411` asserts `userId` in the input is refused). The user owns the content in the sense that only the user's own turns write it. Nobody on a team, and no standard worker's file, owns or edits it. **[page]** **[checked]**
- **Who can see it.**
  - The user the rules belong to, in their own turns (the prompt) and through the client (`standingRules` read). `tk:367-379`: Bob reads none of Alice's list, and Bob's turn does not carry Alice's rule. **[page]** **[checked]**
  - The model, as the numbered text in the prompt on each turn. **[page]**
  - A browser: the record's state is readable from the user's own session; the record's content is not, and the browser cannot create, update or delete it. `client: { state: { read: true }, content: { read: false, create: false, update: false, delete: false }, expose: ["version", "rules"] }`, `st/rules-record.ts:72-76`. Tests: a GET on the record is 200; a POST, PATCH and DELETE are 4xx; the list is unchanged. `tk:381-411`. **[page, one sentence]** **[checked]**
  - Another user: no. A coordinator's other users, and other users of the same worker, each have their own list. `tk:368-379`. **[page]** **[checked]**
  - Whether an operator or admin of the app can read another user's list through the store or the client was not tested and has no exported surface; the page must not say who "cannot" beyond "another user's turn never reads it" and "the client reads the signed-in user's own". **[verify]**
- **Where it is stored.** In the resource store at user scope (`scope: "user"`), under the key `standing-rules/<encoded worker id>`, in a bucket for the worker's flow copy (`flowIsolation: true`). `st/rules-record.ts:62-66`, `st/rules-record.ts:60`. The key's own copy fallback is `standing-rules/worker` on a flow copy minted for one worker (`st/rules-record.ts:58`, `:86-89`). On a persistent store (SQLite, Postgres) it survives a restart; the goal shows the notes followed after a restart (`g1:12`: "After a restart, 3 of 3 fresh sessions open with `Noted —`"). **[page]** (scope and survival), key shape **[ref]**
- **How many exist.** One record per worker per user (per worker flow copy), holding at most 20 rules of at most 300 characters. A user with five workers has up to five lists. `st/rules-list.ts:149-152`, `tk:368-379` (`otto`, `nora`, `lead` each have their own empty list for Alice). **[page]** **[checked]**
- **What ends a list.**
  - Fork: a worker forked from another, with a different id, starts with none. `tk:415-421`, `rd:814`, `sr:55`. **[page]** **[checked]**
  - Fire and hire again with the same id: the earlier rules come back. `tk:423-425`. The page may say so in one sentence under "whose they are"; today's page and README omit it. **[checked]**
  - Moving a worker to a different worker flow leaves its rules on the old flow; the worker starts with none. `tk:427-428`, `st/rules-record.ts:64-65`, `sr:133`. **[page]** **[checked]**
  - A worker whose flow does not declare the record (an app's own flow without the capability) cannot read or write: `This flow doesn't declare "standing-rules".` `st/rules-record.ts:104`. Its inventory row says `rules: false`. **[ref]**
- A rule is not memory: a rule is put in front of the model on every turn, the list is capped at 20, and the worker edits it by number. Memory has tiers and recall (`apps/docs/docs/memory/overview.md:32-38`). **[page, one sentence]**; sharing across workers **[verify]** (flag 6).

## 5. Rule or brief: "always answer in French"

The page's third question. The answer is derived from observable behaviour; the page must give it plainly.

- A **brief** is the worker's file: `WORKER.md`'s body is its instructions, and a standard worker's file is the same for every user. Nobody can change a standard worker while the app runs. `apps/docs/docs/workforce/durable-hire.md:10-12` ("A worker your installation's files declare is a standard worker: every user has it, and nobody can change it while the app runs."); `wf/agent-worker-flow.ts` reads the instructions from the worker's config (`wf/error-reporter/flow.ts:277` shows `config.instructions` as the body). **[page]** **[checked]**
- A **rule** is one user's note to one worker, saved from a conversation, in that user's own list, read on every turn that worker takes for that user. `st/rules-capability.ts:171-175`. **[page]**
- So "always answer in French" is a rule when one user wants it and the others do not; it is a brief line when every user of the worker should get French. A user's rule cannot change the worker's instructions or another user's turns. `tk:323-335`, `tk:367-379`. **[page]** **[checked]** (the split is the reader's decision; the page states both effects and does not invent a third)
- A rule cannot override what the file forbids by taking tools away: the rule tools are always on, and a rule is text to the model, not a setting. The worker's instruction text comes first and the rules after it (`tk:309-321`); how the model weighs a rule against an instruction is not a guarantee. The page must not promise a rule beats the file. **[checked]**
- A user's own hired worker is a brief the user writes themselves (`durable-hire.md`: a hire is stored in the user's data, nobody else can see it). For that worker the user can put the same line in the worker's own instructions. **[verify]** against `durable-hire.md` before the page says it.

## 6. Removing a rule

The page's second question. There are three ways, each backed.

- Ask the worker in words to drop it; it calls `rules/remove` with the number and the rule's current text, and the line `✎ Rule <n> removed (<left> of 20 left): "<text>"` shows. `st/rules-capability.ts:192-199`, `tk:269-274`, `g1:13` ("She asks to drop it, and a '✎ Rule … removed' line shows"). **[page]** **[checked]**
- An app calls `workforce.standingRules(workerId, { op: "remove", version, number, current })`; it answers the list after the call and the line. A stale version, a wrong `current`, or no such number rejects the promise and changes nothing. `wf/workers/client.ts:182-187`, `:477-481`, `st/rules-action.ts:21-36`, `:63-70`, `tl:78-97`, `tk:432-445`. **[page]** the call; the refusals **[ref]** **[checked]**
- Shift Manager's worker Settings has a Rules section where a user deletes a rule. `g2:3`, `g2:15-16`. Shift Manager is the app in `packages/shift-manager` (a package, run as the `shift-manager` command); cite only through the goal. **[page, one clause]** **[checked]** against the goal text.
- There is no "remove all" input and no way to remove another user's rule. `st/rules-action.ts:21-36` (four inputs), `tk:367-379`. **[checked]**
- Removing a rule takes effect from the next turn. `tk:309-321`. **[page]**
- A removed rule's number is reused: later rules shift down one. Because `change` and `remove` quote the rule's current text, a number that now names a different rule is refused rather than applied. `tl:78-85`. **[page, one sentence]** **[checked]**

## 7. Install it, and the one example

- Package `@flow-state-dev/workforce`. Install: `pnpm add @flow-state-dev/workforce`. The line is in the cut README copy only (`docs/contributing/docs-revamp/readmes/workforce.md:6`); the live README carries no install block. **[reconcile]** at cutover. The same flag is on the other Workforce pages' sheets. **[checked]**
- The kit: `import { workforce } from "@flow-state-dev/workforce/kit"`, used as `createFlowState({ kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })], stores })`. `kit:171-176` (the doc comment's example). Coordinators need `coordinator: { routeModel }` (`kit:82-83` via `wf/coordinator/coordinator-flow.ts:213-219`, covered on the Coordinators sheet; link). **[page]** **[checked]**
- Example for "Turning it on": the app's `fsdev.config.ts` with the kit and a worker file, nothing else. Show the kit line, then say a worker on the built-in `agent` flow has the tools with no further setup. Titles: `fsdev.config.ts` and `workforce/teams/<team>/workers/<name>/WORKER.md` (layout in `docs/contributing/user-docs.md`, "Code examples"). **[page]**
- Example for "a rule being saved": a text block of the conversation (`You: …` then the `✎` line), as today's page does (`sr:15-18`). The line text is from `st/rules-list.ts:233`. **[page]**
- Client example (if kept; the Reference page may take it): `createWorkforceClient(fsd)` from `@flow-state-dev/workforce/browser`, then `workforce.standingRules("eng-lead", { op: "read" })`, answering `{ version, rules: [{ number, text, addedAt, sessionId }], line? }`. `wf/workers/client.ts:187`, `st/rules-action.ts:41-49`, `rd:790-800`. `createClient` is from `@flow-state-dev/client`; the client reads `userId`, `flow`, `sessions`, `resources` (`rd:2848`, README table row). The declaration `const fsd = createClient({ userId, baseUrl })` needs `userId` and `baseUrl` as function parameters. The worker id is the one on the roster; the worker is found or opened with `ensureWorkerSession` and the action runs in the user's session with it (`wf/workers/client.ts:477-481`). **[page or ref]** **[checked]**
- Which workers: those whose flow declares the action. The inventory row's `rules` is `true` when it does (`wf/inventory/open-inventory.ts:271`, `wf/inventory/collections.ts:103-109`, `apps/docs/docs/workforce/inventory.md:162`). A custom flow with no action reads `rules: false` and the client call fails. **[ref]**; one clause on the page.
- Exports a user may touch: `MAX_RULES`, `MAX_RULE_CHARS`, `StandingRule`, `RULE_TOOLS`, `STANDING_RULES_ACTION`, `STANDING_RULES_LINE`, `StandingRulesActionInput`, `StandingRulesActionOutput` from `@flow-state-dev/workforce/browser` (`wf/browser.ts:93-95`); the server entry also exports `STANDING_RULES_RESOURCE`, `standingRulesStateSchema` and the action schemas (`st/index.ts:3-18`, `wf/index.ts:165`). **[ref]**

## 8. What it will not do

- Edit the worker's `WORKER.md` or instructions. A rule is a record, never a write to the file. `st/rules-record.ts:1-13`. **[page]** **[checked]**
- Change on its own: the framework never summarises, merges or rewrites rules; changes come from the worker's tool call after the user asks, or the client. No code path does otherwise (`st/rules-capability.ts`, `st/rules-action.ts`). **[page]** **[checked]**
- Be edited on a task turn, a coordinator's post to a delegate, or a delegate's answer. `tk:116-153`, `tk:232-253`. **[page]** **[checked]**
- Be written from a browser straight to the record. `tk:381-411`. **[page, one clause]** **[checked]**
- Reach another user, another worker, or another flow copy. `tk:367-429`. **[page]** **[checked]**
- Hold more than 20 rules, or a rule over 300 characters or more than one line. `st/rules-list.ts:198-205`, `tl:49-61`. **[page]** (numbers) **[ref]** (the three reasons and their wording)
- Guarantee the model obeys a rule. It is text in the prompt. No test grades a model's compliance except the real-model goals, which count markers in replies over several fresh sessions (`g1:9-16`); the page may say a rule is a note the model reads and follows, not a setting. **[checked]**

## 9. Limits and refusals (Reference rows; one sentence on the page)

All of these are **[ref]**, with the page naming only the 20 and the 300.

| Refusal | Reason text (exact) | Source |
| --- | --- | --- |
| Stale version | `the rules changed since they were read (version <n>, now <m>); here they are as they stand` | `st/rules-list.ts:218`, `tk:432-445` |
| Empty text | `a rule can't be empty` | `st/rules-list.ts:199`, `tl:57` |
| More than one line | `a rule is one line, and this text has more than one` | `st/rules-list.ts:200` |
| Over 300 characters | `a rule is at most 300 characters, and this one is <n>` | `st/rules-list.ts:202` |
| Full list | `the list is full (<n> of 20); merge or drop a rule before adding one` | `st/rules-list.ts:228` |
| No such rule | `there is no rule <n>; the list has <len>` | `st/rules-list.ts:239`, `tl:83-84` |
| Quote does not match | `rule <n> reads "<held>", not "<given>"` | `st/rules-list.ts:242`, `tl:78-82` |
| Unmarked turn | `Standing rules change only on a turn a user started; this one can't edit them.` | `st/rules-capability.ts:127` |

- The client rejects with `Refused: <reason>.` `st/rules-action.ts:68`. **[ref]**
- Two writes that read the same list: one lands, the other is refused as stale; a tool write that read the list before a page edit landed is refused with the list as it stands, and its retry lands after the page's rule, with its line. `tk:446-457` (the racing-add test), `tk:459-497`. **[ref]** **[checked]**
- The text is trimmed before checks; a quoted `current` is trimmed too. `st/rules-list.ts:223`, `:241`, `:254`. **[ref]**
- A record whose stored state fails the schema reads as an error, not as rules: `The standing rules record is malformed: <zod message>`. `st/rules-record.ts:92-96`. **[ref]**
- 20 rules of 300 characters is about 1,500 tokens on every turn. The test comment gives this cost (`tl:106-112`); it is a test comment, not a stated guarantee. The page may say "a full list adds on the order of a few thousand characters to every turn" (`MAX_RULES * (MAX_RULE_CHARS + 6) + 120` bound, `tl:112`) and must not quote a token count. **[checked]**

## 10. Figure facts (*A rule, kept*)

Figure brief from the plan: said once in a conversation, stored for that user, present in every later turn. Marks: arrow, hatching on the rule.

- A rule is said in conversation 1 (a session), stored in the user's record (hatching: outlives the request, `docs/contributing/user-docs.md` "Figures" table), and read into the prompt of every later turn, including a fresh session. `g1:11-13` (session 1 adds two rules; after a restart three fresh sessions follow them), `tk:309-321`. **[checked]**
- The record belongs to Alice and to one worker. A second user's turn with the same worker does not carry it. `tk:367-379`, `g1:12`. **[checked]**
- Names for the figure: user `alice`, worker `eng-lead` (as in `sr` and the README), rule text `Name the project before giving a status.` **[page]**

## 11. Neighbour pages and claims to keep honest

Search each when the page lands; the same claim sits in more than one place.

- `apps/docs/docs/workforce/built-in-worker.md:58` and `:122`: the tools sit outside `tools:`; rules are per worker per user. Matches. **[checked]**
- `apps/docs/docs/workforce/shift-coordinator.md:275-289`: the Shift Coordinator keeps rules; the tool table lists the four with "Never" in the approval column (read-only wording as given on that page). Matches `RULE_TOOLS`. **[checked]**
- `apps/docs/docs/workforce/inventory.md:162`: `rules` on the inventory row. Matches `wf/inventory/open-inventory.ts:271`. **[checked]**
- `packages/workforce/README.md:785-818` and the cut copy: the standing-rules section, with "A fork starts with none, and a worker moved to another worker flow leaves its rules behind." Matches `tk:415-429`. **[checked]**
- `apps/docs/docs/workforce/error-reporter.md:98`: names a standing rule for the reporter. Matches flag 3. **[checked]**
- Today's page links `./durable-hire.md`, `./inventory.md#what-each-row-holds`, `./built-in-worker.md`, `./coordinators.md`, `./shift-coordinator.md` and `../memory/overview.md`. All exist under `apps/docs/docs/`. The revamp slugs for the new page's links come from the sitemap, not from this sheet. **[checked]**

## 12. Revise round 1 (page now states less)

- The page no longer states: the tool names table, the refusal behavior, which workers carry the tools, when tools are offered, the prompt heading and ordering, the unreadable-rules status line, the 20 and 300 limits and full-list line, the input table, the return shape, write refusals, the `standing-rules` resource, or the old "What it won't do" bullets. All of these are **[ref]** rows (R-25) and the page links the workforce reference. The page still shows the 20 only inside the `(3 of 20)` example lines.
- Still on the page: a rule applies on every turn in any session including filed tasks; a task cannot change rules; edits count from the next turn; fork starts with none; moving to a different worker flow leaves rules behind; `rules: true` on the inventory row means `standingRules` works for that worker.
- The client example is now a function taking `userId` and `baseUrl`, titled `src/lib/rename-rule.ts`; the return-shape block was removed.

## 13. Revise round 2

- Cap of 20 now stated on the page (`MAX_RULES = 20`, `st/rules-list.ts:149`, **[checked]**). A fork is a copy of a worker under a new id and starts with none; editing a worker's `flow` leaves its rules on the old flow (`tk:415-429`, **[checked]**). A stale `version` or a `current` that differs from the stored text refuses the write (`st/rules-list.ts:218`, `:242`).
- Dropped from the page: the prompt-reach and unreadable-rules sentence, and the list of what the reference holds.
