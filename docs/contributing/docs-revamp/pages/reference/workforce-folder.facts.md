# Facts for The workforce folder (R-29, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and the example apps. No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was cited; the page plan entry came with the brief. The surfaces named here are all built, so no fact is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `dd` = `apps/docs/docs/workforce/documents-on-disk.md`
- `cd` = `apps/docs/docs/workforce/code-on-disk.md`
- `cp` = `apps/docs/docs/workforce/capabilities-on-disk.md`
- `pk` = `apps/docs/docs/workforce/packages-on-disk.md`
- `wd` = `apps/docs/docs/workforce/workers-on-disk.md`
- `bw` = `apps/docs/docs/workforce/built-in-worker.md`
- `wfs` = `packages/workforce/src/`
- `wff` = `wfs/loader/read-workforce-folder.ts` (the kit's reader and its claim list)
- `rdr` = `wfs/loader/read-declared-roster.ts`
- `rwd` = `wfs/loader/read-workforce-directory.ts` (workers)
- `rtd` = `wfs/loader/read-teams-directory.ts` (`TEAM.md`)
- `rrd` = `wfs/loader/read-resources-directory.ts` (documents and references)
- `rpd` = `wfs/loader/read-packages-directory.ts`
- `rws` = `wfs/loader/read-worker-skills.ts`
- `rc` = `wfs/loader/resource-convention.ts` (refs)
- `rw` = `wfs/loader/resource-walk.ts`
- `seg` = `wfs/loader/segments.ts`
- `sn` = `packages/core/src/helpers/segment-name.ts`
- `wrn` = `packages/contracts/src/helpers/windows-reserved-name.ts`
- `skm` = `packages/orchestration/src/skills/skill-md.ts`
- `disc` = `wfs/codegen/discover.ts`
- `dwb` = `wfs/codegen/discover-worker-blocks.ts`
- `drm` = `wfs/codegen/discover-resource-modules.ts`
- `dpb` = `wfs/codegen/discover-package-blocks.ts`
- `rnd` = `wfs/codegen/render.ts`
- `tsm` = `wfs/codegen/typescript-module.ts`
- `fg` = `wfs/codegen/fsdev-gen.ts`
- `gen` = `packages/fsdev/src/commands/gen.ts`
- `dw` = `packages/fsdev/src/dev-watch.ts`
- `kit` = `wfs/kit/workforce-kit.ts`
- `wp` = `wfs/worker-packages.ts`
- `wr` = `wfs/worker-references.ts`
- `rfd` = `wfs/resources-from-docs.ts`
- `rfr` = `wfs/references-from-docs.ts`
- `man` = `wfs/manifest.ts`
- `rmod` = `wfs/resource-modules.ts`
- `sw` = `wfs/workers/standard-workers.ts`
- `claim` = `packages/engine/src/folder/claim.ts`
- `walk` = `packages/engine/src/folder/walk.ts`
- `kits` = `packages/engine/src/flowstate/kits.ts`
- `dk` = `packages/core/src/kit/define-kit.ts`
- `fst` = `packages/engine/src/flowstate/types.ts`
- `rr` = `packages/engine/src/context/resource-registry.ts`
- `kt` = `packages/workforce/test/workforce-kit.test.ts`
- `pts` = `packages/workforce/test/published-tree-surface.test.ts` (one row per published path shape, lines 392-857)
- `rms` = `packages/workforce/test/resource-module-shapes.test-d.ts`
- `ks` = `apps/kitchen-sink` (`workforce/`, `lib/workforce-kit.ts`)

Legend: **[table]** goes on the page as a table row. **[lookup]** answers a lookup the page promises. **[run]** observed by running the code in this pass: a throwaway script against `packages/workforce/src` and the engine, over trees written to a temp folder (the script and the trees are removed); the line cited is the code that produces it. **[verify]** not confirmed by running; keep off the page or soften. **[cut]** history, mechanism or another page's job. **[R-n]** another Reference page owns it; this page links.

## Flags against the page plan, the existing pages and the pages that point here (read first)

1. **The existing pages describe the readers; the kit is stricter, and the kit is what an app runs.** `wd:259-267` ("What is passed over in silence": a `README.md` inside `workers/`, a team's `tools/` folder, a `TEAM.md` at `org/`) and `cd:152` ("Files that are not TypeScript are skipped") are true of `readWorkforce` and `fsdev gen` called alone. Under `workforce({...})` the only names passed over anywhere are `.DS_Store` and `Thumbs.db` (`walk:22`, `claim:84`); every other file or empty folder nothing reads stops the app, named. **[run]**: `notes.txt`, `org/TEAM.md`, `flows/helper.ts`, `flows/workers/README.md`, `teams/core/workers/README.md`, `teams/core/workers/lead/README.md`, `teams/core/tools/`, `org/blocks/`, `org/workers/boss/blocks/` and a `.gitkeep` are each refused; so are empty folders (`org/`, `teams/empty/`, `teams/core/skills/`, a worker's empty `references/`). The page follows the kit and does not repeat the "passed over in silence" rule. Dropped: `wd:259-267`, `cd:152` (see the incoming-rows section).
2. **A file in the wrong place and a file wrongly named are caught at different times.** Wrong place (not on the claim list): refused when the app starts. Right place, wrong name (`blocks/x.test.ts`, `blocks/types.d.ts`, `blocks/Foo.ts`), a `.ts` beside a same-named `.md`, a directory inside a code folder (that one is caught by both), a `.ts` and a `.tsx` of one name: the kit starts and `fsdev gen` refuses. **[run]**: `blocks/x.test.ts` and `teams/core/resources/a.ts` beside `a.md` pass `readWorkforceFolder` and fail `discoverWorkforceCode`. Sources: `wff:48-59` (claim by path shape, not by name characters), `disc:257-277`, `cd:145-147`.
3. **The kit claims `.mts` and `.cts`; `fsdev gen` registers only `.ts` and `.tsx`.** Claim set: `wff:45`; module test: `tsm:13`. **[run]**: `flows/workers/a.mts` and `blocks/b.cts` start the app and `fsdev gen` registers neither (`0 block(s)`; only the `.tsx` beside them appears). `kt:86-88` plants `coder.mts` and expects it not to be named as a stray. The page says code files are `.ts` and `.tsx`; one clause may say `.mts` and `.cts` are accepted and not registered.
4. **The same name rule is worded two ways.** Workers, teams, documents, flows, blocks and packages use `seg:52-89` (`... must be lowercase letters, digits, and single hyphens (not at the start or end) — it becomes ...`; `exceeds 64 characters`; `is reserved`; `is a reserved device name on Windows — a tree containing it cannot be checked out there, whatever the extension`). Skills use `skm:123-146` (`Skill name "X" exceeds 64 chars`, `is reserved`, `must be lowercase letters, digits, and single hyphens (not at the start or end)`, `is a reserved device name on Windows`). One rule, two sentences; the table gives the rule, the lookup gives both wordings.
5. **A team folder that holds only a `TEAM.md` is never name-checked.** `teams/Core/TEAM.md` alone starts the app and the team is read as `Core`: the readers check a team's name only when a worker, document, block or package under it needs it for an id, a ref or an address. **[run]**: `readWorkforceFolder` over `teams/Core/TEAM.md` returned team `Core`, no error. Source: `rtd:118-199` (no `validateSegment`), `rwd:372-376` (`mintWorkerId` validates), `rc:135-152`. Keep off the page's rule line; state in the lookup, flat: "a name is checked when something under it needs it".
6. **The page plan's "everything the kit reads" is the claim list, and no tree in the repo holds every part.** Nearest: `pts:392-857` (every published shape, one concrete file each), `kt`, kitchen-sink's `support` team (`ks/workforce/teams/support/workers/*`, two workers' own `blocks/`, `ks/workforce/workforce.gen.ts`) and the goal fixtures. The path table is composed from `wff:48-59`, checked against `pts`.
7. **`fsdev gen`'s root and the kit's folder resolve differently.** The kit's default folder is `workforce` against the app's `root` (`createFlowState({ root })`, default the working directory): `dk:136-143`, `fst:181-187`, `kits:231-248`. A `directory` in the kit's config reads against the working directory, as typed. **[run]**: `createFlowState({ root })` over a temp app with `workforce/` started; a root with no `workforce/` folder stopped with `Failed to read folder of kit "workforce" "<root>/workforce": ENOENT ...`. `fsdev gen` reads `workforce` relative to where the command runs, or `--root <dir>`: `fg:70-73`, `gen:162`, `gen:195`. Run from the app's folder, they are one folder.
8. **A package with any refusal stops the app under the kit.** `pk:96` ("reported in `packageErrors` ... if it has none, the package is missing from that worker and `packageErrors` is the only place it shows up") describes `readWorkforce` alone. The kit's reader throws on every problem, packages included (`wff:84-91`, `rdr:161`). **[run]**: a package folder with no `PACKAGE.md`, a `resources/` folder inside a package, an extra frontmatter key and a loose file in `packages/` each stopped the read with a `- package <path>: ...` line. The page states the kit's behaviour.
9. **`wd:271-273` ("nobody can edit it while the app runs") is superseded.** A user's edit of a standard worker copies it onto the user's own roster under the same id; the file is untouched, and a reset deletes the copy: `wfs/workers/hire-blocks.ts:81-90`, `wfs/workers/standard-workers.ts:1-12`. `reference/worker-md` carries the edit row; this page states only that the file is the app's.
10. **`reference/worker-md.md:34-45` still carries a "Names in the tree" table.** The record that moved the table to this page ("so it lives once") also left a copy on that page. One of the two has to go; this page owns the table. Needs the caller's call.
11. **`catalog/workforce/the-workforce-folder.md` sends `directory` to `reference/workforce.md` (R-25), while the incoming row sends it here.** This sheet carries it here (reads: `kit` option, default, base path). The catalog page's link text for `directory` needs to point at this page or R-25 has to state it too. Needs the caller's call.
12. **R-11 (`reference/kits.md`) already owns the engine's folder rules**: unclaimed entries stop the app, symlinks, `.DS_Store` and `Thumbs.db`, the error wording, a missing folder. Its line 130 says "What `workforce` claims from `workforce/` is on Workforce folder". This page states what the kit claims, and one line for what a refusal looks like, then links.

## 1. What the kit reads

- The workforce kit reads one folder, `workforce/`, once when the app starts. `kit:1-8`, `kit:185` (`directory: { path: "workforce", read }`), `dk:136-143` ("`read` is the kit's reader, and runs on the server at start-up"). [table]
- The folder is `workforce` against the app's `root`; `createFlowState({ root })` sets the root (a path or a URL such as `import.meta.url`, whose directory is used), default the working directory. `fst:181-187`, `kits:40-45`, `kits:231-248`. [table]
- `directory` in the kit's config (`workforce({ directory: "./path" })`) replaces the folder, read against the working directory as typed. `dk:91`, `dk:241-246`, `kits:236-248`. `directory` must be a string (`kit "workforce": \`directory\` must be a path.`). `dk:245-247`. The kit's strict config does not list it: the factory takes it first. `kit:136-150`, `dk:241`. [table]
- A missing, unreadable or symlinked folder stops the app: `Failed to read folder of kit "workforce" "<path>": ENOENT ...`, `Symlinked folder of kit "workforce" "<path>" — refused for safety`. **[run]**; `claim:54-55`, `kits:274-290`. [table]
- An existing, empty folder is fine: the app starts and serves the `agent` and `workforce-roster` flows. **[run]**; `kt:75-80`. [table]
- The smallest tree that holds a worker is `teams/<team>/workers/<worker>/WORKER.md` with a `description`. **[run]**: `teams/core/workers/lead/WORKER.md` alone starts as `core.lead`. `rwd:272-282`. [table]
- The read walks the whole folder, claims each file it reads, and stops the app on anything left over, on any symlink, and on anything that failed to load; every problem is named at once, across every kit. `wff:3-12`, `wff:84-95`, `claim:1-17`, `kits:260-290`. Format, as thrown: [lookup] [R-11 owns the generic form]

```text
createFlowState: the app can't start; a kit's folder was refused:
  - kit "workforce": "notes.txt" is not used by anything that reads the folder of kit "workforce". Remove it. (<folder>)
  - kit "workforce": "teams/core/tools" is not used by anything that reads the folder of kit "workforce". Remove it. (<folder>)
```

  **[run]**; `claim:114`, `kits:279`, `kits:286-289`. A directory nothing reads is named once, at its top: `teams/core/tools`, not each file under it. `claim:98-110`, **[run]**.
- A load problem is a different message: `the workforce folder did not load:` then one `  - <layer> <path>: <message>` line per problem. Layers: `worker`, `skill`, `team`, `package`, `document`, `reference`. `wff:86-91`, `rdr:45-57`, `rdr:150-165`. **[run]**. [lookup]
- The two checks do not both run on one start. When anything failed to load, only the load problems are reported; the unused-file list appears once those are fixed. `wff:85-91` throws before `wff:92-94` claims anything; `kits:272-283` keeps the throw and skips `unclaimed()`. **[run]**: a tree with a worker folder lacking `WORKER.md` and a stray `notes.txt` reported only the first. Say it flat in the startup row.
- The kit serves one copy of each worker flow, the built-in `agent` flow (unless the app's worker flows hold one named `agent`), the `workforce-roster` flow, and the `coordinator` flow when `coordinator` is configured. `kit:232-255`, `kt:75-80`. The page links the Workforce reference for each. [R-25]
- The kit installs the folder's documents and references itself: `kit:262-263` (`documents: { ...resourcesFromDocs(...), ...modules.resources }`, `references: referencesFromDocs(...)`, passed only when there is at least one reference). Nothing to wire. [table]

## 2. Paths the kit reads, and what each becomes

The claim list is `wff:48-59`. Each path a published page tells an author to write has a row in `pts:392-857` (the test fails on a published shape no reader accounts for). `LEVEL` = `org`, `teams/<team>`, `org/workers/<worker>`, `teams/<team>/workers/<worker>` (`wff:43`).

| Path under `workforce/` | What it becomes | Source |
| --- | --- | --- |
| `teams/<team>/workers/<worker>/WORKER.md` | The standard worker `<team>.<worker>`. | `wff:53`, `rwd:372-376`, `wd:148-150` |
| `org/workers/<worker>/WORKER.md` | The standard worker `<worker>`, with no team. | `wff:53`, `rwd:372-376`, `wd:150` |
| `teams/<team>/TEAM.md` | The team's description, and the instructions every worker on the team is told. | `wff:52`, `rtd:1-8`, `rtd:185-196`, `wd:94-127` |
| `<LEVEL>/references/<name>.md` | A reference: a read-only document, read from the file. | `wff:55`, `rrd:137-170`, `rfr:12-13` |
| `<LEVEL>/resources/<name>.md` | A document a worker can write; the file is its starting text. | `wff:54`, `rrd:100-131`, `rfd:75-80` |
| `<LEVEL>/resources/<name>.ts` or `.tsx` | A capability, or a resource declared in code; found by `fsdev gen`. | `wff:54`, `drm:1-20`, `rmod:1-52` |
| `<LEVEL>/skills/<name>/SKILL.md` and anything beside it in that folder | A skill the workers at that level hold. | `wff:56`, `rws:138-146`, `bw:130-153` |
| `<LEVEL>/packages/<name>/PACKAGE.md` and `<LEVEL>/packages/<name>/blocks/<block>.ts` | A package: instructions, and the blocks that are its tools. | `wff:57`, `rpd:1-12`, `pk:10` |
| `flows/workers/<name>.ts` or `.tsx` | A worker flow, named by a `WORKER.md`'s `flow:`. | `wff:50`, `disc:85-88`, `cd:22-26` |
| `blocks/<name>.ts` or `.tsx` | A block every worker may name in `tools:`. | `wff:51`, `disc:85-88`, `cd:164-166` |
| `teams/<team>/blocks/<name>.ts` | A block every worker on the team may name. | `wff:58`, `dwb:3-12`, `cd:167` |
| `teams/<team>/workers/<worker>/blocks/<name>.ts` | A block that one worker may name. | `wff:58`, `dwb:3-12`, `cd:168` |
| `workforce.gen.ts` | The generated file `fsdev gen` writes: a list of imports of every code file above. | `wff:49`, `rnd:25-26`, `cd:70-103` |

- Table sizing: 13 rows. If the page keeps its six-row table limit, split into three tables: people and instructions (workers, `TEAM.md`); documents, skills, packages; code (flows, blocks, `workforce.gen.ts`). [table]
- `.mts` and `.cts` are claimed in the same code positions and not registered (flag 3). [table, one clause]
- "Level" means four places: the org, a team, a worker in a team, a worker at org level. For documents: `rw:56-59` (patterns `org/resources`, `org/workers/*/resources`, `teams/*/resources`, `teams/*/workers/*/resources`), `rc:100-111`. [table]
- Skills: any file inside `skills/<name>/` is claimed (`wff:56`, `/skills/[^/]+/.+`). A file directly in `skills/` (`skills/loose.md`) is refused. **[run]**. [lookup]
- Packages claim only `PACKAGE.md` and `blocks/<name>.<ext>` (`wff:57`). **[run]**: `README.md` in a package, `blocks/b.md` and `blocks/sub/` (a directory) are each refused at startup. [lookup]
- `flows/` holds only `flows/workers/`. A helper module beside it is refused by name, so keep helpers in the app's own folder. `wff:17-19`, `kt:84-102` (`flows/helper.mts`, `flows/workers/nested` named). **[run]**: `flows/helper.ts` refused. [lookup]
- There is no `blocks/` at org level other than `workforce/blocks/`: `org/blocks/` and `org/workers/<worker>/blocks/` are refused at startup (not claimed, `wff:58`) and by `fsdev gen`, whose message names the three places a `blocks/` folder may sit. `dwb:185-205`, `dwb:352-373`, `cd:171`, `cd:148`. **[run]**. [lookup]
- A `tools/` folder anywhere is refused. At startup it is one more unused folder (`"teams/core/tools" is not used by anything ...`). `fsdev gen` refuses it with its own sentence: ``"<path>" is a tools/ folder, which this convention does not read. A tool is an ordinary block: put the file in a `blocks/` folder and name it in a worker's `tools:` ``. It looks at the root, `org/`, each org worker's folder, each team and each team worker's folder. `dwb:56`, `dwb:209-228`, `dwb:248`, `dwb:258`, `dwb:268`, `dwb:303`, `dwb:370`, `cd:149`. **[run]**. [lookup]

### What each level takes

| Folder | Takes |
| --- | --- |
| `workforce/` | `teams/`, `org/`, `flows/workers/`, `blocks/`, `workforce.gen.ts` |
| `org/` | `workers/`, `references/`, `resources/`, `skills/`, `packages/`. No `TEAM.md`, no `blocks/`. |
| `teams/<team>/` | `TEAM.md`, `workers/`, `references/`, `resources/`, `skills/`, `packages/`, `blocks/` |
| `teams/<team>/workers/<worker>/` | `WORKER.md`, `references/`, `resources/`, `skills/`, `packages/`, `blocks/` |
| `org/workers/<worker>/` | `WORKER.md`, `references/`, `resources/`, `skills/`, `packages/`. No `blocks/`. |

Derived from `wff:48-59`; **[run]** for the two refused. [table]

- A file under `workers/` (not a folder) occupies no worker slot: the worker reader skips it, and under the kit it is refused as an unused file. `rw:238-245`, **[run]** (`teams/core/workers/README.md`). [lookup]
- A worker folder without a `WORKER.md` stops the app: `Worker folder "<name>" has no WORKER.md. A worker folder describes a worker, and every worker is a WORKER.md. ...`. `rwd:236-246`. **[run]**. A worker folder's documents and skills still load; the missing file is reported once. `dd:115`. [lookup]
- A `README.md` or any other file inside a worker folder is refused at startup. **[run]** (`teams/core/workers/lead/README.md`). [lookup]
- The id of a worker is the team folder and the worker folder joined with a dot (`support.lead`); an org worker's is its folder name. A team worker's id always has a dot, so `shift-coordinator` and `eng.shift-coordinator` are two workers. `rwd:372-376`, `wd:148-150`. [table; the file's settings and the id's use are R-28]
- A worker flow shared by name: each flow a worker names is one registered copy for every worker that names it. `wd:275-279`. [cut here: R-25]

## 3. Names

One rule, applied to every name the tree reads. [table]

| Rule | Detail | Source |
| --- | --- | --- |
| Characters | Lowercase letters and digits, in runs joined by single hyphens. No leading or trailing hyphen. No `.`, `_`, space or uppercase. | `sn:21` (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`), `skm` (same pattern) |
| Length | At most 64 characters. | `sn:24`, `skm:40` |
| Reserved | `_meta`. | `sn:27`, `skm:46` |
| Windows device names | `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`. `com0` and `lpt0` are allowed. Refused though they match the pattern, and on a file whatever its extension. | `wrn:9-22` |

- Checked in this order: too long, reserved, pattern, device name. `sn:46-54`. A name that fails two shows the first. [lookup]
- What is a name: a team folder, a worker folder, a document file without `.md`, a skill folder, a package folder, a worker-flow file without its extension, a block file without its extension, and (through the same helper) a kit's own name and a capability or resource module's file name without its extension. `seg:37-43`, `sn:1-10`, `drm:211-216` (module name minted as a document ref's last segment), `wff` readers. [table]
- Why a dot is not allowed: `.` joins a team and a worker into an id, so a dotted name cannot be split back. `sn:16-20`. State as "no dots", without the reason. [cut: the reason]
- `blocks/types.d.ts` is refused by `fsdev gen` as a block named `types.d`; `Foo.ts` as `Foo`; `x.test.ts` as `x.test`. **[run]**. [lookup]
- `a.ts` beside `a.tsx` in one code folder: refused by `fsdev gen` as two files declaring one name. `disc:270-282`, `dwb:168-175`. **[run]** (`blocks/y.tsx` and `blocks/y.ts`). [lookup]
- The check is by the name alone, at the moment a reader needs it. A team folder that holds only a `TEAM.md` is not checked (flag 5). **[run]**. [lookup, one line]

### Which folder names are refused? [lookup]

Observed messages, each from a tree that held that name; `<what>` is `Team folder`, `Worker folder`, `Document file`, `Worker flow file`, `Block file` or `Package folder` (`seg:37-53`):

| Name | Message (start) | Source |
| --- | --- | --- |
| `Core`, `a_b`, `a--b`, `-a`, `x.y` | `<what> name "<name>" must be lowercase letters, digits, and single hyphens (not at the start or end) — it becomes <where it is used>` | `seg:64-78` **[run]** |
| 65 or more characters | `<what> name "<name>" exceeds 64 characters` | `seg:58-60` **[run]** |
| `_meta` | `<what> name "_meta" is reserved` | `seg:61-63` **[run]** |
| `con`, `com1` | `<what> name "con" is a reserved device name on Windows — a tree containing it cannot be checked out there, whatever the extension` | `seg:83-88` **[run]** |

The `<where it is used>` clause by kind: team or worker: `part of the worker's identity, which is joined with a "."`; document: `part of the document's ref, which is joined with a "/"`; worker flow: `the worker flow's name, which a worker file's `flow:` names`; block: `the name the block registers under, which a task board assigns by`; package: `the name a worker's `packages:` takes the package by`. `seg:65-74`. [lookup]

Skill folders say it in their own words: `Skill name "Bad_Name" must be lowercase letters, digits, and single hyphens (not at the start or end)`, `Skill name "con" is a reserved device name on Windows`, `exceeds 64 chars`, `is reserved`; and a skill's `name:` must equal its folder: ``SKILL.md `name: b` must match its folder "a"``. `skm:123-146`, `skm:216`. **[run]**. [lookup]

Where a refusal shows: a bad team, worker, document, reference, skill or package name stops the app (`- worker teams/Core/workers/lead: ...`); a bad flow or block file name does not stop the app and is refused by `fsdev gen`. `fsdev gen` also reports the team, worker and package names it meets: `disc:264-266`, `dwb:305-317`, `dpb:154-157`. **[run]**.

## 4. Documents: `references/` and `resources/`

- A document is a file `<name>.md` directly in `references/` or `resources/`. A directory there is reported: ``"<name>" is a directory. A resource is a file, not a folder — write the document as "<name>.md" in this references/ folder instead.`` `rrd:283-296`. **[run]**. [lookup]
- A file that does not end in `.md` in a `references/` or `resources/` folder is not a document. In `resources/` a `.ts` or `.tsx` is a capability or resource module (section 6). Any other file there (`notes.txt`, `.md`-less names) is refused at startup as unused. `rrd:313-324`, `wff:54-55`. **[run]**. In `references/` a `.ts` is refused at startup too (`wff:55`).
- A document file starts with frontmatter; `description` is required and non-empty. No frontmatter, or no `description`: ``"<file>" has no frontmatter — a resource file needs at least a `description` `` / `"<file>" must declare a non-empty `description` ``. `rrd:370-388`, `dd:78-80`. [table]
- Everything else in the frontmatter passes through to the resource as written. `rfd:95-108`, `dd:90`. Frontmatter never reaches a model; the body does. `dd:80`, `rfr:84-93`. [table]
- Keys a `resources/` file may not declare, each refused by name: `scope`, `ref`, `stateSchema`, `default`, `content`, `contentFile`, `contentTemplate`, `contentTemplateRef`. `prefetchMode: lazy` is refused; `prefetchMode: eager` is accepted. `man:616-668`, `dd:86-88`. **[run]** (`scope`, `prefetchMode: lazy`). Message: ``"a.md" declares `scope:`, which is a setting the convention derives from where the file sits, not one a resource declares. Drop it, or declare this resource in code with defineResource() instead.`` [table]
- A `references/` file may not declare those, nor `writable`, `llmWritable`, `render` or `flowIsolation`, whatever the value (`writable: false` included). `man:719-753`, `dd:92`. **[run]** (`writable`). Message ends ``Drop the key, or move this document to `resources/`, where it seeds a resource and can be written.`` [table]
- `llmReadable`, `llmWritable`, `writable`, `allowedExtensions`, `metadata` and `flowIsolation` in a `resources/` file take effect (pass through). `llmReadable` in a `references/` file is accepted. `dd:90`. **[run]** (`flowIsolation` and `llmReadable` together were not refused). [table]
- The ref a document gets, from where its file sits. `rc:100-152`, `dd:98-103`, `pts:480-545`, `pts:604-617`. **[run]**: [table]

| File | Ref |
| --- | --- |
| `org/resources/<name>.md` or `org/references/<name>.md` | `<name>` |
| `teams/<team>/resources/<name>.md` | `teams/<team>/<name>` |
| `org/workers/<worker>/resources/<name>.md` | `workers/<worker>/<name>` |
| `teams/<team>/workers/<worker>/resources/<name>.md` | `teams/<team>/workers/<worker>/<name>` |

  The ref is the accessor a block reads on `ctx.resources`: `ctx.resources["teams/engineering/handbook"]`. `rfd:45`, `dd:107-111`. A `.ts` module in `resources/` gets the same ref as a document of that name. `rc:110`, `drm:211-216`.
- A `references/` file and a `resources/` file at one level mint one ref: refused at startup, both paths named. The message: `"<path>" and "<path>" both claim the ref "<ref>". A references/ file and a resources/ file at one level are two spellings of one document, and they do not behave the same — a reference is read from its file and nothing can write it, while a resource seeds stored state that then becomes the source. Keep one.` `rdr:199-227`, `rc:19-25`. **[run]**. A team's `references/` file and a worker's `references/` file of one name do not clash: the refs differ. `rc:135-152`. [lookup]
- A `.ts` or `.tsx` in `resources/` and a `.md` of the same name in that `resources/` folder or in the `references/` folder beside it: refused by `fsdev gen` as `"<path>" and "<path>" both declare "<ref>" — a document and a module cannot share a ref`. Two modules of one ref: `... both declare "<ref>" — one ref, one module`. `drm:155-175`, `drm:236-252`. **[run]**. Not refused at startup. [lookup]
- **Who reaches a reference** (the wall). A worker reaches the references of its organization, its team and its own folder, and no others. An org worker reaches the org's and its own. `wr:1-37`, `wr:101-148`, `dd:277-279`, `dd:294`. [table]

| A reference in | Reached by |
| --- | --- |
| `org/references/` | every worker |
| `teams/<team>/references/` | every worker on that team |
| `teams/<team>/workers/<worker>/references/` | that worker |
| `org/workers/<worker>/references/` | that org worker |

  An unreachable reference is not an empty read: its accessor is absent and `ctx.resources.get("teams/support/escalation")` throws `is not registered`. `dd:279`. There is no setting to widen it: move the file up the tree. `wr:35-37`, `dd:279`. A worker's `references:` line narrows within the wall and never widens: naming one outside refuses the hire (R-28). `wr:16-26`, `dd:281-292`, `wd:82`. [table, one line each]
- `resources/` is different: the folder is part of the name only. Every document there is the organization's, and a flow that installs them reaches all of them unless the app filters or a worker's `resources:` line narrows. `dd:277`, `dd:304-306`, `wd:144`. [table]
- A `resources/` document installed at org scope, one stored body per organization once written; `flowIsolation: true` in the file gives one per organization per worker flow; workers on the same flow share it (`flowIsolation` keys by `flow.id`, `packages/engine/src/stores/scope-keys.ts:430-432`; one flow copy per worker flow, `packages/workforce/src/workers/register.ts:99-100`). `rfd:75-80`, `dd:255`, `dd:310`. [stored-data table below]
- Every file-declared document is org-scoped; a user- or session-scoped one stays in TypeScript. `rfd:47-50`, `rfd:78`, `dd:384`. [table, one line]
- The body of a reference is read from the file each time an execution context is built (once per request), so an edit to an existing reference's body reaches the next request, and a read already in flight keeps the body it started with. `rfr:12-13`, `rfr:52-56`, `rr:567-590`, `dd:253`, `dd:393`. A new reference file, or a changed frontmatter setting, needs a restart. [verify the frontmatter part: the settings are applied when the resource is built at start] [table: reload]
- A reference whose file is removed or becomes unreadable while the app runs fails the request that needs it: ``Failed to load contentFile for resource "<ref>" (path: <file>): <cause>``. `rr:578-590`. [verify: read from code, not run]
- A stored body wins over the file: for a `resources/` document that anything has written, a later edit to the file changes nothing, and moving the file to `references/` does not clear the stored body (`clearShadowedReferences` does). `rr:567-575`, `dd:253`, `dd:275`, `dd:344-346`. [lookup, one line]
- `resources/` documents the model can read need `llmReadable: true` in the file and `readResourceContentTool()` on the generator; a reference is read-only to code (`writeContent()` throws `resource_read_only`) and the write tool is never offered. `dd:321-340`, `rfr:27-34`. [cut: R-31 / R-25; one clause at most]

### Stored data: documents

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A `references/` file | The app: the file in the repository. | Workers whose place reaches it (table above); the worker's `references:` narrows. `wr:1-37`. | Not stored. The file is read whenever an execution context is built. `rfr:12-13`, `rfr:173-183`. | One per file. No per-user or per-organization copy. |
| A `resources/` document | The organization. The file is the starting text; once something writes the document, the stored body is the source. `rfd:75-80`, `rr:567-575`, `dd:253`. | Every worker on a flow that installs it, unless the app filters or the worker's `resources:` narrows. `dd:277`, `dd:304-306`. | The app's org-scope store. `dd:255`. | One stored body per organization. With `flowIsolation: true`, one per organization per worker flow, shared by that flow's workers. `dd:255`, `dd:310`. |

## 5. TEAM.md

- `teams/<team>/TEAM.md` is optional, one per team, none at org level. A `TEAM.md` at `org/` or at the root is refused at startup (`"org/TEAM.md" is not used by anything ...`). `wff:52`, `rtd:1-8`. **[run]**. There is no org-wide instruction layer. `wd:265`. [table]
- `description` is required and non-empty. `name` is optional (a non-empty string) and is the team's display name; each of the team's workers carries it as `teamName`. `rtd:215-237`, `wd:108-111`, `man:285-300`. [table]
- Refused keys: `id` (the folder's name), `flow` (a worker's key), `instructions` (the body is the instructions), `teamInstructions`. Messages: ``TEAM.md in "five/" declares `id:`, which is not a setting a team declares. A team's id is its folder's name.`` etc. `man:261-335`. **[run]** (all four). Missing `description`: ``TEAM.md in "three/" must declare a non-empty `description` ``. `rtd:233-236`. [table]
- A directory named `TEAM.md` is refused: ``"TEAM.md" is a directory. A team file is a file, not a folder ...`` `rtd:148-160`. [lookup]
- Other frontmatter is carried on the team record as written. `rtd:185-195`, `wd:112-115`. [cut: R-25]
- The body is the team's instructions, told to every worker on the team and to no worker on another team. A body that is empty or only whitespace counts as none. `rtd:185-196`, `wd:117-140`. On the built-in `agent` flow the prompt order is: worker identity, then team instructions, then the worker's own instructions, then the instructions of held packages. `wfs/agent-worker-flow.ts:1190-1195`. A worker flow of the app's own decides for itself. [table: "where a brief the whole team shares goes"]
- Material a worker looks up rather than is told on every turn goes in `references/`. `dd:17` (choose by who edits), `wd:117`. [one line]
- A broken `TEAM.md` stops the app (the kit's reader throws on any problem): `- team teams/<team>/TEAM.md: ...`. **[run]**. [lookup]

### Stored data: TEAM.md and workers

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A `WORKER.md` | The app: the file. | Every user of every organization in the app. A user's edit saves that user's own copy under the same id; the file is untouched. `sw:1-12`, `wfs/workers/hire-blocks.ts:81-90`. | Not stored. Read from the loaded files; a deploy that changes a file changes the worker for everyone who has not edited it. `sw:1-12`. | One per file. |
| `TEAM.md` | The app. | The workers of that team only. `wd:139-140`. | Not stored: it rides each team worker's configuration. | At most one per team. |

## 6. Code: what `fsdev gen` reads and writes

- `fsdev gen` runs the generator that one of the app's dependencies exports on `./fsdev-gen`, reads the folder (default `workforce`, or `--root <dir>`), and writes `workforce/workforce.gen.ts`. `gen:1-20`, `gen:97-185`, `fg:68-73`, `wfs/../package.json:53-56`. Flags, output and exit codes are R-35. [table, short]
- The generator contract: a package whose `package.json` exports `./fsdev-gen`, with an export `generator` that has `defaultRoot: string` and `generate(root: string)` (root absolute) returning `{ file, content, searched, entries, paths, summary }` (`file` relative to the root). `generate` must not write. A refusal of what the root holds is an error carrying a `problems: string[]`; the command exits 1 on it, and any other throw exits 3. `gen:32-60`, `gen:130-140`, `gen:143-147`, `gen:205-211`. [table]
- The command looks in the `dependencies` and `devDependencies` of the nearest `package.json`; none exporting `./fsdev-gen` is `No dependency in <package.json> exports a generator on "./fsdev-gen".`; more than one is `More than one dependency exports a generator: a, b.`; one without a `generator` that has both fields is `<name>/fsdev-gen does not export a `generator` with `defaultRoot` and `generate`.` (exit 3). `gen:97-140`. [lookup; the exit codes are R-35]
- It loads no app code: it reads the folder's shape and never opens a discovered file. `gen:11-14`, `disc:4-11`. A symlinked generated file is refused. `gen:170-174`. [table, one line]
- What it looks in: `flows/workers`, `blocks`, and the patterns `org/resources`, `org/workers/*/resources`, `teams/*/resources`, `teams/*/workers/*/resources`, `teams/*/blocks`, `teams/*/workers/*/blocks`, `org/packages/*/blocks`, `org/workers/*/packages/*/blocks`, `teams/*/packages/*/blocks`, `teams/*/workers/*/packages/*/blocks`. **[run]** (the `Looked in:` list); `disc:297-312`, `rw:56-75`, `dwb:63-66`, `dpb:42-47`. [table]
- Refusals are collected and thrown together, and nothing is written when any exists: `Refused <n> entr(y|ies) under the workforce code folders; nothing was generated:` then one `  - <problem>` line each. `disc:125-145`, `disc:320-321`. **[run]**. [lookup]
- Code folders hold one file per declaration, one level deep. A directory inside `flows/workers/` or any `blocks/` folder is refused by name: ``"flows/workers/sub" is a directory — a locked folder holds one file per worker flow, one level deep. Nesting would make the basename ambiguous`` / ``"<path>" is a directory — a blocks/ folder holds one file per block, one level deep ...``. A resource module directory: ``... is a directory — a resource module is a file, one level deep in a resources/ folder``. `disc:247-253`, `dwb:138-146`, `drm:218-224`. **[run]**. The kit refuses the same directory at startup. [lookup]
- A file that is not a `.ts` or `.tsx` in a code folder is skipped by `fsdev gen` and refused by the kit (flag 1). `disc:257-260`, `tsm:12-18`. [lookup]
- A symlinked folder, file, worker folder or package folder in a code walk is refused (`... — refused for safety`). `disc:236-245`, `dwb:127-130`. [lookup, one line]
- Absent code folders are silent (an app may have no custom code of that kind); an unreadable one is refused. `disc:222-231`, `dwb:116-118`. [lookup]
- The file's name is its registered name: basename without extension. Hyphens stay in the key and become underscores in the generated import binding. `disc:284-289`, `rnd:80-95`. [cut: bindings are mechanism]
- What each code file default-exports: `flows/workers/`, a worker-flow entry (the docs form is a `workerFlow(...)` builder, which receives the installation; a flow or `{ flow, ... }` also fits the type); `blocks/` (any level, and a package's), a block; `resources/`, a capability or a resource. `cd:42-60`, `kit:153-156`, `rnd:42-50`, `rmod:20-52`. [table]
- The file's value is not read by the walk. A file that exports the wrong shape fails the app's own typecheck against `workforce.gen.ts`, naming the file; a worker flow whose declared `kind` disagrees with the file's basename is refused at the hire, naming both. `rnd:35-50`, `cd:156`. [lookup]
- A block's file basename, the map key and the block's own `name` must agree, or the hire refuses: ``This worker's own folder registers "fetch", and the block under that key calls itself "other". One tool has one name: the file's, the map key's and the block's own must agree. ...`` A block in a worker's own folder may read a store a flow declares and may not declare one. `wfs/hire.ts:528-538`, `cd:202-203`, `pk:32`. **[run]** (name mismatch). [lookup]
- A package's block that shares a name with a block in the holding worker's own or team `blocks/`, or with a block in another package it holds, is refused at the hire, naming both sources. `wp:194-227`, `pk:113`. [lookup]
- Registering a name is not granting it: a worker calls a block only when its `tools:` line names it, or, with no `tools:` line, through a preset or package it holds. `cd:160`, `bw:47-49`. [one line]

### The tool name lookup

- A name in a worker's `tools:` is looked up nearest first: the worker's own `blocks/`, then its team's `blocks/`, then the catalog (`workforce/blocks/`, given to the built-in `agent` flow). The first match wins; the nearer shadows the farther of one name and the farther is not also registered. `dwb:320-332`, `cd:162-173`, `bw:45`. **[run]** (a team `shared.ts` and a worker `shared.ts` registered once, as the worker's). [table]
- An org worker has no `blocks/` folder; its tools come from the catalog and from packages it holds. `dwb:255-262`, `cd:171`, `bw:45`. [table]
- A `tools:` name nothing registers refuses the app at the hire: `hireWorkforce: 1 standard worker problem(s); nothing was registered:` then ``- worker "core.lead" — Flow "agent" instance "core.lead" has an invalid config bag: "tools": names tool "nope", which nothing registers for this worker — neither its own `blocks/` folder nor the app's tool catalog. Known catalog tools: ... Put the block in this worker's own `blocks/` folder and re-run `fsdev gen`, pass it as `defineAgentWorkerFlow({ catalog: ... })`, or drop it from this worker.`` **[run]**. The message does not mention the team folder; the lookup does include it. [lookup; R-28 owns the refusal list]

### What `workforce.gen.ts` holds

- The file is committed. Its header says `Generated by `fsdev gen`. Do not edit.` The text is a pure function of the tree, ordered by path, so an unchanged tree rewrites the same bytes. `rnd:1-30`, `rnd:301-369`. **[run]**. [table]
- It exports five maps; an empty one is `export const <name> = {};`. `rnd:149-160`, `rnd:196-222`, `rnd:262-286`, `rnd:301-369`. **[run]**. [table]

| Export | Holds | Where the kit puts it |
| --- | --- | --- |
| `workerFlows` | One entry per file in `flows/workers/`, keyed by file name. | The worker flows the kit serves. A key also in the kit's `workerFlows` slot is refused. `kit:62-63`, `kit:199-206` |
| `blocks` | One per file in `blocks/`. | The built-in `agent` flow's tool catalog, when the kit's `agent` config gives none. `kit:64-65`, `kit:233-241` |
| `resourceModules` | One per `.ts` or `.tsx` in a `resources/` folder, keyed by ref. | Capabilities go to the `uses` of the `agent` and `coordinator` flows the kit builds; resources join the folder's documents. `kit:66-71`, `kit:221-231`, `kit:262` |
| `workerBlocks` | Per team worker id, the blocks from its own `blocks/` and its team's. | The blocks a worker's `tools:` may name. `kit:72-73`, `kit:260` |
| `packageBlocks` | Per package address (`teams/<team>/packages/<name>`), its `blocks/` files. | The tools of packages a worker holds. Leave it out and a held package brings instructions and no tools. `kit:74-75`, `kit:261`, `pk:90` |

  `rnd:196-286` (`workerBlocks`, `packageBlocks` shapes); `rnd:196-286`.
- The app hands the module to the kit whole: `workforce({ generated })` where `generated` is `import * as generated from "./workforce/workforce.gen"`. The kit takes only those five keys; a misspelled one is refused when the kit is constructed: `kit "workforce": its config is invalid: generated: Unrecognized key(s) in object: 'workerFlow'`. `kit:97-98`, `kit:120-134`, `kt:197-201`. **[run]**. [table]
- `workerBlocks` is keyed by team worker ids only; an org worker has no entry. `dwb:255-262`, `rnd:196-222`. **[run]**. [table, one clause]
- A worker flow in the generated module and in the kit's `workerFlows` slot under one name is refused: ``workforce: the generated module and `workerFlows` both hold "<name>". Keep one.`` One named `agent` or `coordinator` replaces the kit's own, and the kit's own `agent` config together with one named `agent` is refused. `kit:199-220`. [R-25 owns the flows; one clause here]
- Commit the file. `fsdev gen --check` writes nothing and exits non-zero when the file and the tree disagree; give it its own CI step, not a place in the build script. `cd:127-139`, `gen:196`, `gen:216-232`. [cut here: R-35]
- Nothing regenerates while the app runs. `cd:18`, `dw:164-172`. [reload table]
- Under the kit, capabilities reach the agent and coordinator flows the kit builds; the app's own worker flows listed in `generated.workerFlows` get none from the file. `kit:224-231`, `kit:241`, `kit:252`. [lookup, one line] [verify against an app-owned flow: read from code]

## 7. Capabilities

- A `.ts` or `.tsx` file in a `resources/` folder is code: a capability (`defineCapability`) or a resource (`defineResource`), default-exported. `cp:10`, `cp:43`, `rmod:20-52`. [table]
- Its ref, in `resourceModules`, is the ref a document of that name in that folder would get: the bare `<name>` at org level, `teams/<team>/<name>` in a team, `workers/<worker>/<name>` and `teams/<team>/workers/<worker>/<name>` in a worker's own folder. `cp:49-60`, `drm:211-216`, `rc:100-152`. **[run]**: `c2`, `teams/core/x`, `workers/boss/r`, `teams/core/workers/lead/cap` all registered. [table]
- A capability lives at org level or in a team. In one worker's own `resources/` folder it is typed as a resource only, so the app's typecheck rejects a capability there, naming the file. Neither `fsdev gen` nor startup refuses it. `rmod:36-52`, `rnd:62-76`, `rnd:135-160`, `rms:38-52` (`@ts-expect-error a capability may not sit in one worker's own resources/ folder`). **[run]**: gen registered `teams/core/workers/lead/cap` without a refusal. A resource (not a capability) in a worker's folder is fine. `cp:45`. [table]
- A module whose default export is neither fails the same typecheck; if it reaches the kit anyway the app refuses to start: `Resource module "<ref>" exports <value>, not a capability or a resource — a TypeScript file in a resources/ folder default-exports one or the other`. `rmod:34-58`, `wfs/split-resource-modules.ts:93-103`. [lookup]
- A `.md` and a `.ts` of one name at one level: refused by `fsdev gen` (section 4). [lookup]
- With the kit, capabilities go to the built-in `agent` and `coordinator` flows (`uses`); resources join the documents. Nothing is written in the app. `kit:221-231`, `kt:177-195`. [table]
- A capability reaches every worker on the flow; each worker's `capabilities:` line picks presets (R-28). `cp:100-112`. [cut: R-28]
- Goal evidence: two workers of one type, one naming a preset and one naming nothing, answer differently because of a capability file. `goals/workforce-conventions/capabilities-come-from-files-alone/goal.md`. [cut: proof, not cited]

### Stored data: code

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A worker flow file | The app. | Every worker whose `flow:` names it. `wd:275-277`. | Not stored: a static import in `workforce.gen.ts`. `cd:16`. | One registered copy, shared by every worker on it. `wd:275-277`. |
| A block file | The app. | `workforce/blocks/`: every worker; `teams/<team>/blocks/`: every worker on the team; a worker's own: that worker. A worker calls it only if its `tools:` names it. `cd:162-168`. | Not stored. | One per file. |
| A capability or resource module | The app. | Every worker on the flows the kit installs it on. `cp:100-112`, `kit:224-231`. | Not stored: a static import. | One per file. |
| `workforce.gen.ts` | The app: written by the command, committed. `cd:129`. | The kit, as `generated`. | In the repository. | One. |

## 8. Packages

- A package is a folder under a `packages/` folder: a required `PACKAGE.md` and an optional `blocks/` folder. `rpd:1-12`, `pk:10`. [table]
- The one frontmatter key is `description`, required and non-empty; every other key is refused and named; the body is the instructions, absent when empty or whitespace. `wfs/package-text.ts:43-66`, `pk:30`. Messages: ``PACKAGE.md in "teams/core/packages/extra/" declares `foo:`. A PACKAGE.md declares `description` and nothing else: ...`` **[run]**. [table]
- A package folder may not hold `resources/`, `references/`, `skills/` or `packages/`: ``"<path>" is a resources/ folder inside a package. A package holds a PACKAGE.md and a `blocks/` folder of tools, nothing else of the convention's ...`` `rpd:53`, `rpd:255-266`. **[run]**. A symlink inside is refused. Any other file (a `README.md`, `blocks/b.md`, `blocks/sub/`) is refused at startup as unused. **[run]**. [lookup]
- A package folder with no `PACKAGE.md`: ``Package folder "<path>" has no PACKAGE.md. A folder under `packages/` is a package, and every package is a PACKAGE.md with a `description`.`` A file directly in `packages/`: ``"<path>" is a file. A package is a folder — `packages/<name>/PACKAGE.md`, with its tools beside it in `packages/<name>/blocks/`.`` `rpd:204-214`, `rpd:276-284`. **[run]**. A package with any refusal is left out whole. `rpd:22-23`. [lookup]
- **Who holds a package, by where it sits.** `pk:40-44`, `wp:1-8`, `wp:104-142`: [table]

| Folder | Held by |
| --- | --- |
| `teams/<team>/workers/<worker>/packages/<name>/` or `org/workers/<worker>/packages/<name>/` | That worker, always, with no line in its file. |
| `teams/<team>/packages/<name>/` | A worker on that team, once its `packages:` line names it. |
| `org/packages/<name>/` | Any worker, once its `packages:` line names it. |

- A worker's `packages:` names library packages only: looked up in its team's library first, then the org's. An org worker has no team library. A package no worker names reaches nobody. A worker cannot name another team's library or another worker's folder. `wp:104-142`, `pk:55`, `pk:57`. **[run]**: a worker `lead` naming `p` held the team's `p` over the org's `p` (started); an org worker naming a team-only `p` was refused. [table]
- The package's own address is its folder path under `workforce/`, e.g. `teams/support/packages/escalation`; that is the key in `packageBlocks`. `man:225-232`, `rpd:2-12`, `dpb:11-18`. **[run]** (`teams/core/packages/p: pb`). [table]
- Refusals at the hire, each naming the worker (every problem listed together): `packages:` not a list of strings; a name no library in reach offers (``Looked in "teams/core/packages/nope" and "org/packages/nope".``; an org worker is told only `"org/packages/<name>"`); a name that both the worker's own folder and a library offer (``One name is one package — rename one of them.``); a worker whose own package failed to load while its blocks generated. `wp:108-141`, `wp:158-176`, `pk:108-115`. **[run]** (unknown name, own-and-library, org worker). [lookup]
- Run `fsdev gen` after adding or removing a package's block. An edit to `PACKAGE.md` needs a restart and nothing more. `pk:36`, `pk:145`. [reload table]
- A package's tools reach only workers that hold it; they are not in the app's catalog. `pk:69`. A worker's `tools:` line governs which of a held package's blocks it may call: no line, every block of every package it holds; a line, exactly that list; `tools: []`, none (the instructions still arrive). `pk:61-65`. [R-28 owns `tools:`; one line]
- A package's instructions reach the worker on every turn, after its team's and its own on the built-in `agent` flow. `pk:30`, `wfs/agent-worker-flow.ts:1190-1195`. [table, one line]
- `description` is for people and never reaches the model. `pk:30`. [one clause]

### Stored data: packages

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A package folder | The app. | The worker whose folder it is, the workers of a team that name it (team library), the workers anywhere that name it (org library). `pk:40-57`. | Not stored: the text is read at startup; the blocks are found by `fsdev gen`. `pk:145`. | One per folder; held by as many workers as hold it. |

## 9. Skills (the folder half)

- `skills/<name>/SKILL.md` sits at three levels. A team worker holds all three: the org's `org/skills/`, its team's `teams/<team>/skills/`, and its own `skills/`. An org worker holds two: `org/skills/` and its own. `rws:138-146`, `rws:224-227`, `bw:130-153`, `wd:188`. [table]

| Skills folder | Held by |
| --- | --- |
| `org/skills/` | every worker |
| `teams/<team>/skills/` | every worker on that team |
| `teams/<team>/workers/<worker>/skills/` or `org/workers/<worker>/skills/` | that worker |

- The same skill name reaching one worker from two levels refuses the app, and the name is left out for that worker: ``Skill "review" reaches worker "lead" from 2 levels — org/skills/review and teams/core/skills/review. Remove one: there is no precedence rule.`` `man:391-397`, `rws:259-271`. **[run]**. Two teams may each have `review`; neither worker holds the other's. `rws:5-12`. [lookup]
- A `SKILL.md` that declares `scope:` is refused (`SKILL.md in "org/skills/sc/" declares `scope:`, which is not a setting a skill declares. Where a skill folder sits is what decides who can see it.`). A skill folder with no `SKILL.md`: `Missing SKILL.md in "nofile/"`. **[run]**; `man:371-380`, `rws:330-343`. The other keys are R-30. [lookup]
- A worker keeps its own copy of a skill per user from the moment it first reads it; later edits to the folder do not reach a worker already running with it. `bw:128`, `bw:187`. [stored-data row below; the copy mechanics are R-30 / R-25]

### Stored data: skills

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A `SKILL.md` folder | The app's folder seeds it; the worker then holds a copy for each user it runs for. `bw:128`, `bw:187`. | The worker and the user it runs for. `bw:128` ("two people never share one worker's copy"). | The user's scope, once the worker first reads it. `bw:187`. | One per worker per user. |

## 10. When a change takes effect

| Edit | Takes effect |
| --- | --- |
| The body of an existing `references/` document | The next request. A read already in flight keeps the body it started with. `rfr:12-13`, `rfr:52-56`, `rr:567-590`, `dd:253`, `dd:393`. |
| Any other edit to a `WORKER.md`, `TEAM.md`, `resources/` document, `PACKAGE.md`, skill, or the frontmatter of a reference; a new or removed file of any of those | After a restart. The folder is read once, at startup. `dk:136-143`, `wd:956`, `dd:388`, `pk:145`. |
| A `resources/` document that has been written | The stored body is the source; an edit to the file does not change it. `rr:567-575`, `dd:253`, `dd:344`. |
| A code file (flow, block, capability, package block): added, renamed, removed | Run `fsdev gen`, then restart. Nothing regenerates while the app runs. `cd:18`, `cd:129`. |
| Under `fsdev dev --watch` (loopback host only) | A save to any file under the config file's folder restarts the dev server, except dot entries, `node_modules`, database files and the app's pages; a new file there asks for a restart too. Plain `fsdev dev` does not. `dw:164-172`, `dw:164-230`, `packages/fsdev/src/commands/dev.ts:133`, `dev.ts:179-182`. [verify: read from code, not run] |

- Nothing watches the folder. `dd:388`, `wd:956`, `cp:167`. [one row above]
- A user's edit of a standard worker in the running app applies from the next turn and leaves the file alone. `reference/worker-md.md:168-169` (existing page), `sw:1-12`. [R-28 owns; link]
- `fsdev gen --check` and CI: R-35.

## 11. The one example the page may use

- No tree in the repo holds every part. The page's `workforce/` listing is composed from `wff:48-59` and `pts`, and may reuse the shapes the catalog page already carries (`teams/support/...`). The nearest real tree is kitchen-sink's `support` team: `ks/workforce/teams/support/workers/{general,fsd,help,accounts,devices}/WORKER.md`, two blocks under `workers/fsd/blocks/` (`search-docs.ts`, `fetch.ts`), and `ks/workforce/workforce.gen.ts` beside the team folder. How the kit meets the generated module there: `import * as generated from "../workforce/workforce.gen"`, then `workforce({ directory, generated: { ...generated, workerFlows: ... }, ... })`. `ks/lib/workforce-kit.ts:10`, `:38`, `:49-61`. [lookup; cite as the real tree]
- The kit's own example: `createFlowState({ kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })], stores })`. `kit:171-176`. [table, install line]

## 12. Not on the page (the page links; each has its home)

- Every `WORKER.md` setting, the refusal list at hire, `tools:`, `packages:`, `references:`, `capabilities:` and the edit row: R-28, `reference/worker-md`.
- Every `SKILL.md` key and the worker's skill settings: R-30, `reference/skill-md`.
- The kit's engine rules (what a folder refusal says in general, symlinks, two kits on one folder): R-11, `reference/kits`.
- The flows the kit serves, roster states, the `coordinator` and `agent` options: R-25, `reference/workforce`.
- `fsdev gen` flags, output lines and exit codes, `--check` in CI: R-35, `reference/cli`.
- The by-hand startup (`readWorkforce`, `readResourcesDirectory`, `createWorkerInstallation`, `hireWorkforce`, `resourcesFromDocs`, `referencesFromDocs`, `splitResourceModules`) and their return shapes: `wd:162-305`, `dd:117-271`, `cp:64-96`, `pk:71-92`. [cut: the kit does this]
- `clearShadowedReferences` and moving a document from `resources/` to `references/`: `dd:342-379`. [cut, apart from the one-line note that a stored body wins over the file]
- Worker flows of your own (`workerConfigSchema`, `workerFlow`, `installation.session()`), per-worker data, `workerPackages` on a flow of your own: `wd:307-345`, `pk:126-139`. [cut]
- Preset tools and controls, upgrading from workforce 0.3: `cp:126-148`, `cp:173-175`. [cut]
- Generated import bindings and their ordering: `cd:105`, `rnd:80-130`. [cut]
- Any tracker id: `kit`, `keys.ts`, `read-*` headers and some goals carry them; none belongs on the page. [cut]

## Incoming rows: carried and dropped

Twenty rows were moved to R-29 by other pages' depth passes. Each was checked against the code above.

| # | Row (from) | Verdict | Where in this sheet |
| --- | --- | --- | --- |
| 1 | Folder read timing and the `TEAM.md` body as the shared brief (teammates) | Carried. Corrected: the body of an existing reference is read per request; `fsdev dev --watch` restarts on a save under the config's folder. The `TEAM.md` prompt order is stated for the built-in `agent` flow only. | sections 5, 10 |
| 2 | Kit option `directory`, default, read once; refusal for an unused file and what the error names (workforce index) | Carried. Refinement: the default reads against `createFlowState({ root })`, a given `directory` against the working directory; the error names the topmost unclaimed entry; when a load problem exists only the load problem is reported. R-11 owns the generic wording. Flag 11 (the catalog page links `directory` to R-25). | section 1, flags 7, 11 |
| 3 | `workforce.gen.ts` contents, passed as `generated`; startup refusal for an unregistered tool name (workforce index) | Carried. The refusal is raised at the hire inside `ready()`, not by the reader; the message is quoted. R-28 owns the refusal list; this page carries the lookup order and the message once. | section 6 |
| 4 | Naming rules incl. the Windows device name (corrected by pass 5; the-workforce-folder) | Carried and extended: order of checks, `_meta`, length, which names are covered, the two wordings, `.d.ts` and `.test.ts` names. | section 3 |
| 5 | Folders each level takes, and the refused `tools/` folder with the message that names `blocks/` (the-workforce-folder) | Carried, corrected: the `blocks/` message is `fsdev gen`'s. At startup a `tools/` folder is refused as unused, with the generic message. | sections 2, "What each level takes" |
| 6 | Name collision between `references/` and `resources/` (the-workforce-folder) | Carried, corrected: the refusal is at one level (one ref), by the loader, at startup. A `.ts` beside either is refused by `fsdev gen`, not at startup. | section 4 |
| 7 | Code-folder rule: every `.ts`/`.tsx` is a declaration; a second dot is refused by `fsdev gen` (the-workforce-folder) | Carried, extended: also `.d.ts`, uppercase, a `.ts` beside a `.tsx` of one name, and a directory (refused at both). `.mts`/`.cts` are claimed by the kit and not registered. | sections 3, 6, flags 2, 3 |
| 8 | Capability refs from path; a capability in a worker's own `resources/` is not refused by `fsdev gen` or startup, the typecheck rejects it (corrected by pass 5; the-workforce-folder) | Carried. Confirmed by running `fsdev gen` over a worker-level `.ts` and by `rms:38-52`. The four ref forms are in the table. | sections 4, 7 |
| 9 | Package holding rules: lookup order, unnamed packages reach nobody, no other team's library, rerun `fsdev gen` (the-workforce-folder) | Carried. Confirmed by running (team before org; an org worker cannot reach a team library). Added: hire refusals and the own-and-library clash. | section 8 |
| 10 | Which check catches a bad code-file name: `fsdev gen`, not startup (the-workforce-folder) | Carried with the exception that a bad name on a team, worker, document, skill or package folder stops the app. | sections 3, flag 2 |
| 11 | Reload table (the-workforce-folder) | Carried, corrected and extended: reference body per request; frontmatter and new files need a restart; a written `resources/` document ignores a file edit; `--watch` restarts. One part is read from code and marked [verify]. | section 10 |
| 12 | `teams/<team>/workers/<name>/WORKER.md` becomes a worker; `TEAM.md` becomes team-wide instructions (run-a-starter) | Carried. | sections 2, 5 |
| 13 | Skill folder levels and who reads each (skill-md) | Carried. Added the two-level refusal message and the `scope:` and missing-`SKILL.md` refusals. | section 9 |
| 14 | Naming rules table (worker-md) | Carried. Flag 10: `worker-md.md` still holds its own copy. | section 3, flag 10 |
| 15 | What is generated; the `tools:` lookup order worker `blocks/`, team, app catalog (worker-md) | Carried. Added the shadowing rule and the org-worker exception. Packages' blocks also resolve for a worker that holds the package. | section 6 |
| 16 | Paths the kit reads: what is ignored; which sibling folders are other layers (worker-md) | Carried, corrected. Under the kit only `.DS_Store` and `Thumbs.db` are ignored. The reader's "passed over in silence" list (`wd:259-267`, `rwd:12-17`) is not carried: it is true only of the reader called by hand. Other layers (skills, packages, documents, `TEAM.md`) are read by their own readers; the table lists each. | flag 1, section 2 |
| 17 | Folder-root rules: unreadable or symlinked root throws; an empty root returns no workers and no errors (worker-md) | Carried, corrected. Under the kit a missing, unreadable or symlinked folder stops the app. "Returns no workers and no errors" is `readWorkforce`'s answer; with the kit an empty folder starts the app with `agent` and `workforce-roster`. | section 1 |
| 18 | Generated-module rows: the output, the generator contract, what is generated; CLI keeps flags, output, exit codes (cli) | Carried. The contract is quoted from `gen:32-60`. | section 6 |
| 19 | Folder paths `teams/<name>/`, `TEAM.md`, `org/workers/<name>/` and what each becomes (glossary) | Carried. | sections 2, 5 |
| 20 | Package folder rules and who holds a package by where it sits (glossary) | Carried. | section 8 |

Also related, not a row to this page by the grep but pointed here: kits-and-slots states that "the per-path rules sit on R-29" (`R-11` row, corrected by pass 5). Carried as section 2. The "Dropped" items, all named: the reader's silent pass-over list and `cd:152` (flag 1); `wd:271-273` "nobody can edit it" (flag 9); `pk:96`'s "the package is missing from that worker" (flag 8).

## Questions for the cold read (candidate edge cases, from the sheet)

- A file `teams/core/tools/x.ts` is in the folder: what happens at startup, and what does `fsdev gen` say? (Startup: refused as unused, `teams/core/tools` named. Gen: ``"teams/core/tools" is a tools/ folder ... put the file in a `blocks/` folder``.)
- `blocks/search-docs.test.ts` is next to `blocks/search-docs.ts`: does the app start, and what refuses it? (It starts; `fsdev gen` refuses the name `search-docs.test`.)
- `references/handbook.md` and `resources/handbook.md` in one team: what happens? (The app does not start; both paths named.)
- A worker's own `resources/` holds a `.ts` capability: who refuses it? (Neither `fsdev gen` nor startup; the app's typecheck on `workforce.gen.ts`.)
- A team has `skills/review/` and `org/skills/review/` exists: what happens to a worker on that team? (The app does not start; the message says there is no precedence rule.)
- You edit the body of `teams/support/references/handbook.md` while the app runs: when does it apply? (The next request.) And `teams/support/TEAM.md`? (After a restart.)

## Revise round 1 notes

- Startup registration of standard workers is called "startup, when the kit registers the workers", not "the hire", on this page. `hireWorkforce:` is the prefix its errors carry (`wfs/hire.ts`). The `kind`-versus-file-name refusal, the block name-agreement refusal, the unknown `tools:` name and the `packages:` refusals are all raised there and stop the app.
- The empty-tree `workforce.gen.ts` is shown on the page as five `export const <name> = {};` lines (section 6, `rnd:149-160`), so the `fsdev.config.ts` example's import resolves.
- `fsdev gen` does not import or run discovered files (`gen:11-14`, `disc:4-11`); a wrong export shape therefore shows in the app's typecheck (section 6).
- Name refusals by `fsdev gen`, as worded on the page: `types.d.ts` (name `types.d`, a dot), `Foo.ts` (capital), `search-docs.test.ts` (name `search-docs.test`, a dot), a `.ts` and `.tsx` of one name (one name declared twice).
- The page no longer says a block's name is "assigned by a task board" and no longer carries the design sentence in the opening. Section 1's "Nothing to wire" is kept.
- Pass 6 findings 11-21 (move paragraphs to R-25, R-35, R-08, R-10, R-16, R-30) were declined: this is the Reference page for the folder, and its job is this detail ("Reference holds the detail", user-docs.md).

## Revise round 2 notes

- A standard worker is one a `WORKER.md` declares (`wfs/workers/standard-workers.ts:1-12`). Defined once in the opening.
- Under the kit, documents are installed on the built-in `agent` flow (`wfs/agent-worker-flow.ts:1406`, `installation.documents`); the kit has no filter option. "The app filters" is the by-hand `createWorkerInstallation` path (`dd`), so the page says a worker flow of your own chooses what it installs. Worker narrowing is `resources:` (`reference/worker-md.md:88`).
- `.mts` and `.cts` code files: claimed by the kit, skipped by `fsdev gen` (`tsm:13`), so absent from `workforce.gen.ts`.
- `passthroughFrom` (`wfs/resources-from-docs.ts:96-108`) passes every non-derived key; the `resources/` list is the keys with an effect.
- The generator contract (`gen:28-62`) moved to `reference/cli.md` under `fsdev gen`; this page links it.
- Team-folder name check: only when the folder holds a worker, document, skill or package (flag 5).
