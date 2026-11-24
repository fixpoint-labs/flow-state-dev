# Facts for WORKER.md (R-28, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example that uses it (`examples/`, `labs/`). No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[source]** marks a fact read from code where no test or exported doc comment pins it. **[test]** marks a fact a test pins. **[doc]** marks a fact the existing user docs state and the code agrees with. Nothing here was run.

Paths are from the repo root. Abbreviations:

- `W` = `packages/workforce/src`
- `rwd` = `W/loader/read-workforce-directory.ts`, `seg` = `W/loader/segments.ts`, `wcfg` = `W/worker-config.ts`, `aflow` = `W/agent-worker-flow.ts`, `hire` = `W/hire.ts`, `inst` = `W/workers/installation.ts`, `man` = `W/manifest.ts`
- `cc` = `W/coordinator/coordinator-config.ts`, `ck` = `W/coordinator/coordinator-keys.ts`, `dk` = `W/delegates/delegate-keys.ts`
- `wod` = `apps/docs/docs/workforce/workers-on-disk.md`, `biw` = `apps/docs/docs/workforce/built-in-worker.md`, `coord` = `apps/docs/docs/workforce/coordinators.md`, `del` = `apps/docs/docs/workforce/delegating-work.md`
- `rwdt` = `packages/workforce/test/read-workforce-directory.test.ts`

## What the page is

A Reference page: tables and lookups, no narrative, no word budget. The plan names three tables (every setting with its type and default; how the id is formed; what makes a file unusable) and two lookups ("Which setting is required?", "What id does `teams/support/workers/triage` get?"). It carries the rows other pages moved here (section 9 says what was kept and what was dropped).

## 0. The four stored-part questions

A `WORKER.md` is a file the app's author writes. It becomes three things, and each has a different owner.

| Part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| The `WORKER.md` file (a standard worker's definition) | The app's author. Nobody edits it while the app runs: it is read at start (`W/kit/workforce-kit.ts:185` `directory: { path: "workforce", read: ... }`; `wod:272`). | Everyone who works on the repo. A running app shows a user only the projection below. | In the app's `workforce/` folder, in the repo. | One per worker folder. An id may not appear twice (`hire:649`, `inst:404`). |
| A standard worker as the app serves it (`workforce/standard-workers/<id>`) | The app. Read-only: a user cannot write it (`W/workers/hire-blocks.ts:11-14`). | Every user. Clients read `flow`, `description`, `name`, `teamName` and the settings its flow shows (`showSettings`); instructions are not in the projection (`W/workers/standard-workers.ts:26-30,44-57,99`; `W/workers/keys.ts:25`). | Not stored: it is projected from the loaded files on each read (`W/workers/standard-workers.ts:79-101`). User scope in the declaration (`:84`). | One per file. The same set for every user. |
| A user's own worker (`workforce/workers/<id>`) | The user. Hire, fork, edit, fire and reset write it (`W/workers/worker-row.ts:1-15`). | Its owner only. Read at the user's scope: another user's id is "No worker" (`inst:704-712`; `worker-row.ts:70-74`). A browser sees `flow`, `name`, `description`, `forkedFrom` and the settings its flow shows; the rest (instructions, other settings) stays on the server (`worker-row.ts:70-75,93-99`). | In the app's store, at user scope: one roster per user per organization (`worker-row.ts:12-14`). `W/workers/keys.ts:15`. | One row per id per user, any number of rows per user. A second hire under a taken id is refused: `"<id>" is already on your roster. Pick another id. Nothing was written.` (`W/workers/hire-blocks.ts:158`). |

- Editing a standard worker writes the user's own copy under the same id; reset deletes the copy. The standard file is never written (`W/workers/hire-blocks.ts:11-14,272`). The copy is read before the file (`hire-blocks.ts:13-14`). **[source]** `[doc]` `wod:754` area.
- A stored row's `settings` hold "the keys a `WORKER.md` frontmatter accepts other than `flow` and `description`" (`worker-row.ts:52-58`); `name`, `instructions`, `teamInstructions`, `skills` and `forkedFrom` are separate fields of the row (`worker-row.ts:29-61`). A fork copies the team's instructions and does not follow later edits to the files (`worker-row.ts:43-49`).
- A user's worker can name a standard worker's id? No: "the caller's own row first, since a hire can't take a standard worker's id" (`inst:591-594`), and hire, fork and fire refuse a standard worker's id (`hire-blocks.ts:11-12`). **[source]**

## 1. Where a file sits and how the id is formed

- A worker is a folder holding `WORKER.md`, at `teams/<team>/workers/<name>/` or `org/workers/<name>/`, under the workforce root, default folder `workforce/` beside the app (`rwd:1-11`; `W/kit/workforce-kit.ts:185`). **[test]** `rwdt:83`.
- Team worker id: `<team>.<name>`. `teams/engineering/workers/lead/` is `engineering.lead` (`rwd:372-376`, doc comment `rwd:357-371`; `man:20-23`). **[test]** `rwdt:83,89`. `[doc]` `wod:148`.
- Org worker id: the folder name alone, no dot. `org/workers/shift-coordinator/` is `shift-coordinator` (`rwd:375`). A team worker's id always has a dot, so the two cannot collide: `shift-coordinator` and `engineering.shift-coordinator` are two workers (`rwd:364-367`). `[doc]` `wod:150`.
- Worked lookup the sitemap asks for: `teams/support/workers/triage` gives `support.triage` (same rule, `rwd:375`).
- The joiner is a dot because a `/` in an id fails to route: "a slashed one 404s on every flow route" (`rwd:361-363`). Not for the page (mechanism). The observable fact is that a team and a worker name may not contain a dot, so an id always splits back cleanly: **[test]** `rwdt:441`.
- The id is the record's only identity field; a `WORKER.md` may not declare `workerId` (`man:18-26`, section 4). The id is the worker's address everywhere: a session's `workerId`, another worker's `delegates:` entry (`wod:152`).
- A worker's id is given to its flow as the `workerId` setting on every hire, so a block reads it as `ctx.flow.config.workerId` (`wcfg:181-192`; `hire:798`). **[source]**
- A session of a worker flow names its worker once, at creation, as `state: { workerId }`. A create without it is refused: `A session of flow "<kind>" runs one worker: name it as "workerId" when the session is created.` (`inst:639-645`). The worker must be the creating user's own or a standard one, and must run on this flow, else `Worker "<id>" runs on flow "<a>", not "<b>". Create its session on "<a>".` (`inst:712-722`); an unknown id gives `No worker "<id>".` with status 404 (`inst:713`). **[source]** `[doc]` `wod:152`.
- A user's own worker (hired at run time, not from a file) gets an id the user picks: one path segment, at least one character, not starting with `/` or `~`, and no `/` anywhere (`W/workers/hire-blocks.ts:25`: `/^[^/~][^/]*$/`). The folder naming rules in section 2 do not apply to it. **[source]**
- A runtime hire's `id` field on the manifest is the org-qualified address, and the declared id is `manifest.workerId` (`man:22-26`). Page may say the org prefix exists and leave it. Carry only if the page has a row for it; it is mechanism for a reader who never touches manifests. **[source]**

## 2. Names in the tree

Governs team folders, worker folders, documents, skills and the files that declare worker flows, blocks and packages (`seg:1-43`; `wod:154-160`).

- Lowercase letters and digits in runs joined by single hyphens: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, so no leading or trailing hyphen, no double hyphen, no `.`, `_` or uppercase (`packages/core/src/helpers/segment-name.ts:21`). **[test]** `rwdt:417,441`.
- At most 64 characters (`segment-name.ts:24`; `seg:58-60`). **[test]** `rwdt:468`.
- Reserved: `_meta` (`segment-name.ts:27`; `seg:61-63`). **[test]** `rwdt:458`.
- Windows device names, with or without an extension: `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9` (`seg:80-88`; list is in `packages/core/src/helpers/windows-reserved-name.ts`; the page already lists them, `wod:160`). The check runs in this order: length, reserved, pattern, device name (`segment-name.ts:46-54`).
- Refusal wording for a worker: `Worker folder name "<x>" must be lowercase letters, digits, and single hyphens (not at the start or end) — it becomes part of the worker's identity, which is joined with a "."` (`seg:64-78`). A team folder says `Team folder name "<x>"...` (`seg:53`). Refusal is reported in `errors`, keyed by path (`rwd:216` then `:184-187`). **[source]**

## 3. What makes a file unusable

All of these land in `errors` of `readWorkforceDirectory` / `readWorkforce` as `{ path, error, kind }`, and the other workers still load (`rwd:79-103,118-146`). `path` is slash-separated, starts at `org/` or `teams/`, never includes the root, and names the folder (`wod:217`). **[doc]** `[source]`.

`kind` is one of three (`rwd:68-74`):

| `kind` | Means | Cite |
| --- | --- | --- |
| `unreadable-slot` | A structural folder (`org`, `org/workers`, `teams`, `teams/<team>`, `teams/<team>/workers`) is a symlink or cannot be listed. Every worker beneath it is missing. Also a worker folder that is a symlink or cannot be read. | `rwd:69-70,126-139,168-171` |
| `worker-load-failed` | One worker folder did not load: an unusable name, a symlinked or unreadable folder, a missing, unreadable, symlinked or malformed `WORKER.md`. | `rwd:71-72,172-188` |
| `refused-declaration` | The file declares a key the framework sets itself. The worker is left out. | `rwd:73,190-199` |

**Refusal list**, each with the message it gives (`rwd` unless stated):

1. A worker folder with no `WORKER.md`, including one that holds only other files: `Worker folder "<name>" has no WORKER.md. A worker folder describes a worker, and every worker is a WORKER.md. A worker whose behavior differs is a different worker flow: define the flow in your app, pass it to hireWorkforce in \`workerFlows\`, and name it in this worker's \`flow:\`.` (`rwd:237-244`). Same sentence for every such folder, whatever else it holds. **[test]** `rwdt:207,219,621`.
2. A `WORKER.md` with no frontmatter (empty between the fences; its own row on the page, apart from item 3): `WORKER.md in "<name>/" has no frontmatter — a worker file needs at least a \`description\`` (`rwd:268-272`). **[test]** `rwdt:243`.
3. A `description` that is missing, not a string, or empty or whitespace: `WORKER.md in "<name>/" must declare a non-empty \`description\`` (`rwd:274-280`). **[test]** `rwdt:257,273`.
4. A `name` that is present and not a non-empty string: `WORKER.md in "<name>/" declares a \`name\` that is not a non-empty string` (`rwd:281-286`). **[test]** `rwdt:286`.
5. A symlinked `WORKER.md`: refused, not read (`rwd:220-222`). **[test]** `rwdt:583`. A `WORKER.md` that exists and cannot be read: reported, not read as empty (`rwd:224-228`). **[source]**
6. A symlinked worker folder, team folder, `workers/` folder, `teams/` or `org/`: refused, never followed (`rwd:13-14,131-139`). **[test]** `rwdt:479,493,508,520`.
7. A folder name that breaks section 2: reported under the folder's path (`rwd:214-216`). **[test]** `rwdt:417,430,441,458,468`.
8. One of the six keys the framework sets: `persona`, `workerSkills`, `teamInstructions`, `workerTools`, `workerPackages`, `workerId`. Checked in that order, so a file using two names the first (`rwd:315-355`; `rwd:301-303`). Messages (`man`): `persona` `REFUSED_PERSONA_KEY_MESSAGE`; `workerSkills`; `teamInstructions` says `declares \`teamInstructions:\`, which is not a setting any file declares. A team's instructions are the body of its TEAM.md, and reading them is the loader's job.` (`man:261-262`); `workerTools` says `A worker names its tools in \`tools:\`...` (`man:431-435`); `workerPackages` says `A worker holds the packages in its own \`packages/\` folder and the ones its \`packages:\` line names...` (`man:469-472`). **[test]** `rwdt:299,325,354,380,401`. Reasons the page may state flatly (not as design history): `workerSkills` and `workerTools` and `workerPackages` are what the loader resolves from where the folders sit, `teamInstructions` comes from the team's `TEAM.md`, `workerId` is the folder id. `[doc]` `wod:76`.
9. A `WORKER.md` that declares `instructions:` in its frontmatter and also has a body: refused at hire, `declares "instructions" in its frontmatter and carries a body — two sources for one setting, and there is no precedence rule. Remove one...` (`hire:720-727`). A whitespace-only body counts as no body, so `instructions:` in frontmatter with an empty body is accepted (`hire:716-730`). **[source]**
10. A root that is itself a symlink or cannot be read: `readWorkforceDirectory` throws, the one case that does not land in `errors` (`rwd:110-113`; `wod:228`). A root with no `org/workers/` and no `teams/` is `{ workers: [], errors: [] }` (`rwd:114-116`; `rwdt:157`). **[test]**
11. Stopping the app: the workforce kit reads the folder at start and stops the app with every problem named when anything failed to load, a worker, a team file, a skill, a package, a document or a reference: `the workforce folder did not load:\n  - <layer> <path>: <message>` (`W/kit/workforce-kit.ts:185`; `W/loader/read-workforce-folder.ts:84-91`). `layer` is one of `worker`, `skill`, `team`, `document`, `reference`, `package` (`W/loader/read-declared-roster.ts:44-60,149-163`). **[source]** `[doc]` `wod:257`. A file the loader does not read at all (a stray file in the tree, a `README.md` included; only `.DS_Store` and `Thumbs.db` are ignored, `engine/src/folder/walk.ts:21`) also stops the app, named (every file not matching the claim list `read-workforce-folder.ts:48-59` is refused by the engine's claim pass): "a file workforce doesn't read stops the app starting" (`W/loader/read-workforce-folder.ts:6-11`; claim list `:48-59`). This is the answer to "what happens at startup".
12. The `./loader` entry exports only `readWorkforceFolder` and the `WorkforceFolder` type (`W/loader/index.ts:17-20`); its header calls the readers internal. The kit calls `readWorkforceFolder`, which reads through `readDeclaredRoster` and throws `the workforce folder did not load:` plus one line per problem (`W/loader/read-workforce-folder.ts:85-91`). `readWorkforce` and `readWorkforceDirectory` are not importable from `./loader`; `readWorkforce` returns `errors`, `teamErrors`, `skillErrors`, `packageErrors` (`W/loader/read-workforce.ts:114-123`) and the page does not state it.
13. `readWorkforceDirectory` passes over in silence, not an error (the kit's claim pass still refuses any such file except `.DS_Store` and `Thumbs.db`, item 11; a `tools/` folder is not on the claim list, `blocks/` is): anything outside a worker slot (`resources/`, `skills/` and `tools/` beside `workers/`, a `README.md` in `workers/`, `.DS_Store`) (`rwd:15-20`; `wod:261`; **[test]** `rwdt:600`). A plain file directly under `workers/` occupies no slot (`rwd:153-156`).

**Refused at hire, not at read.** These make the file unusable once the app builds its workers; the message is prefixed `worker "<id>" — ` and the whole roster's problems are listed together, `hireWorkforce refused N of M worker(s)...` (`hire:650,282`, `hire:1030`). Nothing is hired partially (`hire:577`, doc comment on `mintWorkers`, "Every problem throws, but they are collected first").

- `flow:` names a flow not passed to `hireWorkforce`: `names flow "<f>", which is not in the worker flows passed to hireWorkforce. Worker flows passed: <list>` (`hire:257-259,772`).
- `flow:` present but empty or whitespace: `declares an empty \`flow:\`, which names no worker flow. Remove the key to hire on the built-in \`agent\` worker flow, or name a worker flow you passed` (`hire:747`). `flow:` with no value or `~` (null), or any non-string: `declares \`flow:\` as <value>, which names no worker flow...` (`hire:752-759`; `W/declared-flow.ts:33-50`). Only a file with no `flow` key gets the default (`declared-flow.ts:46`). **[source]**
- Two workers with one id in one roster: `declared twice in this roster; a worker's id is its address and must be unique` (`hire:649`); for standard workers `createWorkerInstallation: standard worker "<id>" is declared twice.` (`inst:404`).
- A standard worker whose `flow:` is blank or not a string: `createWorkerInstallation: standard worker "<id>" declares a \`flow:\` that names no flow.` (`inst:406-411`; `W/workers/standard-workers.ts:38-41`).
- A standard worker whose `delegates:` names a non-standard worker: refused (`inst:413-425`). See delegates row.
- A flow that rejects a setting the file wrote (a key the flow does not declare, a wrong type): the flow's own refusal, prefixed with the worker's id (`hire:1015-1024`; `wod:88`, `wod:88`). Every key a file writes other than the ones in section 4 must be declared by the flow it names, or the hire is refused (`aflow:640-650` closed schema; `wcfg:32-37`). **[doc]** `wod:88` ("at hiring it refuses a setting it never declared").

## 4. Settings

Keys the **file loader** reads: `description` (required), `name` (optional, must be a non-empty string when present). Everything else is carried unread, spelled as written, on `declared` (`rwd:11-12,252-262,288`; `wod:88`; `man:28-29` `declared`). **[test]** `rwdt:113,134`.

Keys the **hire** reads itself and does not hand the flow as settings (`hire:90-97`, doc `:78-89`): `flow`, `description`, `name`, `resources`, `references`, `packages`. A flow that declares one of the same name does not receive an authored one (`hire:86-88`).

Keys of the **worker contract**, accepted by every worker flow (`wcfg:104-229`): `instructions`, `delegates`, `defaults`, plus the five the framework sets (not authored, section 3 row 8).

Keys of the **built-in `agent` flow** (the flow a file with no `flow:` runs on): `model`, `tools`, `skills`, `capabilities`, `discover` (`aflow:468,485,535,608,640`). Keys of the **`coordinator` flow**: the agent's, plus `routing`, `fallback`, `editsOwnDelegates`, `minConfidence`, `rounds`, `inferredWork` (`cc:62-85`). Keys of the **`coder` flow** (the harness kit): `harness`, `review` (`W/../harness-manager/src/kit/coder-flow.ts:275-279`, full path `packages/harness-manager/src/kit/coder-flow.ts`). An app's own flow may declare more (`defineAgentWorkerFlow({ settings })`, `aflow:279-291`); those are the app's, not this page's.

### Settings table

| Setting | Type | Default | Read by | What it does | Cite |
| --- | --- | --- | --- | --- | --- |
| `description` | non-empty string | **required** | loader, hire | One line saying what the worker is for. A coordinator routing by `best-fit` describes each delegate to its evaluator by it, unless the delegate has a note. Never handed to the flow as a setting. | `rwd:274-280`; `W/worker-description.ts:1-13`; `wod:76`. **[test]** `rwdt:257` |
| `name` | non-empty string | none; the UI shows the id | loader, hire | Display name for people. Apps show it in place of the id; the id stays the address. Not handed to the flow. | `rwd:281-286`; `hire:78-80`; `W/workers/standard-workers.ts:47-51`; `wod:76`. **[test]** `rwdt:286` |
| `flow` | non-empty string | `agent` (the built-in flow) | hire | Which worker flow the worker runs on. Absent key means `agent`; blank or non-string is refused. An app that registers its own flow under `agent` replaces the built-in for every worker on `agent`. The coordinator flow is named `coordinator`; the coding flow `coder`. | `hire:739-772`; `aflow:122`; `W/declared-flow.ts:46-50`; `ck:288`; `packages/harness-manager/src/coder-flow-name.ts:5`. `[doc]` `wod:76`, `coord:15` |
| `model` | string | the flow's `model` option, else `intent/chat` | the `agent` flow | The model the worker's turn runs on. `intent/chat` is a provider-neutral placeholder the app's resolver maps to a model. | `aflow:134,468` |
| `tools` | list of strings | **absent** (no key) | the `agent` flow | Absent: the worker gets the tools of the capability presets it picked, and the blocks of packages it holds. A written list is the whole grant, a hard fence; `[]` is no tools. Each name is looked up in the worker's own `blocks/` folder, then its team's, then the app's catalog (`agent.catalog` on the kit, or `defineAgentWorkerFlow({ catalog })`); the first match wins. A name nothing registers is refused at hire, naming both places. A package block and a catalog key of the same name is refused. | `aflow:27-60,485-514`; `hire:543-575,833-864`; `biw:45-62`; `W/kit/workforce-kit.ts:52-53` |
| `skills` | object: `active` (list of strings, default `[]`), `activateTool` (boolean, default unset), `enableLlmClassifier` (boolean, default `false`) | `{ active: [], enableLlmClassifier: false }` | the `agent` flow | `active`: skills always in context, by name; a name the worker does not hold is refused, on its first turn (not at hire), listing what it holds. `activateTool`: let the model load a held skill mid-turn; unset, it follows `defaults.skillsIndex` (on for a worker that holds a skill); a value the file sets always wins. `activateTool` installs the `loadSkill` tool; `true` installs it even with `defaults: false` or `skillsIndex: false`, and the skills list stays off. `enableLlmClassifier`: model call per turn matching the message to skills; slash matching always runs; no keyword tier on either branch. The classifier's model and threshold are `defineAgentWorkerFlow` options (`classifierModel`, `confidenceThreshold`), one per flow; as top-level worker keys they refuse the hire (`is not a declared setting`), under `skills:` they are stripped and ignored: the `skills` object is not strict, and only the flow options reach the classifier **[source]**. | `aflow:301-303,535-584,671-691,1259-1272,1298`; `W/worker-default-layer.ts:86-99,310`; `packages/orchestration/src/skills/load-tool.ts:109` |
| `capabilities` | map from capability name to list of preset names | `{}` | the `agent` flow | Presets this worker adds on top of what the flow's installed capabilities already carry. A worker that names none receives every installed capability's own default presets, and no preset's tools. A name the flow does not carry, a preset the capability does not declare, a preset the app turned off, a preset on a capability that takes config, and a preset that must exist before a request runs are each refused at hire. Two picked presets with different tools under one name are refused when the worker writes no `tools:` line. | `aflow:595-619`; `W/worker-capabilities.ts:285-352`; `biw:49` |
| `discover` | list of `workers`, `skills`, `resources` | absent (all domains the scope carries) | the `agent` flow | Narrows which discovery domains the worker sees. Absent: every domain its scope carries. `[]`: none. Cannot widen: a domain the app did not install shows nothing. A misspelt domain is refused at hire. The domains are three: `workers`, `skills`, `resources`. | `aflow:619-640`; `W/worker-discovery.ts:1-63`; `packages/contracts/src/types/manifest.ts:33`. Note: the doc comment at `aflow:620-625` says "the four"; the array has three. Code wins. |
| `defaults` | `false`, or object with `date`, `skillsIndex`, `historySummary` booleans | absent (every section on) | the `agent` and `coordinator` flows | Turns off parts of the standard text added after the worker's instructions (date, skills index, history summary). `false` turns all off; an object turns off each section it sets `false`. An unknown section is refused. | `W/worker-default-layer.ts:56-78`; `wcfg:194-228` |
| `delegates` | list of worker ids (at most 25), or `all` | `[]` | any worker flow; routed by `coordinator` | The workers this worker hands work to. Each session starts from the file's list and then keeps its own copy (changes in one session do not write back). A list nothing uses is accepted. A flow that routes posts (the coordinator) posts to the ones that take a post; any worker whose flow carries the task tools files tasks for the ones that take a task, and no one else. `all` is the whole roster, the worker itself included, read on every call, so a worker hired mid-conversation is reachable at once; the 25 cap bounds a written list, not `all`. A coordinator's routing never picks itself, whatever its list says. A delegate has to be on the same user's roster. A standard worker may name only standard workers (`createWorkerInstallation` refuses otherwise), except that a standard worker's `all` reaches the user's own workers too. Only the user's file sets `all`; no tool does. A delegate named twice is refused for a coordinator. | `wcfg:194-216`; `dk:20-28`; `ck`; `inst:413-425,626-628`; `cc:107-113`; `coord:161`; `del:29,33` |
| `resources` | list of document refs, each bare (read-only), `<ref>: ro`, or `<ref>: rw` | absent (reaches every document the app passed as `documents`, and writes the ones that allow writes) | hire | Narrows the documents the worker may touch. `resources: []` is none. Only documents are narrowed: the flow's own stores and boards stay reachable. Refused: not a list; an entry that is not a ref or a one-key `ref: mode` map; a mode that is not `ro` or `rw`; a ref twice (even with different modes); a ref the app did not declare; a ref the flow was not installed with (a grant cannot widen); a ref a block of the flow also declares; `rw` on a document with `writable: false`; and any `resources:` when the installation was given no `documents`. | `W/worker-resources.ts:39-80,80-175,215-300`; `hire:893-935`; `wod:78-80` |
| `references` | list of refs, no mode | absent (all references the worker's place reaches) | hire | Narrows the references (read-only documents) the worker's place in the tree already gives it: the org's, its team's, its own folder's. Naming one from outside refuses the hire. `references: []` is none. Refused: not a list; an entry that is not a ref; a ref twice; an unreachable ref (one message for "does not exist" and "exists elsewhere"). | `W/worker-references.ts:51,255-300`; `wod:82` |
| `packages` | list of package names | none | hire | Takes packages from the worker's team library, else the org's. Packages in the worker's own `packages/` folder need no line. Refused: not a list; a name no library in reach offers; a name both the worker's own folder and a library offer. | `man:443`; `W/worker-packages.ts:39-140`; `wod:84` |
| `instructions` | string | the file body | any worker flow | The worker's own instructions. Written below the frontmatter. Setting the key and writing a body is refused. A whitespace-only body is not instructions. | `hire:716-730`; `wcfg:106-114` |
| `harness` | one of the harness ids the kit was given (for example `codex`) | the kit's `defaultHarness`; none means the worker's task is refused | `coder` flow | Which coding harness a coding worker's runs use. A harness this machine is not set up for fails the task at once, saying why; it never moves to another. Shown on the worker's roster row (`showSettings: ["harness"]`). | `packages/harness-manager/src/kit/coder-flow.ts:4-12,87-90,246-250,275-277,326`; `packages/harness-manager/test/harnesses-kit.spec.ts:41` (`flow: coder\nharness: codex`) |
| `review` | boolean | the kit's `review` option, default `false` | `coder` flow | `true`: a run that committed waits for the user's review before its task completes. | `coder-flow.ts:15-17,89,251,278` |

Coordinator-only rows (flow `coordinator`; settings of its own, `cc:62-85`):

| Setting | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `routing` | `judgment`, `best-fit`, `round-robin`, `everyone` | `judgment` | How a message finds its delegates. | `cc:41,69`; `coord:46,154-159` |
| `fallback` | string (a delegate id) | none | The delegate a message `best-fit` cannot place goes to. Must be one of `delegates`; refused otherwise. | `cc:70,114-116`; `coord:47` |
| `minConfidence` | number, 0 to 1 | none (any pick is used) | Under `best-fit` only, the lowest confidence at which a pick is used. Refused when set on any other routing, and when outside 0 to 1. | `cc:38,72-76,117-119`; `coord:48` |
| `rounds` | integer, 0 to 3 | `0` | How many times a delegate's answer goes back out to the others. `rounds can be at most 3` above 3. `best-fit` and `round-robin` route each answer as it lands, never to its author; `everyone` and `judgment` close the round first, then send out. Costs at most delegates x (rounds + 1) delegate turns per message. A round closes when everyone has answered, failed or been cancelled, or at its deadline (five minutes unless the flow sets `roundDeadlineMs`). A conversation keeps at most 50 rounds open. | `cc:77-82`; `ck:330-333`; `coord:49,308-320`; `W/coordinator/coordinator-flow.ts:235,395` |
| `editsOwnDelegates` | boolean | `false` | `true` gives the coordinator's own turn `addDelegate`, `removeDelegate` and `setFallback`. | `cc:71`; `coord:50` |
| `inferredWork` | `off`, `observe`, `auto` | `observe` | What the coordinator may do with an event nobody asked it about: `off` lands it as a line and runs no model; `observe` runs its turn and every task it files waits on the user's yes in the Inbox; `auto` runs the turn as any other. | `cc:83`; `ck:290-293`; `cc:24-29` |

A coordinator file the hire cannot run is refused, naming the problem: `rounds` above 3, an unknown `routing`, a `fallback` not in `delegates`, a `minConfidence` outside 0 to 1 or off `best-fit`, a delegate named twice (`coord:91`; `cc:103-121`). **[doc]** + **[source]**

## 5. What is not a setting, and how the body works

- The body below the frontmatter is the worker's instructions, verbatim, handed to the flow as `instructions`. Empty or whitespace: absent, never `""` (`man:30-34` `body`; `hire:716-730`). **[test]** `rwdt:67`.
- The frontmatter is the same dialect as `SKILL.md` (`rwd:253-257`; `wod:90`).
- A key nobody has claimed is carried unchanged on `declared`, spelled as written (`rwd:6-10`; `rwdt:113`). The flow named has the final say, so a key the flow does not declare is refused at hire (section 3).
- A team's instructions (`TEAM.md` body) reach each worker on the team as `teamInstructions`, set by the framework; a file may not declare it (section 3 row 8; `man:261`).

## 6. When an edit takes effect

- A `WORKER.md` is read when the app starts. "Nobody can edit it while the app runs" (`wod:272`). **[doc]**
- Only `fsdev dev --watch` (only when the server listens on localhost; `packages/fsdev/src/commands/dev.ts:133,179-181`) restarts on a save; plain `fsdev dev` does not. With `--watch`, a save to a file under the config's directory, including a `WORKER.md`, restarts the app; a new folder with a `WORKER.md` does too (`packages/fsdev/test/dev-watch.test.ts:188-192,233-241`). **[test]** The page may say so in one row, because the question "when do edits take effect" has this answer. The test's tree is a stand-in named `tree/a/WORKER.md` that the config imports; it pins "restarts on a save to a file under the config's directory", not "restarts on a save to a workforce `WORKER.md`" specifically. State the general rule and not more.
- A user's own worker is stored, so a hire, edit or fire is a write and the next turn on any process reads it (`worker-row.ts:6-10`; `hire-blocks.ts:1-4`). A standard worker's edit by a user makes a copy under the same id (section 0).
- A stored worker whose flow has since become standard-only is not dropped; its next turn is refused with the reason (`wod:754`; `inst:870-876`). **[doc]** + **[source]**

## 7. Other things the loader returns that sit beside the file

`readWorkforce` returns per worker: `id`, `declared`, `body`, `skills?`, `packages?`, `teamInstructions?`, `teamName?` (`man:18-85`). The page is about the file, so it points at the loader's own page for the record. `skills` is the org, team and own-folder union: three levels for a team worker, two for an org worker (`man:36-47`; `wod:188`). **[doc]**

## 8. Facts the page must not state

- Why the id uses a dot and not a slash, why six keys are refused, why `description` is not handed to the flow: design reasoning, cut. The observable parts are in sections 1 and 3.
- `readWorkforceDirectory`'s `workerOrder` and the walk's internals: not observable.
- The generated `workforce.gen.ts` and `fsdev gen`: the page may name `fsdev gen` as the thing that registers a worker's `blocks/` folder, since `tools:` depends on it (`aflow:508-511` message: "Put the block in this worker's own `blocks/` folder and re-run `fsdev gen`"), and say nothing else.

## 9. Rows other pages moved here

All 19 rows from the page-level grep, each checked against the code. Carried unless named below.

| Row (abridged) | Verdict | Where |
| --- | --- | --- |
| settings `flow` (default the agent flow) and `delegates` | Carried | section 4 |
| `harness` and `flow` settings, and the Codex credential variable | `harness` and `flow` carried. **Dropped: the Codex credential variable.** `CODEX_API_KEY` is read by the Codex package's account check (`packages/codex/src/account-probe.ts:65`) and named in its remedy `Run \`codex login\`, or set CODEX_API_KEY` (`:118`). It is an environment variable, not a `WORKER.md` setting, and R-15 already lists it (`docs/contributing/docs-revamp/pages/reference/environment.md:139`). | section 4 |
| Worker id formation, team folder plus worker folder, dot | Carried | section 1 |
| `flow:` default and "coordinator delegation to the whole roster" | Carried. The delegation half is `delegates: all` (`dk:25`; `inst:626-628`). | section 4 |
| `tools:` explicit list is the complete set, where names resolve, refusal naming the key | Carried. Resolution order is own `blocks/`, team `blocks/`, then the catalog (`hire:543-575`; `biw:45`). `agent.catalog` is the kit's option (`W/kit/workforce-kit.ts:52`; `aflow:273`). | section 4 |
| `discover:` narrows; empty list shows nothing | Carried. Note the correction: three domains, not four. | section 4 |
| Required key and default flow on the settings table; stop-at-startup refusal for a `workers/` folder with no `WORKER.md` on the path-rules table | Carried | sections 3, 4 |
| id formation, org worker `org/workers/<name>` is `<name>` | Carried | section 1 |
| `capabilities:` map of capability to presets; what a worker naming none receives | Carried. A worker naming none receives each installed capability's own defaults and none of a preset's tools (`aflow:595-600`; `biw:49`). | section 4 |
| `delegates`: list of ids or `all`, itself included, read on every call; delegates on the same user's roster | Carried | section 4 |
| `delegates` max 25 or `all`; a coordinator never routes to itself; `flow: coordinator`. "Keep only the plain sentence that `delegates` lists who it can hand to" | Carried. "A coordinator never routes to itself" holds: `coordinator-flow.ts:796` and `coord:161`. The last sentence is a note to the page's author about another page, not a fact. | section 4 |
| `rounds`: 0 to 3, default 0; timing per mode; cost is more delegate turns | Carried. Timing per mode: `best-fit` and `round-robin` route as each answer lands; `everyone` and `judgment` close the round first (`coord:308-312`). | section 4 |
| `description` required, `name` shown, body as instructions, `tools` list; when edits take effect | Carried. Edit timing is section 6. | sections 4, 6 |
| `description` is the only required setting; id is `<team>.<worker>`; no `flow:` runs on `agent` | Carried | sections 1, 4 |
| settings table: which is required, what `name`, `model`, `delegates`, `flow` each do, id formed from path | Carried | sections 1, 4 |
| What makes a worker file unusable, the startup refusal that names the file | Carried. The refusal that stops the app names the layer and path and every problem at once (`read-workforce-folder.ts:84-91`). | section 3 |
| Worker-flow session row: a hired worker's flow requires `workerId` in initial session state | Carried (`inst:639-645`). It is a session rule, not a file setting, so it sits under the id section. | section 1 |
| Address formation: `team.name` or bare name; user-owned id | Carried. User-owned id is the hire's `id` input, `/^[^/~][^/]*$/` (`hire-blocks.ts:25`). | section 1 |
| `delegates`: list or `all`; same-roster constraint | Carried | section 4 |

## 10. Where the code and existing docs disagree, or are unsure

- The doc comment on `discover` in `aflow` says "listing the four"; `MANIFEST_DOMAINS` has three entries (`packages/contracts/src/types/manifest.ts:33`). Page states three.
- `wod:76` and the loader say `description` is "the only key the file itself requires". True of the loader. A flow can require more: the `coder` flow's `harness` has no default unless the kit sets `defaultHarness`, and a task for a worker with no harness is refused (`coder-flow.ts:246-250`). The settings table says so. The page's lookup answer for "Which setting is required?" is `description`, with that one clause.
- Whether a `name` appears for a standard worker of a user whose stored copy has none: not checked and not needed.
- `resources:` mode `ro` is "sugar and carries no separate meaning" (`W/worker-resources.ts:51`). Stated as "spells out the default".

- Round deadline is not a `WORKER.md` setting: it is the coordinator flow option `roundDeadlineMs`, default five minutes (`W/coordinator/coordinator-flow.ts:235,395`; `coord:89,314`). `inferredWork: off` shows the event in the conversation as a line; "an event" is one no other subscription heard (`cc:24-29`). The page title is the bare name, as sibling Reference pages.
