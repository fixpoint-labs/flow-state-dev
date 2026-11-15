# Facts for The workforce folder (K-11, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and the example apps. No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read. The surfaces named here are all built, so no fact is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `dd` = `apps/docs/docs/workforce/documents-on-disk.md`
- `cd` = `apps/docs/docs/workforce/code-on-disk.md`
- `cp` = `apps/docs/docs/workforce/capabilities-on-disk.md`
- `pk` = `apps/docs/docs/workforce/packages-on-disk.md`
- `wd` = `apps/docs/docs/workforce/workers-on-disk.md`
- `bw` = `apps/docs/docs/workforce/built-in-worker.md`
- `dh` = `apps/docs/docs/workforce/durable-hire.md`
- `kit` = `packages/workforce/src/kit/workforce-kit.ts`
- `wff` = `packages/workforce/src/loader/read-workforce-folder.ts`
- `rdr` = `packages/workforce/src/loader/read-declared-roster.ts`
- `rc` = `packages/workforce/src/loader/resource-convention.ts`
- `rw` = `packages/workforce/src/loader/resource-walk.ts`
- `seg` = `packages/workforce/src/loader/segments.ts`
- `disc` = `packages/workforce/src/codegen/discover.ts`
- `dwb` = `packages/workforce/src/codegen/discover-worker-blocks.ts`
- `tsm` = `packages/workforce/src/codegen/typescript-module.ts`
- `fg` = `packages/workforce/src/codegen/fsdev-gen.ts`
- `wp` = `packages/workforce/src/worker-packages.ts`
- `rfd` = `packages/workforce/src/resources-from-docs.ts`
- `rfr` = `packages/workforce/src/references-from-docs.ts`
- `gen` = `packages/fsdev/src/commands/gen.ts`
- `claim` = `packages/engine/src/folder/claim.ts`
- `kits` = `packages/engine/src/flowstate/kits.ts`
- `dk` = `packages/core/src/kit/define-kit.ts`
- `kt` = `packages/workforce/test/workforce-kit.test.ts`
- `ag` = `packages/workforce/test/agent-grants-per-turn.test.ts`
- `ks` = `apps/kitchen-sink` (the one example that uses the folder and the kit: `lib/workforce-kit.ts`, `workforce/`)
- `reg` = `packages/ui/registry.json` and `packages/ui/registry/workforce-starter/`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/workforce-folder`, `reference/worker-md`); the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page. **[run]** observed by running the code in this pass (a throwaway script against `packages/workforce/src`, a tree written to a temp folder); the line cited is the code that produces it.

## Flags against the page plan and the existing pages (read first)

1. **The existing pages describe the readers; the kit is stricter, and the kit is what an app runs.** `wd:259-267` ("What is passed over in silence": a team's `tools/` folder, a `README.md` inside `teams/<team>/workers/`, a `TEAM.md` at `org/` "read by nothing and reported by nothing") and `cd:152` ("Files that are not TypeScript are skipped: a README ...") are true of `readWorkforce` and `fsdev gen` alone. Under `workforce({...})`, a file nothing reads stops the app starting, named: `wff:5-9`, `claim:1-9`, `kits:278-286`. **[run]**: `notes.txt`, `teams/core/notes.md`, `blocks/readme.md`, `org/TEAM.md`, `teams/core/tools/`, `org/workers/boss/blocks/` each refused by path. The page follows the kit and does not repeat the "passed over in silence" rule. [page]
2. **A file in the wrong place and a file wrongly named are caught at different times.** Wrong place (not on the claim list): refused at startup. Right place, but a code file whose basename breaks the name rule (`blocks/x.test.ts`), or a `.md` and a `.ts` of one name in one `resources/` folder: **not** refused at startup, refused by `fsdev gen` (`disc:262-268`, `cd:145-147`). **[run]**: both trees start; both make `generator.generate` refuse (`Block file name "x.test" must be lowercase letters, digits, and single hyphens ...`; `"teams/core/resources/a.ts" and "teams/core/resources/a.md" both declare "teams/core/a"`). Question 3 of the plan ("a file is in the wrong place: what happens at startup?") has the first answer; the page must not imply startup catches the second. [page]
3. **The kit claims `.mts` and `.cts`; `fsdev gen` reads only `.ts` and `.tsx`.** Claim set: `wff:45` (`\.(?:ts|tsx|mts|cts)`); module test: `tsm:13`. A `flows/workers/a.mts` starts the app (`kt:86-88` puts `coder.mts` there and expects it not refused) and registers nothing. **[run]**: `generate` on a tree holding only `flows/workers/a.mts` finds 0 worker flows and refuses nothing. The page says code files are `.ts` / `.tsx`. [page, one clause]
4. **The workforce kit has no user page.** `grep` finds no `workforce/kit` in `apps/docs/docs` or the workforce README. Its surface is `workforce(...)` from `@flow-state-dev/workforce/kit` (`kit:174-184`, `packages/workforce/package.json` exports `./kit`). The folder's wiring facts below come from the kit's JSDoc, the kit test and kitchen-sink. [page]
5. **The page plan's "starter" and the tree it shows.** The only installable tree is the UI registry item `workforce-starter`: `workforce/teams/team/TEAM.md` and `workforce/teams/team/workers/assistant/WORKER.md`, "never overwrites a file already there": `reg` (`registry.json:766-785`). Kitchen-sink's `workforce/` is the richest real tree, one team (`support`), five workers, two of the workers' own `blocks/`, no document, no package, no flow file: `ks/workforce/teams/support/workers/*`. No tree in the repo holds every folder at once. The page's "tree as a listing" is composed from the published path rules (`cd:22-40`, `dd:27-51`, `pk:14-19`, `bw:130-146`), not copied from an app. [page]
6. **Skills and `TEAM.md` are in the tree but the plan's Job line omits them.** Both are read from the same folder and claimed (`wff:52`, `wff:56`). The tree figure and listing should carry them with a link out; neither is explained here. [page, one line each]
7. **`fsdev gen`'s default root and the kit's folder are resolved differently.** The kit's folder defaults to `workforce` against the app's root; a `directory` given in config reads against the working directory: `dk:139-141`, `kits:236-248`, `kit:168-169`. `fsdev gen` defaults to `workforce` relative to where the command runs: `fg:70-73`, `gen:162`. Run from the app's folder, the two are the same folder; `--root <dir>` overrides gen: `gen:195`. [page, one sentence: run it from the app's folder]
8. **The existing pages teach a hand-wired startup** (`readWorkforce`, `createWorkerInstallation`, `hireWorkforce`: `wd:164-169`, `wd:283-297`, `cd:117-123`). With the kit those calls are the kit's: it reads the folder, builds the installation from the workers, documents, references, `workerBlocks` and `packageBlocks`, and hires it: `kit:187-269` (`installWorkforce`). The page shows the kit and links the hand-wired path. [page]
9. **Nothing in the repo's tests holds a folder with every part.** The nearest are the three goal fixtures and `kt`. The page's one capability file and one document are the existing pages' own (`cp:27-39`, `dd:67-76`), which type-check as written in those pages and are the page's two code examples; names to be re-rooted at the page's one app at pass 3. [page]

## 1. What it is (opening)

- One folder, `workforce/`, holds everything a team of workers is made of that is a file: workers, a team's instructions, documents, skills, packages, code. `kit:1-8` ("reads the app's `workforce/` folder (every file used or refused)"), `wff:13-19` (the claim set lists each). [page]
- The workforce kit reads the folder at start-up. `dk:136-143` ("`read` is the kit's reader, and runs on the server at start-up"), `wff:1-12`. [page]
- The folder defaults to `workforce/` beside the app; an app gives another path with `directory` in the kit's config: `kit:168-173` (`workforce/`), `kit:182` (`directory: { path: "workforce", ... }`), `dk:139-141`, `dk:241-246` (`directory` must be a path). `ks/lib/workforce-kit.ts:41` (`workforceRoot = .../workforce`), `ks/lib/workforce-kit.ts:55` (`directory:` given). [page]
- The app lists the kit in `createFlowState({ kits: [...] })`: `kit:4`, `kit:172` (`createFlowState({ kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })], stores })`), `ks/lib/workforce-kit.ts:15-22` (`fsdev.config.ts` lists the kit). The host never builds the installation or hires: `kit:7-9`. [page]
- What the kit serves from a tree: one copy of each worker flow, the built-in `agent` flow, and the `workforce-roster` flow. `kt:75-80` (`["agent", "workforce-roster"]` for a tree of one worker, **[run]** same for an empty folder and a clean tree with a TEAM.md and an org reference). `kit:7-9`, `wd:296-301`. [page, one sentence]
- An empty folder is not an error: **[run]** `workforce({ directory })` over an empty temp folder starts, flows `agent,workforce-roster`. A folder that is absent or a symlink is refused: `claim:54-55` (`openRoot` throws), `kits:274-290` (each folder problem is gathered with the others). [ref]
- A worker is a folder with a `WORKER.md`; adding one is adding a folder and restarting: `wd:827` ("`WORKER.md` is the only filename a worker slot is read for"), `wd:956` ("Read it once, at startup"). [page]

## 2. The tree, part by part (the figure and the listing)

The paths the kit reads, from its claim list (`wff:43-59`), each with what it becomes in the app.

| Path under `workforce/` | What it becomes | Source |
| --- | --- | --- |
| `teams/<team>/workers/<worker>/WORKER.md` | A **standard worker**, id `<team>.<worker>`. | `wff:53`, `wd:148-150`, `wd:271-273` |
| `org/workers/<worker>/WORKER.md` | An **org worker**, id `<worker>`, no team. | `wff:53`, `wd:150`, `wd:41-53` |
| `teams/<team>/TEAM.md` (optional) | What the team is, and the instructions every worker on it is told. | `wff:52`, `wd:94-127` |
| `org/references/<name>.md`, `teams/<team>/references/`, a worker's own `references/` | A **reference**: a read-only document, served from the file. | `wff:55`, `dd:15-17`, `dd:277` |
| `org/resources/<name>.md`, `teams/<team>/resources/`, a worker's own `resources/` | A **document** a worker can write, seeded from the file. | `wff:54`, `dd:17`, `dd:253` |
| `.../resources/<name>.ts` (org or team) | A **capability** (or a plain resource), found by `fsdev gen`. | `wff:54`, `cp:10-12`, `cp:45` |
| `org/skills/`, `teams/<team>/skills/`, a worker's own `skills/`, each `<name>/SKILL.md` | A **skill** the workers at that level hold. | `wff:56`, `bw:130-151` |
| `org/packages/<name>/`, `teams/<team>/packages/<name>/`, a worker's own `packages/<name>/`: `PACKAGE.md` and `blocks/*.ts` | A **package**: instructions and the tools that go with them. | `wff:57`, `pk:10`, `pk:42-44` |
| `flows/workers/<name>.ts` | A **worker flow**, named by a `WORKER.md`'s `flow:`. | `wff:50`, `cd:22-26`, `disc:85-88` |
| `blocks/<name>.ts` | A **block** any worker may name in `tools:`. | `wff:51`, `cd:27-28`, `cd:166` |
| `teams/<team>/blocks/<name>.ts` | A block every worker on that team may name. | `wff:58`, `cd:30-32`, `cd:167` |
| `teams/<team>/workers/<worker>/blocks/<name>.ts` | A block that one worker may name. | `wff:58`, `cd:36-39`, `cd:168` |
| `workforce.gen.ts` | The generated registry of every file above that is code. | `wff:49`, `cd:72-103` |

- Documents (`references/`, `resources/`) sit at the same four places: org, a team, a worker in a team, a worker at org level (`rc:100-111`, `rw:51-54` patterns `org/resources`, `org/workers/*/resources`, `teams/*/resources`, `teams/*/workers/*/resources`). [ref]
- Skills, packages, `references/` and `resources/` all sit at org, team and worker level: `wff:43` (`LEVEL`), `wff:54-57`. [ref]
- `flows/` holds only `flows/workers/`. A helper module beside it is the app's own, in its own folder: `wff:17-19`, `kt:84-87` (`flows/helper.mts` is refused). [page]
- A worker's own `blocks/` and a team's `blocks/` are claimed; there is no `blocks/` at org level other than `workforce/blocks/`, and none for an org worker: `wff:58` (`(?:teams/[^/]+|teams/[^/]+/workers/[^/]+)/blocks`), `cd:171`, `dwb:196-202`. **[run]**: `org/workers/boss/blocks/x.ts` is refused at startup (`"org/workers/boss/blocks" is not used by anything...`) and by gen (`is a blocks/ folder at a level no worker reads. ... Move it to one of those`). [page, one clause; rule is ref]
- A `tools/` folder anywhere is refused: `dwb:56`, `dwb:208-225`, `cd:149`. **[run]**: refused at startup, `"teams/core/tools" is not used by anything...`. The folder for code a model can call is `blocks/`. [page, one clause]
- What the plan calls "the one folder a newcomer touches first" (the highlighter): `workers/`. The registry starter ships exactly one worker folder and a `TEAM.md`: `reg` (`registry.json:767-785`), `packages/ui/registry/workforce-starter/WORKER.md:1-12`. [page, figure]
- The smallest valid tree: `teams/<team>/workers/<worker>/WORKER.md` with a `description`; **[run]** `teams/core/workers/lead/WORKER.md` alone starts. `wd:76` (`description` is the only key the file requires). [page]

## 3. Workers (the folder half)

- A worker's id is its team folder and its own folder joined with a dot: `teams/engineering/workers/lead/` is `engineering.lead`. An org worker's id is its folder name alone. `wd:148-150`, `read-workforce-directory.ts:375`. [page]
- `description` is the only key a `WORKER.md` requires; `name:` is an optional display name; `flow:` names the worker flow; leave it out and the worker runs on the built-in `agent`. `wd:76`. [page, one line; file format is `reference/worker-md`] [ref]
- Every `WORKER.md` is a **standard worker**: every user of every organization in the app has it, configured as the file says, and nobody can edit it while the app runs. `wd:271-273`. [page]
- A worker's folder holds `WORKER.md` and whatever other levels it owns (`references/`, `resources/`, `skills/`, `packages/`, `blocks/`). A worker folder without a `WORKER.md` stops start-up: **[run]** `the workforce folder did not load: - worker teams/core/workers/ghost: Worker folder "ghost" has no WORKER.md. ...`. `wff:84-91`, `wd:221`. [page]
- A worker flow is shared: each flow a worker names is one registered copy, shared by every worker that names it; a hundred workers on `agent` are one registered flow. `wd:275-279`. [page, in Code]
- A `WORKER.md` that names a worker flow that does not exist is refused at the hire: `cd:156` ("A flow whose declared `kind` disagrees with its basename is refused by `hireWorkforce`"), `wd:303-305`. [ref]
- A user's own workers (hired or forked while the app runs) are rows in the user's data, not files in the folder: `dh:108-110` ("one row in their user scope at `workforce/workers/<id>`"). [page, one clause; the collision of the words "workforce/workers/" with the folder path is to be avoided in prose]

### Names

- Every folder and file name the tree reads (teams, workers, documents, skills, packages, flow and block files) obeys one rule: lowercase letters, digits and single hyphens, at most 64 characters, not at the start or end of the name. `wd:154-160`, `seg:51-79`. [page, one sentence; full rule is ref]
- Windows device names (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`) are refused whatever the extension. `wd:160`, `seg:80-88`. [ref]
- A team name that breaks the rule stops start-up, naming the folder and the rule. **[run]** `teams/Core/workers/lead/WORKER.md` -> `worker teams/Core/workers/lead: Team folder name "Core" must be lowercase letters, digits, and single hyphens ...`. `seg:64-78`. [page, as the second example of "a file in the wrong place"]

## 4. Documents (question 1)

- Two folders hold documents. `references/`: the file is the text, changed by editing the file and deploying, nothing running in the product can overwrite it. `resources/`: a block or the agent can write it, and the text survives the turn. `dd:15-17`. [page]
- **Where does a document every worker on a team should read go?** `teams/<team>/references/<name>.md`. A reference reaches the workers of its organization, its team and its own folder, and nothing beside them: `dd:277-279`, `wd:144`. A team's `references/` documents reach only that team's workers; a team's `resources/` documents reach every worker on the worker flow that installed them, whatever its team: `wd:144`. [page]
- Its ref is `teams/<team>/<name>`: `dd:101-102` (table: `teams/engineering/resources/scratch.md` is `teams/engineering/scratch`), `rc:100-111`, `rc:135-152`. [ref]
- For a document every worker in the organization reads: `org/references/<name>.md`, ref the bare file name (`code-of-conduct`). `dd:98-100`, `dd:277`. [page]
- To let a reference reach more people, move the file up the tree; there is no setting to widen it: `dd:279`. [page]
- An unreachable reference is not an empty read: its accessor is not on the worker's map, and `ctx.resources.get("teams/support/escalation")` throws `is not registered`. `dd:279`. [ref]
- A worker can ask for less than its place gives it with `references:` in its own file; the list narrows and never widens, and naming one it cannot already reach refuses the roster at the hire. `dd:281-292`, `wd:82`. [ref]
- A file is a document; a folder is not: `<name>.md` sits directly in `references/` or `resources/`. A directory there is reported as an error. `dd:59`, `dd:174` (`folder-where-file-belongs`). [page, one sentence]
- A document file's frontmatter needs `description`; frontmatter never reaches an agent, the body does. `dd:78-80`. [page]
- `references/` and `resources/` share one namespace: `references/handbook.md` and `resources/handbook.md` in one folder claim the same ref and stop start-up, naming both files. `dd:55`, `rdr:176-198`. **[run]**: `reference <dir>/teams/core/references/a.md: ".../references/a.md" and ".../resources/a.md" both claim the ref "teams/core/a". ...`. [page, one sentence]
- The kit installs the folder's documents and references itself: `kit:263-264` (`documents: { ...resourcesFromDocs([...folder.documents]), ...modules.resources }`, `references: referencesFromDocs([...folder.references])`). Nothing to hand-wire. [page]
- What a worker's model can do with one: a worker on `agent` reads documents through `readResourceContent`, which has to be in the worker flow's catalog and in the worker's `tools:`; it then lists and reads only what the worker is granted. `ag:38` (`TOOLS`), `ag:76-79` (catalog), `ag:121-122` (each worker lists its own grant, `["org/handbook"]`), `dd:323-336` (`llmReadable: true` in the file is the document's half of the opt-in), `dd:269`. [ref; the page links to Documents on disk]
- `llmReadable` passes from the file to the document: it is not one of the keys a `references/` file may not declare (`dd:92`, `rfr:207`). [ref]
- Where the document's frontmatter keys a file may and may not declare is `reference/workforce-folder` material: `dd:86-92`. [ref]
- Referencing from outside the folder, `readReferencesDirectory`, `referencesFromDocs`, `clearShadowedReferences` and the move from `resources/` to `references/`: `dd:117-153`, `dd:196-271`, `dd:342-379`. [cut: the kit does the reading and installing; moving a document is `Documents on disk`]

### Stored data: documents

Four questions, for each part that stores data.

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A `references/` file | The app: the file in the repository. | The workers whose place reaches it (organization, team, own folder); `references:` narrows. `dd:277-294`. | Not stored: the file itself, read whenever an execution context is built; an edit reaches the next request. `dd:253`, `rfr:174-185` (`contentFile`, `writable: false`, `llmWritable: false`). | One document per file. No per-user or per-org copy. `dd:253`. |
| A `resources/` document | The organization: the file is the starting content, then a stored row is the source. `dd:253`, `dd:275` (figure description), `rfd:75-80` (`scope: "org"`). | Every worker on the flow that installs it, unless filtered, or narrowed by a worker's `resources:`. `dd:277`, `dd:304-306`. | The app's org-scope store, one row per organization. `dd:255`. A later edit to the file does not change a row already written. `dd:275`. | One row per organization; with `flowIsolation: true` in the file, one per user per flow. `dd:255`, `dd:310`. |

- Every file-declared document is org-scoped; a session- or user-scoped one stays in TypeScript: `dd:253`, `dd:384`, `rfd:47-49`, `rfd:78`, `rfr:138`, `rfr:173`. [ref]

## 5. Code (question 2)

- Worker flows, blocks and capabilities are TypeScript files in the tree; `fsdev gen` reads the tree and writes `workforce/workforce.gen.ts`, a file of static imports; the app hands that module to the kit as `generated`. `cd:10-12`, `cd:16`, `cd:70-103`, `kit:97-98`, `ks/lib/workforce-kit.ts:38`, `:56`. [page]
- **You add a flow under the tree: what do you run?** `pnpm fsdev gen`. `cd:64-68`. Then restart: nothing regenerates while `next dev` runs and nothing scans the tree while the app runs. `cd:18`, `wd:956`. [page]
- The command finds its generator in the app's dependencies, so `@flow-state-dev/workforce` has to be in the app's `package.json` `dependencies` (or `devDependencies`). `cd:70`, `gen:108-127` (reads both lists; none exports `./fsdev-gen` -> `No dependency in <package.json> exports a generator on "./fsdev-gen".`; more than one -> `More than one dependency exports a generator`). [page, one sentence; error strings ref]
- `fsdev gen` reads `workforce/` relative to where it runs; `--root <dir>` reads another. `fg:70-73`, `gen:162`, `gen:195`. [page]
- Commit the file it writes. `fsdev gen --check` regenerates nothing and exits non-zero when the committed file and the tree disagree; give it its own CI step, not a place inside the build script. `cd:127-139`, `gen:16-19`, `gen:196`. [page]
- `fsdev gen` loads no app code: it reads the tree and never opens a discovered file. `gen:11-14`, `disc:4-11`. [ref]
- The generated file's exports: `workerFlows`, `blocks`, `resourceModules`, `workerBlocks`, `packageBlocks`. `cd:83-103`, `cd:107-115`, `kit:60-76`. The kit's `generated` takes the module whole and takes no other key: a misspelled one is refused at construction. `kit:97-98`, `kit:120-131`, `kt:197-201` (`refuses a generated module with a map it doesn't know, at construction`). [page: pass it whole; per-export table is ref]
- What goes where, in one line for each export: `workerFlows` -> the worker flows the kit serves; `blocks` -> the built-in `agent` flow's tool catalog, when its config names none; `resourceModules` -> capabilities onto the agent and coordinator flows' `uses`, resources beside the documents; `workerBlocks`, `packageBlocks` -> the blocks a worker's own, team's and held packages register. `kit:62-75`, `kit:196-204`, `kit:219-227`, `kit:237`, `kit:261-262`. [ref]
- A worker flow the generated module holds and `workerFlows` holds under one name is refused: `kit:200-203` (`the generated module and \`workerFlows\` both hold "...". Keep one.`). One named `agent` or `coordinator` replaces the kit's own, which is then not configured. `kit:12-16`, `kit:205-207`, `kit:215-217`. [ref]
- Each code file default-exports one thing: a `workerFlow(...)` builder for `flows/workers/`, a block definition for a `blocks/` folder, a capability or resource for `resources/`. A worker flow is a builder because it is built on the installation, which a file cannot import. `cd:42-60`. [page]
- Adding a worker flow is adding a file: the startup line names no worker flows. `cd:12`, `cd:125`. A hand-written map still works and the two compose. `cd:205-207`. [page, one line]
- The file's name is its registered name: basename without extension, with hyphens preserved in the registered name and underscores in the generated import binding. `cd:105`, `disc:262`, `disc:284-289`. [ref]
- Code folders hold declarations only. Every `.ts` / `.tsx` file in a code folder is a declaration; a `fixture.ts` beside a worker flow registers a flow called `fixture`, and a name with a second dot (`request-triage.test.ts`) is refused by gen. Keep tests and fixtures outside `flows/workers/`, every `blocks/` folder and every `resources/` folder. `cd:154`, `disc:257-268`; **[run]** `blocks/x.test.ts` refused by gen. [page, one sentence; this is the trap a newcomer meets]
- A directory inside `flows/workers/` or `blocks/` is refused by name, not skipped: `disc:247-253`, `cd:146`; the kit refuses it too: `kt:86-102` (`flows/workers/nested` named). [ref]
- Files that are not TypeScript are skipped by gen (`cd:152`, `disc:257-260`), but the kit refuses a file in a code folder it does not read (flag 1). The page follows the kit. [page]
- A block registers a name; a worker can call it only if its own `tools:` list names it. A file appearing in a folder never widens what an agent can do. `cd:160`, `bw:47` ("Registering a name is not granting it"). [page]
- Name resolution is nearest first: the worker's own `blocks/`, then its team's, then the catalog (`workforce/blocks/`). `cd:173`, `bw:45`. [ref]

### Stored data: code

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A worker flow file | The app. | Every worker whose `flow:` names it. `wd:275-277`. | Not stored: static imports in `workforce.gen.ts`, resolved by the bundler, a deployed app registers what a local one does. `cd:16`. | One registered copy, shared by every worker on the flow. `cd:60`, `wd:275-277`. |
| A block file | The app. | Every worker for `workforce/blocks/`; every worker on the team for `teams/<team>/blocks/`; one worker for its own. A worker calls it only if its `tools:` names it. `cd:164-168`, `cd:160`. | Not stored. | One per file. |
| `workforce.gen.ts` | The app: written by the command, committed. `cd:129`. | The kit, as `generated`. `kit:97-98`. | In the repository. | One. |

## 6. Capabilities

- A `.ts` file in a `resources/` folder is code: a **capability** (a bundle of context, tools and resources a worker can carry) or a plain resource. A `.md` file there is a document. `cp:10`. [page]
- A capability file default-exports `defineCapability({ name, presets })`; a **preset** is a named slice that can be on or off; `default: []` means no preset is on unless asked for. `cp:19-41`. [page, one example: `cp:27-39`]
- Run `fsdev gen`; it writes the module onto `workforce.gen.ts` under `resourceModules`, keyed by the same ref a document of that name would get (`teams/support/research`). `cp:49-60`, `cp:12`. [page]
- The file default-exports one value and it has to be a capability or a resource; anything else fails the app's own `tsc` against the generated file, and `splitResourceModules` throws naming the module. `cp:43`, `split-resource-modules.ts:93-103`. [ref]
- A capability lives at org level or in a team. One in a single worker's own `resources/` folder is refused by name, because every worker on a worker flow shares that flow's capabilities. A plain resource there is fine. `cp:45`. [page, one sentence]
- With the kit, the capabilities go to the agent and coordinator flows the kit builds and the resources join the documents; nothing is written in the app. `kit:219-227`, `kit:263`, `kt:177-195` (`installs the generated resource modules: a resource a worker is granted, and a capability its flow uses`). [page]
- A capability on a worker flow reaches every worker on that flow; a worker's own file says which presets it wants: `capabilities:\n  research: [briefing]` in `WORKER.md`. A worker whose file says nothing gets the capability's defaults. `cp:100-112`. [page]
- Naming a preset adds; no spelling turns one off; to quieten a capability for some workers, turn it down where it is installed. `cp:116-122`. [ref]
- A selection that names a capability the flow does not carry, a preset it does not declare, or one the app turned off refuses the roster at the hire, naming the worker. `cp:152-163`. [ref]
- A `.md` and a `.ts` of one name in one `resources/` folder are refused by `fsdev gen`, not at startup (flag 2): `cp:60`, `cd:147`; **[run]**. [page, folded into the gen rule]
- Goal evidence: two workers of one type, one naming a preset and one naming nothing, answer differently because of a capability file: `goals/workforce-conventions/capabilities-come-from-files-alone/goal.md:5`, `:9`. [page, as the proof; not cited by name]

### Stored data: capabilities

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A capability file | The app. | Every worker on the flow it is installed on; each worker's own file picks the presets it uses. `cp:100-112`. | Not stored: code, an import in the generated module. | One per file, one per flow it is installed on. |

## 7. Packages (question 4)

- A **package** is a folder you hand to a worker: a `PACKAGE.md` that tells it how to do something, and an optional `blocks/` folder with the tools it needs. Adding one takes no change to the app's source: put the folder where the worker can see it, run `fsdev gen` if it has blocks, restart. `pk:10`. [page]
- Where the folder sits decides who holds it. `pk:40`:
  - A worker's own: `teams/<team>/workers/<worker>/packages/<name>/` (or `org/workers/<worker>/packages/<name>/`). That worker holds it, always, with no line in its file. `pk:42`, `pk:57`.
  - A team's library: `teams/<team>/packages/<name>/`. **A worker on that team holds it once it names it** in `packages:`. `pk:43`. [page]
  - The org's library: `org/packages/<name>/`. Any worker holds it once it names it. `pk:44`. [page]
- **Who holds a package placed at team level?** A worker on that team whose own file names it. A package no worker names reaches nobody; adding one to a shared folder changes no worker until one asks. A worker cannot name a package from another team's library or from another worker's folder. An org worker has no team, so no team library reaches it. `pk:43`, `pk:55`, `pk:92`, `wp:1-8`, `wp:87-91` (a team-level package is refused for an org worker or another team's worker), `wp:117-119` (team library first, then org). [page]
- A worker names library packages in its own file: `packages: [escalation]`. `pk:46-53`. The team's library is looked in first, then the org's. `pk:55`, `wp:117-119`. [page]
- A package's text is instructions on every turn for the worker that holds it; `description` is for people and never reaches the model; it is the only frontmatter key. `pk:30`. [ref]
- A package with no `blocks/` is fine: instructions only. `pk:34`. [ref]
- A package's tools reach only the workers that hold it; they are not in the app's tool catalog. `pk:69`. A worker's `tools:` line governs what it can call from packages it holds: no line -> every block of every package held; a line -> exactly that list; `tools: []` -> none, the instructions still arrive. `pk:61-65`. [ref]
- A package holds a `PACKAGE.md` and a `blocks/` folder, nothing else: a `resources/`, `references/`, `skills/` or `packages/` folder in one is refused, and a package with any refusal is left out whole. `pk:102`, `packages/workforce/src/loader/read-packages-directory.ts:1-26`, `:53` (`REFUSED_PACKAGE_ENTRIES`). [ref]
- Run `fsdev gen` after adding or removing a block; an edit to `PACKAGE.md` needs a restart and nothing more. `pk:36`. [page]
- With the kit, `packageBlocks` from the generated module is handed to the installation; leave it out and a held package brings its instructions and no tools. `kit:261-262`, `pk:90`. [page, folded into "pass the module whole"]
- Goal evidence: a package in one worker's own folder reaches that worker, not its sibling; the worker whose file writes `tools: []` follows the package's text and calls nothing. `goals/workforce-packages/a-held-package-reaches-one-worker/goal.md:5`, `:9-13`. [page, as the proof; not cited by name]

### Stored data: packages

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A package folder | The app. | Held by: the one worker (own folder); the workers of a team that name it (team library); the workers anywhere that name it (org library). `pk:40-57`. | Not stored: the text is read at startup, the blocks are found by `fsdev gen`. `pk:145`. | One per folder, held by as many workers as hold it. |

## 8. Skills and `TEAM.md` (one line each; the page links)

- A skill is `skills/<name>/SKILL.md` at org level (every worker on every team), a team's (every worker on that team), or a worker's own (that worker only); a team worker holds all three, an org worker two (org and its own). `bw:130-151`, `wd:188`. [page, one line; belongs on the skills page]
- A worker's skills are that worker's, kept in the scope of the user it runs for; a worker keeps a copy from the moment it first reads a skill, and later edits to the folder do not reach a worker already running with it. `bw:128`, `bw:187`. [ref]
- `TEAM.md`: one optional file at `teams/<team>/TEAM.md`, `description` required when the file exists, body = instructions every worker on the team is told. `wd:94-135`. It reaches only that team's workers. `wd:139-140`. A `TEAM.md` anywhere else (at `org/`) is refused under the kit: **[run]** `"org" is not used by anything that reads the folder of kit "workforce"`; there is no org-wide instruction layer: `wd:265`. [page, one line]
- **A decision for a document every worker on the team should read, versus instructions every worker on the team is told:** instructions that apply to every turn go in `TEAM.md`'s body (read as a setting of each worker, `wd:117-127`); reference material a worker looks up goes in `teams/<team>/references/`. Both stay in the team. [page, one sentence]

### Stored data: workers, team instructions, skills

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A `WORKER.md` (standard worker) | The app: the file. | Every user of every organization in the app. `wd:271-273`. | Not stored: "read from your files each time, so a deploy that changes a file changes it for everyone". `dh:108-110`. | One per file; one registered flow shared by every worker on it. `wd:275-277`. |
| A user's own worker (hire or fork) | The user. | That user only. `dh:10-11`. | One row in the user's scope, `workforce/workers/<id>`. `dh:108`. | One per hire or fork. Not in the folder. |
| `TEAM.md` | The app. | The workers of that team only. `wd:139-140`. | Not stored: it rides each worker's own configuration. `wd:139-140`. | At most one per team; none at org level. `wd:105`, `wd:265`. |
| A skill (`SKILL.md`) | The app's folder seeds it; the user's worker then holds its own copy. `bw:128`, `bw:187`. | The worker and the user it runs for; "two people never share one worker's copy". `bw:128`. | The user's scope, once a worker first reads it. `bw:128`, `bw:187`. | One per worker per user. |

## 9. What reads the folder, and when (the plan's last Use-it heading)

- **At startup**: the kit reads the whole folder once, claims every file it reads, and refuses the app if any file is left unclaimed, any worker, team file, skill, package, document or reference failed to load, or a symlink sits anywhere in it. Every problem is named at once, across every kit. `wff:3-12`, `claim:1-17`, `kits:260-290` (`createFlowState: the app can't start; a kit's folder was refused:` and one `- kit "workforce": ...` line per problem). **[run]**. [page]
- The refusal's wording for a stray file: `"<path>" is not used by anything that reads the folder of kit "workforce". Remove it. (<folder>)`. `claim:114`, `kits:279`. [page, as the example; wording is ref]
- A file the kit reads and cannot load (a worker folder with no `WORKER.md`, a team name that breaks the rule, a reference and a document of one name): `the workforce folder did not load:` and a `- <layer> <path>: <message>` line each. `wff:86-91`, `rdr:45-57` (layers: `worker`, `skill`, `team`, `document`, `reference`, `package`). **[run]**. [page, as the second example]
- Never followed: a symlink anywhere in the folder is refused, claimed or not. `claim:11-15`, `claim:89-93`. [page, one clause]
- `.DS_Store` and `Thumbs.db` are the only names passed over everywhere. `claim:5-8`, `packages/engine/src/folder/walk.ts:149`. [page, one clause]
- **At build time** (when you run it): `fsdev gen` reads the code folders and writes `workforce.gen.ts`. `cd:14-18`. Nothing regenerates in `next dev`. `cd:18`. [page]
- **At each request**: a reference is read from its file whenever an execution context is built; an edit reaches the next request, and a read already in flight keeps the body it started with. `dd:253`, `dd:393`. [page, one clause]
- **On each turn**: the worker's configuration is resolved from its file, its team's `TEAM.md`, the packages it holds and the capability presets it names. `wd:116-127`, `wd:275-279`, `cp:100-112`, `pk:92`. [cut: mechanism]
- Nothing watches the folder: "It does not watch the tree. Read it once, at startup." `dd:388`, `wd:956`, `cp:167`. [page]
- A running app does not see a new `WORKER.md`, document or package without a restart; a new code file needs `fsdev gen` and a restart. `wd:956`, `pk:145` ("a new or removed block needs `fsdev gen` and a restart"), `cd:18`. [page]

## 10. Try it / the starter

- The smallest folder to copy: the UI registry item `workforce-starter` copies `TEAM.md` to `workforce/teams/team/TEAM.md` and `WORKER.md` to `workforce/teams/team/workers/assistant/WORKER.md`, and "never overwrites a file already there". `reg` (`registry.json:767-785`). [page]
- The two starter files: `TEAM.md` (`name: Team`, description "The app's first team. Rename it, and describe what it is for.", body "Instructions every worker on this team reads go here.") and `WORKER.md` (`name: Assistant`, description "Answers the user's questions.", body "You are the team's assistant. Answer in a sentence or two, and say plainly when you don't know."). `packages/ui/registry/workforce-starter/TEAM.md:1-6`, `WORKER.md:1-12`. [page]
- A worker with no `flow:` runs on the built-in `agent` flow, so the starter needs no flow of the app's: `reg` (description: "one team with one worker on the built-in agent flow"), `wd:76`. [page]
- A real tree with `blocks/`: kitchen-sink's `support` team, five workers, two blocks under `workers/fsd/blocks/` (`fetch.ts`, `search-docs.ts`) named in that worker's `tools: [search-docs, fetch]`, and the committed `workforce.gen.ts` beside the team folder. `ks/workforce/teams/support/workers/fsd/WORKER.md:1-3`, `ks/workforce/workforce.gen.ts:11-27`. [page, as the link to the real tree]
- How the kit meets the generated module in that app: `import * as generated from "../workforce/workforce.gen"`, then `workforce({ directory, generated: { ...generated, ... }, agent: { catalog: blocks }, coordinator: {...} })`. `ks/lib/workforce-kit.ts:38`, `:50-61`. The kit's own example is `workforce({ agent: { model: "openai/gpt-6-luna" } })`. `kit:172`. [page, the kit example]
- The goal fixtures show the minimum for each convention, and each lists only the files that convention needs: `goals/workforce-conventions/code-comes-from-files-alone/fixtures/workforce/flows/workers/desk-clerk.ts`; `.../capabilities-come-from-files-alone/fixtures/workforce/teams/support/resources/research.ts`; `goals/workforce-packages/a-held-package-reaches-one-worker/fixtures/workforce/teams/support/workers/iris/packages/ticket-desk/{PACKAGE.md,blocks/stamp-ticket.ts}`. [cut: fixtures]

## 11. Not on the page (the page links; each has its home)

- Every path rule and every file format: `reference/workforce-folder`, `reference/worker-md`. The ref table (`dd:96-103`), the derived-settings lists (`dd:84-92`), the `kind` table of `errors` (`dd:169-176`), the `WORKER.md` keys (`wd:57-90`), and the preset-selection refusals (`cp:152-163`). [ref]
- The by-hand startup, the readers' return shapes and error channels (`readWorkforce`, `readResourcesDirectory`, `readDeclaredRoster`, `createWorkerInstallation`, `hireWorkforce`, `resourcesFromDocs`, `referencesFromDocs`, `splitResourceModules`): `wd:162-305`, `dd:117-271`, `cp:64-96`, `pk:71-92`. [cut: the kit does this]
- `clearShadowedReferences`, moving a document into `references/`: `dd:342-379`. [cut]
- Worker flows of your own (`workerConfigSchema`, `workerFlow`, `installation.session()`), per-worker data, `resolveWorker`, the shared resource helper: `wd:307-345`, `wd:547-600`, `wd:757-827`. [cut]
- `workerPackages` on a worker flow of your own: `pk:126-139`. [cut]
- Controls and tools in a preset (`controlTools`), upgrading from workforce 0.3: `cp:126-148`, `cp:173-175`. [cut]
- Paths or counts of generated binding names: `cd:105`. [cut]
- Any tracker id: `goals/**/goal.md` headers and `ks/lib/workforce-kit.ts:22` carry them; none belongs on the page. [cut]

## Revise round 1

Checked against code, then the page changed.

- Reload: the tree is read at startup, but a reference's text is read from its file whenever an execution context is built, so an edit reaches the next request (`rfr:12-13`). The opening, the Documents section and the Change it section now say the same. [page]
- A standard worker can be edited per user: the edit copies it to the user's roster under the same id, and a reset deletes the copy (`packages/workforce/src/workers/hire-blocks.ts:81-90`, `roster-view.ts:7-8`, `:92-99`). The page no longer says nobody edits it; roster states go to the Workforce reference (R-25). [ref]
- A capability in a worker's own `resources/` folder is not refused by `fsdev gen` or at startup. The generated file types that entry (`WorkerResourceModuleExport`), so the app's typecheck rejects it, naming the file (`packages/workforce/src/codegen/render.ts:61-76`, `:125-160`; `discover-resource-modules.ts:15-27`). The page says "fails your app's typecheck". Supersedes the "refused by name" wording in section 6 above. [page, one clause]
- `fsdev gen` reads the tree and never opens a discovered file (`gen:11-14`); the generated module imports the files. The page says gen "registers" them.
- Startup refusal wording: the engine throws `createFlowState: the app can't start; a kit's folder was refused:` and one `  - kit "workforce": <message> (<folder>)` line per problem (`kits:274-290`), the message being the claim pass's sentence (`claim:114`). The example left the page; the wording is Kits reference (R-11). Supersedes section 9's "as the example". [ref]
- Moved to Reference, page now links: naming rules, levels each folder takes and the refused `tools/` folder, the `description`/`flow:` defaults and the missing-`WORKER.md` refusal, worker id rule beyond the one example, document name clash, `fsdev gen` details and `--check`, `--root`, code-file name rule, capability ref naming, `capabilities:` default, package holding rules, the reload table, `directory`. Targets: R-11 `reference/kits.md`, R-25 `reference/workforce.md`, R-28 `reference/worker-md.md`, R-29 `reference/workforce-folder.md`, R-35 `reference/cli.md`.

## Revise round 2

- `.tsx` is registered by gen as well as `.ts`: `tsm:13` (`[".ts", ".tsx"]`), `disc:270`. The page says "`.ts` and `.tsx`" in both places. [page]
- A capability in a worker's own `resources/` fails the app's typecheck, not startup or gen: `render.ts:61-76` (`WorkerResourceModuleExport` types the entry). Checked, unchanged. [page]
- `workforce-roster` is the flow the user's own hired and edited workers are kept in: `packages/workforce/src/workers/roster-flow.ts:1-30`, `roster-view.ts:58`. The `agent` flow is what a worker with no `flow:` runs on (section 3); its model is `agent.model` (`kit:172`). [page, one clause each]
- The `resources/` folder holds `.md` documents and `.ts` capabilities, stated once at first appearance; capabilities are team or org level only (`cp:45`). [page]
- Reload: a reference's text is read per request; any other edit to `WORKER.md`, `TEAM.md`, a `resources/` document or a package needs a restart (`wd:956`, `rfr:12-13`). [page]

## Revise round 3

- A reference is read-only: a worker reads the file as it is and cannot change it (`rfr:174-185`, `writable: false`, `llmWritable: false`). [page]
- A `references/` file and a `resources/` file of one name in one folder claim the same ref and stop start-up (section 4, `rdr:176-198`). The page says so at the same level. [page]
- `fsdev gen` registers every `.ts`/`.tsx` file in `flows/workers/`, a `blocks/` folder or a `resources/` folder (`disc:257-270`). [page]
- The capability placement limit (a worker's own `resources/` fails typecheck, `render.ts:61-76`) now lives on the Workforce folder reference link, not in the page prose; the page names org and team only. [ref]
- The reload rule is stated in the opening and Change it; the Documents section no longer repeats it. The startup-refusal sentence is in What you get and What reads the folder, with the second adding only load failures. [page]
