# Facts for Kits and slots (R-11, reference)

Every fact the page may state, with file and line. Sources: the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited and nothing here comes from one. Unlike the concept page's sheet (`../concepts/kits-and-slots.facts.md`), which was written before the kits were built, `workforce`, `harnesses` and `claudeCode` are built now (section 9), so nothing on this sheet is marked for reconciling.

Paths are from the repo root. Abbreviations:

- `dk` = `packages/core/src/kit/define-kit.ts`
- `ct` = `packages/core/src/index.ts`
- `sn` = `packages/core/src/helpers/segment-name.ts`
- `ty` = `packages/engine/src/flowstate/types.ts`
- `kp` = `packages/engine/src/flowstate/kits.ts`
- `cf` = `packages/engine/src/flowstate/createFlowState.ts`
- `cl` = `packages/engine/src/folder/claim.ts`
- `wk` = `packages/engine/src/folder/walk.ts`
- `dt` = `packages/core/test/define-kit.test.ts`
- `et` = `packages/engine/test/flowstate/kits.test.ts`
- `wf` = `packages/workforce/src/kit/workforce-kit.ts`
- `rf` = `packages/workforce/src/loader/read-workforce-folder.ts`
- `hk` = `packages/harness-manager/src/kit/harnesses-kit.ts`
- `cd` = `packages/harness-manager/src/kit/coder-flow.ts`
- `ht` = `packages/harness-manager/test/harnesses-kit.spec.ts`
- `cc` = `packages/claude-code/src/sdk/kit.ts`
- `hr` = `packages/workforce/src/hire.ts`
- `wd` = `packages/workforce/src/worker-door.ts`
- `g1` = `goals/kits/install-in-any-order/goal.md`
- `g2` = `goals/kits/workforce-and-harnesses-install-as-kits/goal.md`
- `ex` = `labs/teammates/host.mts`

Legend: **[table]** goes in a table row. **[lookup]** answers one of the page's two lookups. **[run]** the message text was captured by running the code (a throwaway test in `packages/harness-manager`, deleted afterwards), not read off a test.

Where a message below is quoted, it is quoted from the line cited. Messages the tests match by regex are quoted whole from the source line.

## 0. How the rows from other pages were checked

The rows other pages' depth passes moved here (`grep` over `*.record.md`, 18 rows, one per line in the list). Each is checked against code below. Two rows are marked corrected by pass 5 and the corrections hold.

| Row (short) | Verdict | Where it is on this sheet |
|---|---|---|
| Unfilled harness: worker names one (four phrasings) | **True, carried** | 7.3 |
| Install order: dependency, then listed order; a required kit must be listed (corrected) | **True, carried** | 3 |
| `fill` and slot kinds: harness as a kit (`claudeCode`) or a plain value (`codexHarness`, `cursorHarness`) | **True, carried** | 6, 9 |
| `workerFlows` entry that cannot receive messages, error names the flow | **True, carried** | 7.4 |
| Unread file; worker, team, skill, package, document that fails to load; symlink; all at once | **True, carried; the reader's list is longer than the row's: it also has `reference`** | 7.6 |
| A kit fills another kit's slot by naming that kit, no access to its internals | **True, carried**, as "what a kit can reach" | 5 |
| Kit config validation at the call site | **True, carried** | 7.1 |
| A kit's folder (corrected): read at start, after planning; unused entry stops the app | **True, carried**; per-path rules are R-29's, not repeated | 4 |
| Slot kinds keyed and list | **True, carried** | 2 |
| Who may fill a slot, addressing, requires rule, refusal | **True, carried** | 5 |
| Install order: dependency order, not list order | **True, carried** | 3 |
| `contributes` timing and what it receives | **True, carried** | 1, 3 |
| `fill` key and `without(slotKey)` | **True, carried** | 6, 8 |
| Refusals for a fill from a kit that does not require the owner, and an entry the schema refuses; "each throws at `createFlowState` and names the kit and the slot" | **Carried with one correction.** Both throw at `createFlowState`. A schema refusal names the slot and the contributor (`kit "wrong"`) but a refusal of an app `fill` entry names `the app`, not a kit; the requires refusal names both kits (the filler and the owner). | 7.2 |
| Slot value shape: keyed gives read-only record, list gives read-only array | **True, carried** (types: `dk:46-48`) | 2 |
| Rows: kit startup refusals (listed twice, missing requirement, cycles, slot misuse, schema refusal, shared folder, unread file) | **True, carried** | 7 |
| Startup refusal: `harness:` value no slot entry fills "stops the app at start, naming the id" | **True, carried with the wording fixed**: it stops `ready()`, and the message names the worker and the id it named, and the ids that are filled. | 7.3 |
| Startup refusal: dropping `cursorHarness()` from `fill` refuses workers naming `cursor` | **True, carried** | 7.3 |

Dropped: none. Parts of rows left to other pages: the per-path rules of the workforce folder (R-29, named in the "folder" row's own text) and the model sentences each concept page keeps. Nothing a row claimed was untrue.

## 1. `defineKit` fields

`defineKit(definition)` returns the kit's factory. `dk:211-270`; exported from `@flow-state-dev/core` (`ct:112`).

| Field | Required | What it is | Cite |
|---|---|---|---|
| `name` | yes | Lowercase letters, digits and single hyphens (`a-z0-9`, hyphen only between runs), at most 64 characters, not the reserved name `_meta`, not a Windows device name (`con`, `nul`). Unique in an app. Half of every slot key, joined with a `.`. | `dk:117`, `dk:219-225`, `sn:19,25,28,45-56`; test `dt:24-27` |
| `config` | no | A Zod schema the factory checks its config against. Omitted: the kit takes no config. | `dk:119-120`, `dk:248-262` |
| `requires` | no | Factories of the kits this one depends on: it installs after them and may fill their slots, and the slots of any kit they require in turn. | `dk:121-122` |
| `slots` | no | The slots this kit declares, by name. Only a kit that requires it can fill them. | `dk:123-124` |
| `contributes` | no | A function `({ config, slots }) => record`; returns what this kit puts in the slots of the kits it requires, by slot key. | `dk:125-137` |
| `directory` | no | `{ path, read }`: the folder the kit owns in the app. | `dk:138-147` |
| `install` | yes | `({ config, folder, slots }) => { flows }` (sync or async): builds the flows the kit serves. | `dk:148-151`, `dk:95-108` |

- `contributes` returns `{ [ownerKit.slots.slotName]: entries }`. For a keyed slot the value is a record, or entries that each carry a string `id`; for a list slot, one entry or an array. `dk:125-130`; test `et:58-66`, `et:146-169`. [table]
- `contributes` receives the kit's parsed config and the kit's **own** slots, fully filled. It runs after every kit that requires this one has contributed, the app's `fill` included. `dk:131-137`; `kp:207-229`; test `et:116-145`. [table]
- `install` receives the parsed config, what `directory.read` returned (`undefined` when the kit owns no folder), and each declared slot's merged entries, as the schema parsed them. `dk:100-108`; `kp:292-299`. [table]
- `install` returns `{ flows }` (`KitInstallation`), where `flows` is an array. The page says "returns `{ flows }`, the flows the kit serves" and does not call the array "flow instances" (a retired term). `dk:95-98`, `dk:113-115`. The flows are served beside the app's `flows` and are registered at `ready()`, not at construction: `meta.flowKeys` is `[]` after `createFlowState` and holds the kit's flows after `ready()`. `ty:152-171`, `cf:1005-1010`; test `et:108-114`. [table]
- `directory.path` is the default folder, read against the app's `root`. The app may give another with `directory` in the kit's config: read against the working directory instead. `dk:138-147`, `ty:181-186`; tests `et:325-346`.
- `directory.read` is `(folder: KitFolder, { config }) => value | Promise<value>`; it runs on the server at start. `dk:144-147`.
- The factory takes the kit's config input plus an optional `directory: string`. When the config schema accepts `{}`, the argument is optional. `dk:88-91`, `dk:185-193`.
- The factory also carries `kitName` and `slots`, an object of slot keys by slot name (`<kit>.<slot>`). `dk:195-198`, `dk:227-229`, `dk:266-269`; test `dt:14-22` (`"board.columns"`, `"board.cards"`).
- A kit's definition must not import Node modules; files are read only in `directory.read`. Stated on the page as a rule for the kit's author. `dk:12-15`.

**What an app calls.** Calling the factory returns a `KitInstance`, the value a factory returns: `kitName`, `definition`, `config` (as the schema parsed it), `directory` (the app's path or `undefined`), `withheld` (the contributions `without` has dropped; `without` appends to it), and `without(slot, key?)`. `dk:146-171`. [table]

## 2. Slot kinds

Declared with `slot.keyed(schema)` or `slot.list(schema)`, exported from `@flow-state-dev/core`. `dk:56-66`, `ct:112`.

| Kind | Entries | `install` receives | Conflicts | Cite |
|---|---|---|---|---|
| `keyed` | By key. A contributor gives a record, or an array of entries that each carry a string `id`, which becomes the key. A lone non-array entry is read as a record (`Object.entries`), not keyed by its `id` (`kp:177-191`). | A read-only record `Readonly<Record<string, T>>`, with no prototype. | Two contributors giving one key is refused, naming both. The app's `fill` counts as a contributor. | `dk:22-31`, `dk:46-48`, `kp:169-199`; tests `et:146-169`, `et:171-198`, `et:236-247` |
| `list` | Appended. A contributor gives one entry or an array. | A read-only array `readonly T[]`. | None; every entry is kept. | `dk:33-41`, `dk:46-48`, `kp:157-166`; test `et:92-106` |

- List order: kits in install order (each kit after the kits it requires, ties in the order the app listed them), the app's `fill` last. `dk:33-36`, `kp:149`, `kp:204` (the app's rank is infinity). Test: `et:92-106` (`["c","app"]`), `et:81-90`. A tie between two kits that are independent of each other has no test of its own; the order follows the install order in section 3 (`kp:76-80`, `kp:149`). [table]
- Every entry is checked against the slot's schema, and `install` receives what the schema parsed: defaults applied, values coerced. `dk:29`, `dk:39`, `kp:151-156`; test `et:208-224`. [table]
- A keyed entry listed by `id` with no string `id` is refused: `slot "<key>" is keyed, but <who> gave it an entry with no string \`id\` to key it by.` `kp:177`; test `et:166-168`. A keyed slot given something that is neither a record nor a list: `slot "<key>" is keyed, but <who> gave it something other than a record or a list of entries.` `kp:184`. [table]
- An entry keyed `__proto__` stays an own key of the record. `kp:167-170`; test `et:171-198`.
- A slot with no contribution is an empty record or an empty array. `kp:147-166` (`merge` with no `pending`); the merged value is set for every declared slot (`kp:214-218`). Stated as behaviour: an owner's `install` always receives every slot it declares.

## 3. Install order

- The app lists kits in any order. They install in dependency order: each kit after every kit it requires. `dk:203-206`, `ty:160-163`, `kp:55-85`; test `et:81-90` (`[d(), b(), c()]` installs `b`, `c`, `d`); goal `g1:5,13`. [table]
- Two kits where neither requires the other keep the order the app listed them: each step takes the first kit in the listed order whose requirements are placed. `kp:72-84`. [table]
- `requires` takes the other kit's factory, so a kit can require only a kit defined before it (a factory must exist to be named). The page states only that; the cycle refusal is the 7.2 row (test `et:293-296`), and how a cycle is written is not stated. `dk:121-122`, `dk:200-201`.
- A required kit must itself be in the app's `kits` list. Requiring a kit that is not listed is refused. `kp:63-69`; test `et:291`. [table]
- A kit's `contributes` runs dependents first, so a kit's own slots are finished before its `contributes` reads them: the kits are walked in reverse install order. `kp:207-229`, `kp:6-10`. Every contribution is merged before any `install` runs, so each `install` sees its slots complete. `kp:16-18`, `kp:292-299`. [table]
- All installs run in order, one after another, after every kit's folder has been read. `kp:268-300`.
- Construction (`createFlowState(...)`, synchronous) orders the kits, merges the slots, resolves folders. Start-up (`ready()`) reads folders and runs `install`. `kp:3-14`, `cf:417-421`, `cf:1004-1011`. [table]

## 4. A kit's folder

- Resolved at construction, read at start (`ready()`), after every kit is planned and before any kit's `install` runs. Every kit's folder is read and checked before any install, so a refusal installs nothing. `kp:230-257`, `kp:268-290`; test `et:348-364` (`installed` stays `false`). [table]
- The folder is `directory.path` read against the app's `root` (a path, or a URL such as `import.meta.url`, whose directory is used; default: the working directory), or the app's `directory` in the kit's config, read against the working directory. `ty:181-186`, `kp:39-45`, `kp:243-248`; tests `et:325-346`. [table]
- The reader is handed a `KitFolder`: `path` (absolute) and `claim(relativePath)`. Claiming a directory claims everything under it; `"."` claims the whole folder. `dk:68-86`, `cl:30-37`. [table]
- Every entry not claimed stops the app, named, except `.DS_Store` and `Thumbs.db`. `dk:70-75`, `wk:22`, `cl:90-115`. The message: `"<path>" is not used by anything that reads the folder of kit "<name>". Remove it.` `cl:113-115`. [table]
- A symlink anywhere in the folder is refused, claimed or not: `Symlinked entry "<path>" — refused for safety`. `dk:83-84`, `cl:14-17`, `wk:254-256`. A symlinked folder root reads `Symlinked folder of kit "<name>" "<path>" — refused for safety`, naming the path as the app spelled it. `wk:338-342`. [table]
- A folder path spelled with a `..` that steps back through an earlier segment is refused. `wk:329-336`; test `et:366-380`. [table]
- A folder that is missing or unreadable is named, not reported as an unused file: `kit "notes": Failed to read folder of kit "notes" "<path>": <cause>`. Only this row reads `Failed to read ...`; the symlinked root and `..` rows have their own text (`wk:329-342`). `wk:344-350`, `kp:281-283`; test `et:382-391`. [table]
- Two kits reading one folder are refused at construction. `kits "<a>" and "<b>" both read the folder "<path>"; each owns its own.` `kp:250-254`; test `et:393-404`. [table]
- A claim that is absolute, or reaches outside the folder (`..`), throws from `claim`. `cl:40-48`.
- Every refused entry across every kit is reported in one error: `createFlowState: the app can't start; a kit's folder was refused:` and one `  - kit "<name>": <message>` line per entry. Only the unclaimed, symlink and unreadable-entry reports end with ` (<folder>)`; a root that fails to open or a reader that throws has no suffix. `kp:263-269`, `kp:285-290`. The error rejects `ready()` and every later entry point (`getRuntime()`). `et:363`. [table]
- What `workforce`'s reader claims is R-29's table (`rf:46-60`). It is not repeated here.

### The four questions, for each stored part

A kit stores nothing of its own. The plan (order, merged slots, folders) is held in memory and rebuilt at each start. `kp:26-34`.

| Part | Who owns it | Who can see it | Where it is stored | How many |
|---|---|---|---|---|
| The kit's folder | The app: files in its repo | Whoever can read the app's files; the reader runs on the server | On disk, read at start, never written back | One per kit; two kits on one folder is refused (`kp:250-254`) |
| The kit's config | The app, at its call of the factory | The server process | In memory, as parsed, on the `KitInstance` (`dk:263`) | One per kit; a kit listed twice is refused (`kp:59-61`) |
| Slot entries | Each entry: the kit or app that gave it. The slot: the kit that declared it | The server; only the owner's `install` receives the merged entries (`kp:292-299`) | In memory, merged at construction (`kp:210-229`) | Keyed: one per key. List: every contribution |
| What the kit's flows store | The flows the install returns, not the kit | By each flow's scope rules | The app's stores | Per flow; out of scope for this page |

## 5. Who may fill a slot, and what a kit can reach

- A kit fills a slot through the owner's factory: `{ [owner.slots.slotName]: entries }`. It does not import anything else from the owner. The key is `<kit>.<slot>`, read off the factory. `dk:50-54`, `dk:125-130`, `dk:195-198`. [table]
- `contributes` and `install` receive only the kit's own config and own slots; nothing from another kit's config, folder or install. `dk:100-108`, `dk:134-137`. (The statement "no access to the other kit's internals" in the carried row reduces to this: the only channel is the slot key and what the slot's schema accepts.)
- Only a kit that requires the slot's owner, directly or through another kit, may fill it. Through another: `d` requires `c`, `c` requires `b`, so `d` may fill `b`'s slots. `dk:121-124`, `kp:88-100`, `kp:139-142`; tests `et:67-76`, `et:249-259`; goal `g1:8`. [lookup]
- The app's own `fill` may fill any declared slot, with no requirement check. `kp:203-205`, `ty:173-178`; test `et:92-106`. [table]
- A fill of a slot no installed kit declares is refused. Applies to a kit and to the app: `<who> fills slot "<key>", which no installed kit declares.` `kp:135-138`; test `et:275`.

## 6. `fill` and `without`

**`fill`** is an option of `createFlowState`: `fill: { [owner.slots.name]: entries }`, a record from slot key to entries. A keyed slot takes a record, or a list of entries that each carry a string `id`; a list slot appends the app's entries last. `ty:173-178`; tests `et:92-106`, `et:146-169`, `et:208-224`. [table]

- The harness kit's slot is filled this way: `fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness({ model: "composer-2.5" })] }`. `ex:102`; doc comments `hk:93-96`, `ty:173-175`.
- A harness is a plain value or a kit. `codexHarness()` and `cursorHarness()` return a harness value (`Harness`) and install nothing: an app puts them in `fill`. `claudeCode()` installs a flow of its own (the collections a run records its work in), so it is a kit that requires `harnesses` and fills its slot itself. `packages/codex/src/harness.ts:23-28`; `cc:1-19,69-90`. [table]

**`without(slotKey, key?)`** is a method on a kit instance. It returns a copy of the same kit with its contribution to `slotKey` dropped, or only the entry `key` when the slot is keyed. `dk:164-171`; `kp:223-228`. [lookup]

- `harnesses({ workspace }).without(workforce.slots.workerFlows, "coder")` drops the kit's coding flow; `claudeCode().without(harnesses.slots.harnesses, "claude-code")` drops Claude Code. `hk:21-23`, `cc:17-18`; test `ht:93-104`.
- Without a `key`, the whole of that kit's contribution to the slot is dropped; other kits' entries stay. Test `et:226-233` (the order list becomes `["c"]`, the entries slot is untouched). With a `key`, the other entries of that contribution stay. Test `et:200-206` (`{ c }`, and the list slot is untouched). `kp:224-227`. [lookup]
- `without` returns a new instance and leaves the original as it was; calls add up. `dk:231-238`; test `dt:59-68`. A `key` on a list slot has no effect (keys apply only to keyed slots: `kp:171-189`, `kp:157-166` does not read `dropped`). A `without` naming a slot the kit does not contribute to has no effect and no error (`kp:223-227`: the filter matches nothing). Both from code only; no test. [lookup, with the two clauses marked as read from code]
- A dropped entry is not checked against the slot's schema and cannot collide with another. `kp:188` (skipped before the duplicate and schema checks).
- The dropped contribution can break a worker that depended on it: with `coder` dropped, a worker naming `flow: coder` is refused at hire, naming the flow. Test `ht:93-104` (message contains `codex` and `flow`). `hr:258`.

## 7. Startup refusals, and what each names

**Where the page keeps them.** 7.3 and 7.4, the harness refusals in 7.2 (last two rows), the `without` coder break (section 6, last bullet) and the workforce folder rows of 7.6 left the page in revise round 1. The page keeps one pointer each, to R-25 `workforce.md`, R-27 `harness-runs.md` or R-29 `workforce-folder.md`, and states none of their messages. The rows stay here as the source for those pages.

Two moments. **Construction** (`createFlowState(...)` throws, synchronously): everything wrong with the list or its slots, as one `FlowStateConfigError`. One problem: `createFlowState: <problem>`. Several: `createFlowState: the kits can't be installed:` and a `  - <problem>` line each, so every problem shows at once. `kp:47-53`, `kp:259`; test `et:261-276`. **Start-up** (`ready()`, and every request after it, rejects): a folder refused, and a worker or worker flow the installed kits cannot run. Same rejection for every later entry point. `et:363`, `cf:1005-1010`.

Plus **the call site**: a kit's factory throws when the app calls it. 7.1.

### 7.1 At the call of the factory (before `createFlowState`)

| Problem | Message | Cite |
|---|---|---|
| Config fails the kit's schema | `kit "<name>": its config is invalid: <path>: <message>; …` (`(config)` when the path is empty) | `dk:249-256`; test `dt:35-38` |
| Config given to a kit that takes none | `kit "<name>" takes no config, but was given "<key>", …` | `dk:258-262`; test `dt:43` |
| `directory` given to a kit that owns no folder | ``kit "<name>": `directory` is set, but this kit owns no folder.`` | `dk:242-244`; test `dt:44` |
| `directory` not a string | ``kit "<name>": `directory` must be a path.`` | `dk:245-247` |
| Kit name breaks the naming rule | `defineKit: kit name "<name>" must be lowercase letters, digits and single hyphens, at most 64 characters and not a reserved name (<too-long, reserved, pattern or windows-device>): it is half of every slot key, joined with a ".".` Thrown at `defineKit(...)`, not at the factory call. | `dk:219-225`; test `dt:24-27` |

### 7.2 At construction (`FlowStateConfigError`, from `createFlowState`)

| Problem | Message | Cite |
|---|---|---|
| A kit listed twice | `kit "<name>" is listed twice; a kit installs once per app.` | `kp:60`; test `et:301` |
| A required kit not listed | `kit "<name>" requires kit "<needed>", which is not installed.` | `kp:66`; test `et:291` |
| Kits that require each other | `kits require each other: "<a>", "<b>".` (names every kit that can't be ordered: the kits in the cycle and every kit that requires one of them) | `kp:78`; test `et:296` |
| A fill of a slot nobody declares | `<who> fills slot "<key>", which no installed kit declares.` `<who>` is `kit "<name>"` or `the app`. | `kp:136`; test `et:275` |
| A fill from a kit that does not require the owner | `kit "<filler>" fills slot "<key>", but does not require kit "<owner>", which declares it.` | `kp:140`; test `et:249-259` |
| A keyed key given twice | `slot "<key>": the key "<k>" is filled by <first> and by <second>.` where each is `kit "<name>"` or `the app`; the earlier in install order is first. | `kp:191`; test `et:236-247` |
| An entry with no `id` for a keyed slot | `slot "<key>" is keyed, but <who> gave it an entry with no string \`id\` to key it by.` | `kp:177`; test `et:166-168` |
| A keyed slot given neither record nor list | `slot "<key>" is keyed, but <who> gave it something other than a record or a list of entries.` | `kp:184` |
| An entry the slot's schema refuses | `slot "<key>": <who> gave an entry its schema refuses: <issues>.` On a keyed slot: `… gave the entry "<k>" its schema refuses: …`. | `kp:154`; tests `et:278-287`, `kp:194` |
| Two kits on one folder | `kits "<a>" and "<b>" both read the folder "<path>"; each kit owns its own.` | `kp:252`; test `et:393-404` |
| The harness slot has no entry | `coder: no harness is filled; fill the harness kit's \`harnesses\` slot.` A plain `Error`, thrown by the harness kit's `contributes` while the kits are planned; so from `createFlowState`, not `ready()`. Read from code, no test. | `cd:205`, `hk:117-131`, `kp:222` |
| `defaultHarness` names a harness nobody filled | `coder: the default harness "<id>" is not one of <ids>.` A plain `Error`, same moment. Read from code, no test. | `cd:206-208` |

### 7.3 At start-up: a worker names a harness no entry fills

`ready()` rejects. The worker file says `harness: codex`, the `harnesses` slot holds only `cursor`. The message names the worker and the id, and lists what is filled:

```
hireWorkforce: 1 standard worker problem(s); nothing was registered:
  - worker "core.codex" — Flow "coder" instance "core.codex" has an invalid config bag: "harness": Invalid enum value. Expected 'cursor', received 'codex'.
```

**[run]**. The enum of a coding worker's `harness:` is built from the ids the slot holds: `harness: z.enum(ids)`. `cd:288-291`; test `ht:106-119` (contains `codex` and `harness`, not `names no flow`). So dropping `cursorHarness()` from `fill` refuses every worker whose file says `harness: cursor`, naming `cursor`; the same for `codexHarness()`. A worker file that names no `harness:` runs on the kit's `defaultHarness`; with neither, that worker's task fails when it starts (not at start-up): ``worker "<id>" names no `harness:` in its WORKER.md, and the harness kit sets no `defaultHarness`.`` `cd:255-262`. [lookup]

Also at start-up, a worker file naming a flow the kits do not serve (for example `flow: coder` after `without(workforce.slots.workerFlows, "coder")`): `names flow "<flow>", which is not in the worker flows passed to hireWorkforce. Worker flows passed: "agent", …`, listed inside the same `hireWorkforce: … problem(s); nothing was registered:` message with the worker named. `hr:257-259`; test `ht:93-104`. [lookup]

### 7.4 At start-up: a `workerFlows` entry that cannot receive messages

Every flow in workforce's `workerFlows` slot must have exactly one public action named `respond` that takes a user's message (`userMessage` and a `{ message }` input). Otherwise `ready()` rejects, naming the flow. The error is
`hireWorkforce refused <n> worker flow(s) ("<name>", …); nothing was hired:` and a `  - ` line per problem, each starting `worker flow "<name>" …`. The door problems are:

- no door: `worker flow "<name>" has no door: no "respond", a public action with \`userMessage\` and a \`{ message }\` input, so no worker on it could take a user's message. Give it one.` `wd:97-101`
- more than one: `worker flow "<name>" has <n> doors ("a", "b"). Keep one, named "respond": …` `wd:80-84`
- one door with another name: `worker flow "<name>" takes a user's message on "<action>", and every worker's door is "respond": rename "<action>" to "respond".` `wd:86-91`
- a `respond` that takes no message: `worker flow "<name>" has a "respond" that takes no user's message. Make it …` `wd:92-96`

`hr:231-251`, `wd:73-102`. The same check also refuses a flow without a worker `configSchema`, one registered under a name other than its `kind`, and a bad `writtenBy` resource (`worker-flow-contract.ts:187-217,227-247,268-285`): out of scope here (workforce's page). [lookup]

### 7.5 At start-up: a flow id twice

Not kit-specific: two flows with one id, a kit's flow and the app's included, are refused by the registry (`ty:152-156`, `et:92-106` registers `app-flow` beside kit flows). The exact message is not on this sheet; **do not state it.**

### 7.6 At start-up: the kit's folder

`ready()` rejects with `createFlowState: the app can't start; a kit's folder was refused:` and one line per refusal, across every kit, all at once, before any `install`. `kp:268-290`.

| What is wrong | The line names | Cite |
|---|---|---|
| A file no reader used | `kit "<name>": "<path>" is not used by anything that reads the folder of kit "<name>". Remove it. (<folder>)`. Names the topmost entry nothing under it was claimed from, so a stray directory is one line (`"old"`, not `"old/draft.md"`). Goal `g2` `b:stray`: `"flows" is not used`. | `cl:113-115`; tests `et:348-364`; `g2:b:stray` |
| A symlink | `Symlinked entry "<path>" — refused for safety` | `wk:254-256`; `cl:91` |
| An entry that cannot be read | `Entry "<path>" could not be read: <cause>`; a directory: `Folder "<path>" could not be read: …` | `wk:259-262`; `cl:80,95` |
| The folder is missing or unreadable | `Failed to read folder of kit "<name>" "<path>": <cause>` | `wk:344-350`; test `et:382-391` |
| The folder root is a symlink, or has a `..` that steps back through an earlier segment | `Symlinked folder of kit "<name>" "<path>" — refused for safety`; `Folder of kit "<name>" "<path>" is spelled with a ".." that steps back ...`; in full: `... is spelled with a ".." that steps back through an earlier segment — refused for safety ...`. | `wk:329-342`; test `et:366-380` |
| A worker, team, skill, package, document or reference the workforce reader could not load | `kit "workforce": the workforce folder did not load:` then `  - <layer> <path>: <message>` per problem, `<layer>` one of `worker`, `skill`, `team`, `package`, `document`, `reference`. All problems of the tree in one error. | `rf:86-91`; `read-declared-roster.ts:151-163`. |

`workforce`'s stray-folder example (g2): planting `workforce/flows/notes.mts` stops the app and names `flows`, because `flows/` holds only `flows/workers/`. `rf:19-23`, `g2:b:stray`.

## 8. Lookups

**What stops an app from starting, and what does the error name?** Sections 7.1 to 7.6. Short form: the call of a factory (config, `directory`), construction (the list and the slots: always named by kit, slot and key), start-up (a folder entry by path and kit; a worker by id and the harness or flow it named; a worker flow by name). A refusal at construction throws from `createFlowState(...)`; a refusal at start-up rejects `ready()` and every request.

**How do you drop one kit's contribution to a slot?** `kit().without(slotKey)` for the whole contribution, `kit().without(slotKey, key)` for one key of a keyed slot; list the result in `kits`. Section 6.

## 9. The shipped kits, for the examples and a "which slots" row

| Kit | Import | Requires | Declares | Fills | Folder | Cite |
|---|---|---|---|---|---|---|
| `workforce` | `@flow-state-dev/workforce/kit` | none | `workerFlows` (keyed, worker flow entries), `uses` (list, capabilities added to its agent and coordinator flows), `flows` (keyed, builders handed the installation) | none | `workforce/` | `wf:177-184`; package export `packages/workforce/package.json:45` |
| `harnesses` | `@flow-state-dev/harness-manager/kit` | `workforce` | `harnesses` (keyed by each entry's `id`; entry checked by `harnessSchema`) | `workforce.workerFlows` gets `coder`; `workforce.uses` gets the readiness capability; `workforce.flows` gets the `harnesses` flow (its `readiness` and `codingBoard` views) | none | `hk:117-148`; `harness.ts:39-50` |
| `claudeCode` | `@flow-state-dev/claude-code` | `harnesses` | none | `harnesses.harnesses` gets `claude-code`, and with `{ plan: true }` also `claude-code-plan` | none | `cc:72-90` |

- `workforce`'s config is strict (an unknown key is refused); its options are R-29's/the workforce page's. `harnesses`'s config requires `workspace` and is strict. `claudeCode`'s config is `{ plan?: boolean }`, strict. `wf:128-143`, `hk:49-76`, `cc:76`.
- `harnesses` serves no flow of its own at install; it serves `harnesses` through workforce's `flows` slot. Claude Code serves a flow `claude-code`. `hk:111-130`, `cc:77-89`.
- An app (the page's example builds `workspace` with `localWorkspaceHost` from `@flow-state-dev/workspace`, and a kit example fills the slot with `{ ...codexHarness(), id: "codex-review", label: "Codex review" }`): `createFlowState({ kits: [workforce({ agent: { model } }), harnesses({ workspace, defaultHarness: "cursor" }), claudeCode()], fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] } })`. `hk:90-99` (doc example), `ex:84-102`. The `agent` config's `model` (`wf:101-102`) is workforce's, not this page's. Listed flows with the three harnesses: `agent`, `coder`, `harnesses`, `workforce-roster` (+ `claude-code`, as a kit's flow). Goal `g2:a:flows`. [do not print the full flow list as a promise; `g2` lists its own]
- With kits plus filled slots, an app's `ready()` serves each kit's flows beside the app's `flows`. `et:92-106`.

## 10. What the page must not state

- The mechanism of the claim pass beyond what a user sees (the walk, the set of claims). Behaviour only.
- That a tie between independent list contributors keeps listed order, as an observed test result: no test covers it; the doc comment `dk:34-36` and the code do say it. The page may state it as the rule and the sheet cites the comment.
- `without` with an unknown slot or a `key` on a list slot being a silent no-op: read from code only (section 6). State only if the page keeps it as a limit; both are one clause.
- The exact message for a flow id registered twice (7.5).
- A kit "has no client half": not citable.
- Anything about the three kits' option lists, other than the names in section 9.
