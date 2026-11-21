# Facts for SKILL.md and skills options (R-30, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example that uses it. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[test]** marks a fact a test pins. **[run]** marks a fact I confirmed by calling the public function on a sample (the sample is named). **[source]** marks a fact read from code that no test pins. **[doc]** marks a fact the existing user docs state and the code agrees with. **[doc WRONG]** marks a sentence in an existing doc that the code contradicts (section 13).

Paths are from the repo root. Abbreviations:

- `O` = `packages/orchestration/src/skills`
- `skmd` = `O/skill-md.ts`, `rd` = `O/read-directory.ts`, `lib` = `O/library.ts`, `cap` = `O/capability.ts`, `coll` = `O/collection.ts`, `part` = `O/partition.ts`, `seed` = `O/seeding.ts`, `refr` = `O/refresh.ts`, `imp` = `O/import-directory.ts`, `apply` = `O/apply-skill-activation.ts`, `rsb` = `O/render-skill-body.ts`, `ld` = `O/load-tool.ts`, `br` = `O/binding-reader.ts`, `ms` = `O/manifest-source.ts`, `store` = `O/activation-store.ts`
- `sa` = `O/skill-activator.ts`, `sl` = `O/skill-slash-match.ts`, `kw` = `O/skill-keyword-match.ts`, `cls` = `O/skill-classifier-gen.ts`, `cat` = `O/skill-catalog.ts`, `ev` = `O/skill-evaluator.ts`, `evt` = `O/skill-evaluator-tier.ts`, `ast` = `O/active-skill-state.ts`, `sat` = `O/skill-activation-types.ts`
- `fm` = `packages/orchestration/src/shared/frontmatter.ts`
- `T` = `packages/orchestration/test/skills`: `T/skill-md.test.ts`, `T/read-directory.test.ts`, `T/library.test.ts`, `T/seeding.test.ts`, `T/refresh.test.ts`, `T/partition.test.ts`, `T/skill-activator-evaluator.test.ts` (`T/sae`), `T/skill-activator-allowed.test.ts` (`T/saa`), `T/catalog-preset.test.ts`
- `core` = `packages/core/src`: `core/types/skill.ts`, `core/helpers/slash-command.ts` (`SLASH_COMMAND_PATTERN`, line 19)
- `win` = `packages/contracts/src/helpers/windows-reserved-name.ts`
- `aflow` = `packages/workforce/src/agent-worker-flow.ts`, `wdl` = `packages/workforce/src/worker-default-layer.ts`, `rws` = `packages/workforce/src/loader/read-worker-skills.ts`, `man` = `packages/workforce/src/manifest.ts`
- `WT` = `packages/workforce/test`: `WT/worker-skills.test.ts`, `WT/worker-default-layer.test.ts`
- Existing docs: `d-auth` = `apps/docs/docs/skills/authoring.md`, `d-bind` = `apps/docs/docs/skills/binding.md`, `d-act` = `apps/docs/docs/skills/activation.md`, `d-cfg` = `apps/docs/docs/orchestration/configuration.md` (lines 90-116), `d-biw` = `apps/docs/docs/workforce/built-in-worker.md`
- Example: `examples/guides/routing-with-evaluators/src/activate.ts` (reads a skills folder, builds an activator with `skillEvaluator`)

## What the page is

A Reference page: tables and lookups, no narrative, no word budget. The plan names four tables (frontmatter fields; folder rules; naming rules; library, capability and activator options) and two lookups ("Which names are refused?", "What decides that a skill matches?"). Section 14 says what each moved row became.

Imports a reader uses are all from `@flow-state-dev/orchestration` (`O/index.ts:24-147`): `createSkillsLibrary`, `createSkillsCapability`, `createSkillActivator`, `skillEvaluator`, `skillQuestions`, `parseSkillMd`, `serializeSkillMd`, `readSkillsDirectory`, `importSkillsDirectory`, `refreshSeededSkills`, `defineSkillsCollection`, `skillsManifestSource`, `activeSkillsArraySchema`, `createRunSkillTool`, `inlineActivate`. `validateSkillName` and `substitute` are not exported from the package root (`O/index.ts` has no line for either). **[source]**

## 0. The four stored-part questions

A skill is a file the author writes (a folder with a `SKILL.md`). In a running app it becomes a **copy** in a resource collection, and that copy is what the model reads. Each has a different owner.

| Part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| The skill folder on disk | The app's author. It is read when the app starts (`readSkillsDirectory`, `rd:44-96`) and not again unless the app calls it. | Everyone with the repo. | In the repo, wherever the author points `readSkillsDirectory` (`rd:24-30`). | One folder per skill. |
| The seeded copy of a skill (`<name>/SKILL.md` plus one entry per supporting file) | Whoever holds the collection's scope: the whole org by default, one user for `scope: "user"`, one session for `"session"` (`lib:94-98,230`; `coll:63-68`). A copy edited in the collection is the holder's own. | Everyone in that scope. The collection is exposed to a client with `read`, `create`, `update` and `delete` all true, `prefetch` false (`coll:126-134`). A client snapshot carries `description`, `disableModelInvocation`, and when present `allowedTools`, `contextMode`, `keywords`, `seededAt` (`coll:136-146`); `name`, `whenToUse`, `argumentHint`, `license`, `compatibility` and `metadata` are not in it. | In the resource collection, one key per file: `<prefix>/<name>/SKILL.md` and `<prefix>/<name>/<relative path>`; `prefix` defaults to the collection key, `"skills"` (`coll:109-112,171-188`; `lib:238`). With `partitionBy`, `<prefix>/<partition segment>/<name>/...` (`part:206-231`). **[test]** `T/partition.test.ts:100-111` shows keys `skills/worker-a/alpha/SKILL.md`. With `flowIsolation: true`, each registered copy of the declaring flow has its own bucket (`coll:70-86`). | One manifest per skill, one entry per supporting file, and one `_meta` entry per collection (`coll:167-168`; `seed:153-175`). One set per scope holder (one per org, or one per user), and per partition or per flow copy when those are set. No default cap: `maxInstances` is optional (`coll:61-62`; `lib:104-107`). |
| `_meta` entry (`seededNames`) | The library. | Not read by a client; it carries only `seededNames` (`coll:10-14`). | `<prefix>/_meta` (`coll:167-168`). | One per collection. |

- A seeded copy is a copy (an edit is kept, bar the `contextMode` re-seed below): a later edit to the folder on disk does not reach a collection that already holds the skill, and a skill a holder deleted is not put back. `_meta.seededNames` records the names seeded (`seed:26-50,60-88`). **[test]** `T/seeding.test.ts:60` (deletions persist), `:41` (a newly listed name seeds on a later call), `:32` (second call is a no-op). `[doc]` `d-biw:185-187`.
- `refreshSeededSkills(collection, sources)` is the deliberate call that pulls a source edit through: for each name whose manifest is still in the collection it writes the source, then deletes every key in that skill's folder the source does not carry. A deleted skill is skipped. A file the holder added inside a refreshed folder is lost. Returns `{ refreshed, skipped, removed, failed }` (`refr:195-308`). **[test]** `T/refresh.test.ts:28` (body edit), `:46` (withdrawn file removed), `:63` (local addition lost), `:75` (deleted stays deleted), `:147` (never-seeded name skipped), `:110` (failure named, not silent).
- Ordinary seeding is additive: it never deletes a file the source lacks (`seed:135-145`). **[test]** `T/refresh.test.ts:165`.
- Seeding runs on the first render of a binding, the first call of the load tool or `runSkill`, the activator's seed step, or the discovery source's first read, once per collection per process (`seed:23-50`; `br:244-255`; `ld:429`; `sa:177-197`; `ms:101-108`). A seeding failure is logged and the catalog is whatever the collection holds (`br:251-255`). **[source]**
- Seeding skips a bundled skill whose name fails the naming rules, with `console.warn("[skills] skipped initial skill: ...")` (`seed:62-68`). **[test]** `T/seeding.test.ts:83`. A source that does not parse is rejected before anything for that skill is written (`O/internal/write-skill-folder.ts:48-52`). **[test]** `T/seeding.test.ts:91`.
- An already-seeded skill is re-seeded, replacing a holder's edited copy, when its stored `contextMode` is set and not `inline`, or when the source declares a `context` that differs from the stored `contextMode` (`needsResed`, `seed:100-132`, called at `seed:70`). A missing manifest returns false, so a deleted skill stays deleted. The page says seeding leaves an edited copy alone except for this. **[test]** `T/seeding.test.ts:108,137`. Not for the page beyond "re-seeded when it differs"; the observable part is the `contextMode` row in section 1.
- `importSkillsDirectory(root, collection, { overwrite })`: reads a folder and writes each skill into an existing collection. Default `overwrite: false` skips a name already there and reports `{ name, reason: "already exists" }`; `true` replaces it. Returns `{ imported, skipped, errors }`. It does not delete a supporting file the source dropped (use `refreshSeededSkills`) (`imp:427-479`). It takes no `include`/`exclude`/`ignore` option (`imp:427-440`). **[source]**

## 1. Frontmatter fields

The file starts with `---` on the first line, YAML settings, a closing `---` line, then the Markdown body (`fm:626-654`). The skill's identity is its folder name (`rd:98-102`; `core/types/skill.ts:45-52`). Only `description` is required (`skmd:166-173,190-193`). **[test]** `T/skill-md.test.ts:14,112`. `[doc]` `d-auth:47`.

Field table. "Bad value" says what `parseSkillMd` does with a value of the wrong type. A `warning` is returned in `ParsedSkillMd.warnings` and the field is dropped; an `error` throws (`skmd:99-116`). `readSkillsDirectory` throws away the warnings (`rd:138`: the call's result is not kept), so a folder read shows only errors; a caller sees warnings only by calling `parseSkillMd` itself. **[source]**

| Key | State field | Type | Required | Rule | Bad value | Used by | Cite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `description` | `description` | string | yes | Non-empty after trim, at most 1024 characters, no XML tag (pattern `<[a-zA-Z][^>]*>`; `a < b and c > d` passes) | error: `SKILL.md frontmatter requires a non-empty \`description\``; `description exceeds 1024 chars`; `description must not contain XML tags` | The classifier prompt, the evaluator's options, the load tool's listing, the `runSkill` listing, discovery `purpose` (sections 8-9) | `skmd:36-37,190-201`. **[test]** `T/skill-md.test.ts:112,117,123`. **[run]** exactly 1024 passes, 1025 fails; `description: 5` and `description: "  "` fail. |
| `name` | `name` | string | no | A valid skill name (section 5); when the manifest is read from a folder, it must equal the folder name | error: `SKILL.md \`name\` must be a string`; the naming error; `SKILL.md \`name: foo\` must match its folder "bar"` | Nothing at run time; it is checked and stored. `null` or absent is accepted | `skmd:205-220`. **[test]** `T/skill-md.test.ts:134,163,173`; `T/read-directory.test.ts:118`. |
| `license` | `license` | string | no | A license name, or the name of a bundled license file | warning: `\`license\` must be a string — ignored` | Stored on the manifest; nothing renders it | `skmd:222-229`; `core/types/skill.ts:54-55`. **[test]** `T/skill-md.test.ts:141,217`. |
| `compatibility` | `compatibility` | string | no | At most 500 characters | non-string: warning `ignored`; over 500: error `compatibility exceeds 500 chars` | Stored; nothing renders it | `skmd:231-246`. **[test]** `T/skill-md.test.ts:179,217`. **[run]** 501 fails. |
| `metadata` | `metadata` | map of string to string | no | Block mapping or flow mapping (`{ a: x }`). Scalar values (string, number, boolean) are stringified: `a: 1` becomes `"1"`, `b: true` becomes `"true"`. A nested value is dropped with a warning naming `metadata.<key>`. If nothing survives, `metadata` is left unset | non-mapping: warning `\`metadata\` must be a mapping of string keys to string values — ignored` | Stored; nothing renders it | `skmd:248-273`. **[test]** `T/skill-md.test.ts:186,203,210,217`. **[run]** `{a:1,b:true,c:{d:e}}` gives `{a:"1",b:"true"}` and a warning for `c`. |
| `allowed-tools` | `allowedTools` | space-separated string, comma-separated string, or list of strings | no | A string splits on any run of whitespace and commas (`Bash(git:*) Read` gives two entries) | non-string-list, non-string (e.g. `5`): warning `\`allowed-tools\` must be a list of strings — ignored`; a list holding a non-string: same | Validated against a library's `catalog`; shown to the model as a note; grants nothing (section 6) | `skmd:275-290`. **[test]** `T/skill-md.test.ts:21,27,82,88`. **[run]** `[a, b]` list form and `Bash(git:*) Read` both parse. |
| `context` | `contextMode` | `inline` | no | The only accepted value is `inline`; omitted means `inline` | any other value (`fork`, `pattern`, anything): warning `\`context\` must be "inline" — got "fork"; defaulting to inline`, and the field is left unset | Activation only ever renders a skill as inline context | `skmd:292-301`; `core/types/skill.ts:25-37` (`SkillContextMode = "inline"`). **[test]** `T/skill-md.test.ts:33,39`. **[run]** `context: fork` warns, state has no `contextMode`. |
| `disable-model-invocation` | `disableModelInvocation` | boolean | no | `true` keeps the skill in the collection but takes it out of every activation path (below) | a non-boolean (`yes`, `"true"`) is **silently ignored**: no warning, flag not set | Section 9 | `skmd:303-308`. **[test]** `T/skill-md.test.ts:46`. **[run]** `disable-model-invocation: yes` leaves it unset with no warning. |
| `when_to_use` | `whenToUse` | string | no | **The key is spelled with underscores.** Appended on its own line to the description wherever a catalog lists the skill | a non-string is silently ignored | Classifier prompt, evaluator options, load listing, `runSkill` listing | `skmd:66,310-312`; `cat:700-702`; `O/internal/list-enabled-skills.ts:36-37`. **[test]** `T/skill-md.test.ts:395` (`kebabToCamel("when_to_use")` stays `when_to_use`); `T/sae:55` writes `when_to_use:` in a fixture. **[run]** `when-to-use: x` is kept under `_preservedFields.whenToUse` and does not set `whenToUse`. See section 13. |
| `argument-hint` | `argumentHint` | string | no | Free text | a non-string is silently ignored | Stored. No runtime path reads it (a search of `packages/orchestration/src` and `packages/workforce/src` finds no reader outside the parser, the schema and a type) | `skmd:314-316`; `core/types/skill.ts:57-59`. **[source]** |
| `keywords` | `keywords` | list of strings, or a comma-separated string | no | Each entry is lowercased. The string form is split on commas, trimmed, and empty pieces dropped. **The list form is not trimmed and keeps empty strings.** | non-list, non-string: warning `\`keywords\` must be a list of strings — ignored` | Tier 2 only (section 9) | `skmd:318-333`. **[test]** `T/skill-md.test.ts:52,59,65`. **[run]** `["", " Foo "]` gives `["", " foo "]`; `A, B ,, c` gives `["a","b","c"]`. |
| any other key | `_preservedFields.<camelCase>` | any | no | Kept and written back by `serializeSkillMd` | none | Nothing reads it | `skmd:343-354`. **[test]** `T/skill-md.test.ts:72,240`. |

More rules on the same table:

- A string `keywords` is "forward-compat" and the comma form for `allowed-tools` is accepted on parse; `serializeSkillMd` writes `allowed-tools` as one space-separated string, and as a list when an entry itself contains whitespace or a comma (`skmd:387-397`). **[test]** `T/skill-md.test.ts:248,285`. Not for the page unless the page documents `serializeSkillMd`.
- Keys the parser knows but does not honor: `paths`, `hooks`, `shell`, `model`, `effort` are kept under `_preservedFields` and each adds a warning ``SKILL.md field `<key>` is preserved but not honored at runtime`` (`skmd:87-93,336-341`). `user-invocable` is kept the same way with no warning (`skmd:69-71,345`). **[test]** `T/skill-md.test.ts:97`. **[run]** `model: x` warns; `user-invocable: true` does not.
- `scope:` is just another unknown key to `parseSkillMd`: it is preserved without a warning (**[run]** `scope: org` goes to `_preservedFields.scope`). It is refused only when a skill is read as part of a worker's set (section 11) (`rws:326-333,388-391`).
- `agents:` is also just an unknown key: it is preserved, with no error (**[run]** `agents:` with a list lands in `_preservedFields.agents`; no throw). See section 13.
- An unrecognized or mistyped key is never an error. `T/library.test.ts:131` pins strictness for **binding config**, not frontmatter.
- Kebab-case frontmatter keys become camelCase state fields (`kebabToCamel`, `skmd:153-155`); `when_to_use` has no hyphen so it is unchanged (`T/skill-md.test.ts:393-395`).
- Which keys are Agent Skills spec fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (`skmd:4-9`). The rest (`keywords`, `context`, `disable-model-invocation`, `when_to_use`, `argument-hint`) are this framework's. `[doc]` `d-auth:66`, with the key spelling wrong there (section 13).

### What the file may contain (the YAML dialect)

The parser is a small YAML subset, shared with `WORKER.md` (`fm:1-18`; `skmd:18-21`). **[source]** unless marked.

- Accepts: `key: value` pairs; inline lists `[a, b]`; block lists (`- a`); nested mappings by indentation; `|` and `|-` literal blocks and `>` and `>-` folded blocks (`fm:219-232`, `fm:447-485`). Tabs count as one space of indentation (`fm:243-247`). **[run]** tab-indented list parses.
- Quoted strings are unwrapped without processing escapes (`fm:534-540`).
- `true`/`false`/`null`/`~`, integers and decimals are typed (`fm:542-549`).
- A flow mapping `{ a: 1 }` outside `metadata` is kept as a string (`fm:529-532`).
- **A trailing `# comment` after a value is not stripped.** It becomes part of the value (`description: foo # bar` gives `foo # bar`). Whole-line `#` comments are skipped (`fm:262,283`). **[run]**
- A repeated key: the last one wins. **[run]**
- A `|` block keeps its final newline: `description: |` with two lines gives `"line1\nline2\n"`; `|-` and `>-` strip it (`fm:476-484`). **[run]**
- CRLF line endings are accepted (`fm:633`). **[run]**
- A file must begin with the `---` fence as its very first characters. A leading blank line or a byte-order mark makes the parser see no frontmatter and throw ``SKILL.md must begin with YAML frontmatter (--- delimited) including a `description` ``. So does a missing closing fence, or an empty block (`---` then `---`). **[run]** `fm:626-654`; `skmd:182-186`. **[test]** `T/skill-md.test.ts:108`.
- The closing fence is the first later line that is `---` after trimming (`fm:638-644`).

### Body

- The body is everything after the closing fence, stored whole and unchanged (`skmd:14-16,356`).
- When a skill activates, the body is rendered into the prompt as `<active_skill name="<name>">` followed by the body with substitutions and, when `allowed-tools` is non-empty, a note on a new line (`rsb:484-515`). **[source]**
- Substitutions, in this order: `${SKILL_DIR}`, `${CLAUDE_SKILL_DIR}` (an alias), `$ARGUMENTS`, then `$1` to `$9` (`skmd:482-497`). **[test]** `T/skill-md.test.ts:305,311,318,325,330,334`.
  - `$ARGUMENTS` is the activation's `input`: the text after `/<name> ` for a slash, the `input` argument the model passed to `loadSkill` or `runSkill`; empty for a keyword, classifier or evaluator match, and for a skill listed in `active` (`sl:356-360`; `kw:468-472`; `cls:393-398`; `evt:253-258`; `ld:464-469`; `br:271-278`). Unset becomes an empty string (`skmd:483`). **[test]** `T/skill-md.test.ts:334`.
  - `$1`..`$9` are the whitespace-split tokens of that input; a missing token becomes empty (`skmd:491-494`). **[test]** `T/skill-md.test.ts:325,330`. The existing docs do not mention `$1`..`$9`.
  - `${SKILL_DIR}` is `/workspace/<mount prefix>/<skill name>` with no trailing slash (`rsb:502-505`). The mount prefix is the collection's `prefix` option, default the collection key (`lib:238-239`; `cap:113-114`). It is the path the files are mounted at only when a bash capability mounts the collection; with no bash capability the string is still substituted (`d-auth:156-166` states the mount). `[doc]`
  - A `$1` is only replaced when written as `$` plus a digit 1 to 9 at a word boundary (`/\$([1-9])\b/`, `skmd:491-494`). **[source]**
- A skill whose live manifest has `disable-model-invocation: true` renders nothing, even when listed in `with({ active })` (`rsb:498`). **[test]** `T/library.test.ts:396`. The `active` array is validated at build time but the live manifest decides at render time (`rsb:493-499`).
- A skill whose live manifest says a non-inline mode renders nothing (`rsb:499`). Same-name static + dynamic activations: the dynamic one (with its input) renders, once (`br:260-278`). **[test]** `T/library.test.ts:420`.

## 2. Supporting files

- Every file under the skill folder other than the root `SKILL.md` is a supporting file, at any depth, with its path relative to the folder, `/`-separated, and its text read as UTF-8 (`rd:146-186`, esp. `160,179,183`). **[test]** `T/read-directory.test.ts:40`. **[run]** `sub/SKILL.md` and `notes.swp` came back as files of `good`.
- `scripts/`, `references/` and `assets/` are conventional names; no layout is required (`d-auth:23-26`). `[doc]`
- A file is stored under `<name>/<normalized path>`; `./x` and `/x` normalize to `x`, empty and `.` segments are dropped, and a `..` segment throws `Invalid skill file path "<path>": ".." segments are not allowed` (`coll:185-205`). **[source]**
- **A file named `SKILL.md` in a subfolder** (`<name>/sub/SKILL.md`) is stored as a supporting file but the catalog listers treat any entry whose key ends in `/SKILL.md` as a manifest named after its parent folder, so the catalog shows a skill called `sub` (empty description). The load tool then cannot find it (it looks up `sub/SKILL.md`) (`cat:690-703`; `kw:446-451`; `O/internal/list-enabled-skills.ts:21-40`; `ld:439-447`). **[run]** `listEnabledSkills` over a stub collection returned `sub` with description `""`. A reader-facing rule: do not name a supporting file `SKILL.md`.

## 3. Folder rules (`readSkillsDirectory`)

`readSkillsDirectory(root, { include?, exclude?, ignore? })` returns `{ skills: InitialSkill[], errors: [{ name, error }] }`; an `InitialSkill` is `{ name, skillMd, files? }` where `files` are `{ path, content }` (`rd:29-50`; `core/types/skill.ts:168-175`). It is the one reader for every skill folder, including the three levels a worker reads (`rws:314`).

| Rule | What happens | Cite |
| --- | --- | --- |
| Where it looks | Only the direct children of `root`: `<root>/<skill>/SKILL.md`. A skill nested deeper is not found | `rd:4-5,62-96` |
| `root` unreadable | **Throws** `Failed to read skills directory "<root>": <reason>`. A missing `root` throws, it is not an empty result | `rd:55-60`. **[run]** `ENOENT` gave that message |
| One bad skill | Collected into `errors`; the rest still load | `rd:86-93`. **[test]** `T/read-directory.test.ts:59` |
| Entry is a real non-directory (a regular file) | Skipped, no error; the symlink check runs first, so a symlink to a file is the symlink error below | `rd:73-86` |
| Child is a symlink (to a folder or a file) | Error `Symlinked skill folder "<name>" — ignored for safety`; never read; reported even when `include`/`exclude` would leave it out | `rd:73-80,84-85`. **[test]** `T/read-directory.test.ts:67` |
| `SKILL.md` is a symlink | Error `Symlinked SKILL.md in "<name>/" — ignored for safety` | `rd:105-122`. **[test]** `T/read-directory.test.ts:78` |
| `SKILL.md` absent | Error `Missing SKILL.md in "<name>/"` | `rd:118`. **[test]** `T/read-directory.test.ts:162` |
| `SKILL.md` present but unreadable (permissions, I/O, or a directory named `SKILL.md`) | Error `SKILL.md in "<name>/" could not be read: <reason>`, not "missing" | `rd:112-117,128-133`. **[test]** `T/read-directory.test.ts:148` |
| Folder name breaks the naming rules (including a folder like `.git`, `Bad`, `node_modules`) | One error per such folder, the naming error. A stray hidden or tooling folder in the skills root shows up in `errors` unless it is in `exclude` or `ignore` | `rd:87`. **[test]** `T/read-directory.test.ts:128,135`. **[run]** `.git` and `Bad` each produced an error |
| Manifest does not parse | The parse error; `name:` must match the folder | `rd:136-138`. **[test]** `T/read-directory.test.ts:118` |
| Symlink inside the folder | Skipped silently, at any depth | `rd:164-171` |
| `include: [names]` | Only those folders are considered | `rd:83`. **[test]** `T/read-directory.test.ts:106` |
| `exclude: [names]` | Those folders are skipped | `rd:84`. **[test]** same |
| `ignore: [names]` | **Exact names, not globs.** Matched against every entry name at every depth, files and folders. Default set `.DS_Store`, `Thumbs.db`, plus the caller's | `rd:34-35,50,63,159`. **[run]** `ignore: ["*.swp"]` left `notes.swp` in; `ignore: ["notes.swp"]` removed it. The JSDoc on `ignore` says "globs" and the code does not match globs (section 13) |
| Hardlinks, and a path swapped between check and read | Read as ordinary files; accepted | `rd:16-21` |
| Order of `skills` | The order `readdir` returns; not sorted by the function | `rd:57,62`. **[source]** |

The same reader backs every folder a worker reads (section 11).

## 4. Folder shape and the file name

- A skill is a folder `<name>/` containing `SKILL.md` at its root (`rd:4-5,103`). The name is the folder name, and the file name must be exactly `SKILL.md` (`rd:103`). `[doc]` `d-auth:9-26`.
- Nothing in the file says who can reach the skill. Where the folder sits decides that (section 11) (`d-auth:26-32`; `rws:1-22`). `[doc]`

## 5. Naming rules and "Which names are refused?"

`validateSkillName(name)` checks in this order and throws the first failure (`skmd:122-146`). **[test]** `T/skill-md.test.ts:340-390`.

| # | Refused | Message | Cite |
| --- | --- | --- | --- |
| 1 | Empty string, or not a string | `Skill name must be a non-empty string` | `skmd:124-126` |
| 2 | More than 64 characters (64 is allowed) | `Skill name "<name>" exceeds 64 chars` | `skmd:40,127-129`. **[test]** `T/skill-md.test.ts:351`. **[run]** 64 passes, 65 fails |
| 3 | `_meta` (and the empty string) | `Skill name "<name>" is reserved` | `skmd:46,130-132`. **[test]** `T/skill-md.test.ts:348` |
| 4 | Anything not matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`: uppercase, `_`, `.`, spaces, non-ASCII letters, a leading or trailing hyphen, two hyphens in a row | `Skill name "<name>" must be lowercase letters, digits, and single hyphens (not at the start or end)` | `skmd:55,133-138`. **[test]** `T/skill-md.test.ts:340,345,354`. **[run]** `Foo`, `a--b`, `-a`, `a-`, `my_skill` each fail with that message |
| 5 | A Windows device name: `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9` (22 names), matched on the whole name | `Skill name "<name>" is a reserved device name on Windows` | `skmd:139-145`; `win:15-35`. **[test]** `T/skill-md.test.ts:374,382`; `T/read-directory.test.ts:135`. **[run]** `con`, `com1`, `lpt9`, `nul` fail |

- Because the pattern runs first, an uppercase `CON` gets the lowercase message of row 4, and only a lowercase device name reaches row 5 (`skmd:139-142`). **[test]** `T/skill-md.test.ts:382`. **[run]** `CON` gives the row-4 message.
- `com0` and `lpt0` are allowed: the device rule covers 1 to 9 only (`win:11-13`). **[source]**
- The rule is ASCII on purpose: "the name doubles as a resource key, a `/slash` command, and a workspace mount path" (`skmd:48-55`). The Agent Skills spec allows any Unicode lowercase letter; this implementation does not. `[doc]` `d-auth:20-24` omits this difference.
- Where a refused name surfaces:
  - `readSkillsDirectory`: one entry in `errors` per folder (section 3).
  - A `name:` in frontmatter: `parseSkillMd` throws (section 1).
  - Seeding: the bundled skill is skipped with a `console.warn` (`seed:62-68`). `refreshSeededSkills`: the name goes to `skipped` with a warn (`refr:274-281`). **[test]** `T/seeding.test.ts:83`.
  - `createSkillsLibrary`: a bundled skill with a refused name is left out of the build-time index, so `with({ active: ["BadName"] })` fails as an unknown skill, not as a naming error (`lib:166-191`). **[test]** `T/library.test.ts:144`.
  - The load tool and `runSkill`: `validateSkillName(input.name)` runs before any lookup, so a refused name returns the naming error instead of "Unknown skill" (`ld:421`; `O/run-skill-tool.ts:423`). **[source]**
  - Slash tier: no error. The slash pattern is `/<name>` where name is `[a-z0-9][a-z0-9-]{0,63}`, so a refused name simply does not match, or matches a name that is not in the collection, and the message falls through (`core/helpers/slash-command.ts:19`; `sl:354-370`). **[source]**
- A worker's folder level and team names use the same character rules (`packages/core/src/helpers/segment-name.ts:21,24,27`, the same rule the worker page states). Not repeated here.

## 6. Library options (`createSkillsLibrary`)

`createSkillsLibrary(options?) → DefinedCapability` (`lib:224-226`). Install once with `uses: [skills]`; bind per generator with `skills.with({ ... })` (`lib:220-223`). The capability is named `skills` (`lib:470`).

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `collection` | `string` | `"skills"` | Resource key the collection is registered under. | `lib:69-70,227` |
| `catalog` | tool map | `{}` | The tools skills may name in `allowed-tools`. Every bound skill's declared names must be in it or the build throws `skills: skill "<name>" declares tool "<key>", which is not in the catalog`. | `lib:71,228,301-311`. **[test]** `T/library.test.ts:217,244` |
| `registerCatalogTools` | `boolean` | `true` | Whether a binding that renders skills puts the **whole** `catalog` on the generator. `false` still validates `allowed-tools` and grants nothing. | `lib:73-83,229,388-390`. **[test]** `T/library.test.ts:194` pins the default (whole catalog). `false` is the built-in worker's setting (`aflow:985`), exercised through `WT/worker-skills.test.ts:509-540` |
| `initialSkills` | `InitialSkill[]` or `(ctx) => InitialSkill[] \| undefined` | omitted | Bundled skills, seeded on a binding's first render. A function is read on every render and must be a cheap read of something already resolved; returning `undefined` or `[]` seeds nothing. With a function, `with({ active })` and `with({ allowed })` throw, because there is no build-time list to check names against. | `lib:84-93,231-236,261-276`; `O/initial-skills.ts:1-45`. **[test]** `T/initial-skills-resolver.test.ts` exists for the function form |
| `scope` | `"org" \| "user" \| "session" \| ResourceScope` | `"org"` | Where the collection lives. `"user"` for personal libraries, `"session"` mainly for tests. | `lib:94-98,230`. **[test]** `T/library.test.ts:96` |
| `collectionConfig.maxInstances` | `number` | no cap | Size cap on the collection, manifests and supporting files together. | `lib:99-107`; `coll:61-62` |
| `collectionConfig.prefix` | `string` | the `collection` key | Pattern prefix, and the workspace mount path `${SKILL_DIR}` resolves under. | `lib:238-239`; `coll:109` |
| `collectionConfig.flowIsolation` | `boolean` | unset (the flow's own default) | `true`: every registered copy of the declaring flow gets its own catalog, keyed by flow instance. Moving it later re-seeds from the new bucket and orphans the old rows. Rejected at `scope: "session"`. | `lib:99-103`; `coll:70-86,118-120` |
| `partitionBy` | `(ctx) => string \| undefined` | omitted | One catalog per partition in one bucket. The function must return a non-empty string derived from data only the server writes. `undefined` for a run: that run reads no skills and its writes throw `[skills] collection "<key>" keeps its catalog per partition, and this run names none, so it can't write a skill. Its partitionBy returned undefined.` A return of `""` or a non-string throws. | `lib:108-116`; `part:233-361`. **[test]** `T/partition.test.ts:100-135` (separate catalogs; none for no-partition; shared when not set) |
| `itemVisibility` | visibility or list | omitted | Restrict the capability to blocks with a matching `itemVisibility`. | `lib:117-121` |

Library presets (flag-only, set on the same `.with()` call): `dynamicActivation` (off) and `catalogContext` (on by default) (`lib:473-487`).

- `dynamicActivation`: installs the `loadSkill` tool. Without it, a binding has no model-facing load tool (`lib:392-434`).
- `catalogContext`: adds a listing of loadable skills (`- name: description`) to the prompt beside the tool. It is only effective with `dynamicActivation`; a binding with no loader contributes no listing either way (`lib:412-434`; `ld:493-513`). Turn it off with `catalogContext: false`; the load tool's description then points the model at `discover` for the names (`ld:395-400`; `lib:400-410`). **[test]** `T/catalog-preset.test.ts`.
- `.with()` takes preset flags and config keys in one flat object. A key that is neither throws `.with() on capability "skills" received key(s) [...] that match neither a preset nor a config field` (`packages/core/src/capability/define-capability.ts:195-211`). `[doc]` `d-bind:36`.
- `.with()` and `.presets()` each replace the preset overrides a reference already carries; chaining the two drops whichever came first (`T/catalog-preset.test.ts:95`; `[doc]` `d-cfg:114`).
- Using `createSkillsLibrary` and `createSkillsCapability` on one generator fails at build time on the duplicate `skills` collection key. `[doc]` `d-bind:40-41` (not independently re-run).

## 7. Binding options (`skills.with({ ... })`)

Config keys, validated strictly: a misspelled key throws at build time rather than being dropped (`lib:197-214`). **[test]** `T/library.test.ts:131`. `.default({})` makes a preset-only call valid.

| Key | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `active` | `string[]` | `[]` | Skills preloaded on every step of every turn, with their bodies rendered from the first. Each name must be a bundled skill (else `skills.with({ active: [...] }): unknown skill "<name>". Known skills: a, b.`); with no bundled skills, `... no bundled skills are available to validate against ...`; under an `initialSkills` function, the name is refused outright. Each name's declared `allowed-tools` are checked against `catalog`. | `lib:126-130,319-323,261-290`. **[test]** `T/library.test.ts:103,118,162` |
| `allowed` | `string[]` | whole catalog | The names the load tool may pull; also the names an `activeState` field may use for tools. Validated like `active`. Contributes no per-skill tools: when the catalog is contributed it is the whole `catalog`. | `lib:131-142,353-360`. **[test]** `T/library.test.ts:374` (load tool refuses a name outside it) |
| `activeState` | `{ scope: "request" \| "session" \| "user" \| "org", field: string }` | the generator's own block state, field `activeSkills` | Where dynamic activations are stored. Block state is private to the generator and request-scoped, so nothing carries into the next turn. A named scope and field share across generators and, for `session`, `user` or `org`, persist across turns. An upstream matcher must use one (it runs before the generator). `field` must be non-empty. | `lib:143-153,325-331,199-208`; `store:1-44`. **[test]** `T/library.test.ts:303,334,353,535` |

What the binding installs, by row (`lib:362-434`):

| Binding | Catalog tools on the generator | Cite |
| --- | --- | --- |
| `active` non-empty | yes (the whole `catalog`) | `lib:388-390` |
| `dynamicActivation: true`, with or without `allowed` | yes | `lib:363,388-390` |
| `activeState` with `allowed` | yes | `lib:363` |
| `activeState` with neither `allowed` nor `dynamicActivation` | no; bodies written to the field still render | `lib:363-369`. **[test]** `T/library.test.ts:482,513` |
| any binding, library built with `registerCatalogTools: false` | no | `lib:388` |

- `[doc]` `d-bind:44-58` states the same table.
- A generator that declares `tools:` gets exactly what it names; a declared `tools` slot raises the fence. `loadSkill` is a control and a `tools:` list never removes it (`lib:392-402`; `core/types/skill.ts:73-83`). `[doc]` `d-bind:58-62`. The generator-side rule is documented with capabilities; cite `fundamentals/capabilities#capability-tools`.
- The reader (context entry) is always contributed. It renders `active` skills, then dynamic entries; a name in both renders once, as the dynamic entry. It re-runs before every tool-loop step, so a skill the load tool writes appears on the next step of the same turn (`br:197-201,257-303`). Output begins `The following skills are active. Follow their instructions for the rest of this turn.` and returns nothing when no skill renders (`br:297-302`). **[test]** `T/library.test.ts:162,420,446`.
- Everything is grouped under one `<skills>` tag (`lib:464-465`).
- The block-state default needs no `stateSchema` on the generator: the binding adds the `activeSkills` field (`activeSkillsArraySchema`) when `dynamicActivation` is on and no `activeState` is set. A generator that also declares it is not an error (`lib:436-457`). **[test]** `T/library.test.ts:334,353`.
- The reader only renders entries whose `mode` is `inline` (`br:264-266`). Persisted entries with `mode` `fork` or `pattern` are read as `inline` (`ast:213-227`). **[source]**
- Active-skill entry shape: `{ name, mode: "inline", input?, activatedAt, source? }`; `source` is `slash`, `keyword`, `classifier` or `manual-override` (`ast:180-197`; `sat:265-270`). Writing the same name and mode again replaces the older entry (`ast:246-254`). **[test]** `T/active-skill-state.test.ts`.

### The load tool (`loadSkill`)

- Name `loadSkill`. Input `{ name: string, input?: string }`; output `{ skill, mode: "inline", message }` (`ld:342-360,412-419`). `input` becomes `$ARGUMENTS`.
- Refusals, thrown as the tool's error (`ld:420-462`): a name that fails the naming rules (section 5); `Skill "<name>" is not in this generator's allowed set. Allowed: a, b`; `Unknown skill "<name>". Available: a, b` (the list is only loadable skills in the allowed set); `Skill "<name>" has \`disable-model-invocation: true\` and cannot be loaded by the agent`; a non-inline skill. **[test]** `T/library.test.ts:374`; `T/run-skill-tool.test.ts` for the older tool.
- The same filter (enabled, inline, inside `allowed`) is the one definition of "loadable" for the load tool, the prompt listing and the discovery source (`O/internal/list-loadable-inline-skills.ts:1-51`).
- `skillsManifestSource({ collectionKey = "skills", allowed?, initialSkills? })` projects the loadable skills into the discovery door as entries `{ id: name, kind: "skill", purpose: description (plus when_to_use), contract: "If you have a \`loadSkill\` tool, load it with loadSkill({ name: \"<name>\" })." }`. Pass the same `allowed` array the binding got; nothing checks they agree. A collection not registered on the scope throws. (`ms:68-123`) **[test]** `T/manifest-source.test.ts`.

## 8. Capability options (`createSkillsCapability`, the session-wide form)

Prefer the library for new code (`cap:3-14`). Still public (`O/index.ts:24-27`). `createSkillsCapability(options?) → DefinedCapability`, capability name `skills` (`cap:102-148`).

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `collection` | `string` | `"skills"` | Resource key. | `cap:58-59,105` |
| `catalog` | tool map | `{}` | Tools registered by the `tools` preset. | `cap:60-61,106,131` |
| `initialSkills` | `InitialSkill[]` (an array only; no function form) | omitted | Seeded on the first `runSkill` call, and on the catalog formatter's first render. | `cap:62-63,133-140` |
| `scope` | `ResourceScope` | `"org"` | Collection scope. | `cap:64-69,107` |
| `collectionConfig` | `{ maxInstances?, prefix? }` | omitted | No `flowIsolation` and no `partitionBy` on this form. `prefix` is the mount path. | `cap:70-76,113-120` |
| `itemVisibility` | visibility or list | omitted | Restrict to blocks with a matching `itemVisibility`, so only a main agent gets the body and tool in a multi-agent pattern. | `cap:77-89` |

- Presets, all on by default: `tools` (the catalog), `context` (the active-skill body formatter; required for any matched skill to appear), `runSkill` (the `runSkill` tool plus a catalog listing). Drop one with `cap.with({ runSkill: false })` or `.presets({ runSkill: false })` (`cap:157-180`). **[test]** `T/capability.test.ts:72`. `[doc]` `d-act:162-181`.
- It declares a session state field `activeSkills`; matches from every path are written there and every generator in the session reads it (`cap:150-155`; `ast:229-232`). That is why it can leak a skill into another agent. `[doc]` `d-bind:11`.
- `runSkill` input `{ name, input? }`; description lists `- name: description` for every enabled skill, or `No skills are currently available — this tool will reject any invocation.` when none (`O/run-skill-tool.ts:321-397`). Refusals: naming error, `Unknown skill "<name>". Available: ...`, `has \`disable-model-invocation: true\` and cannot be invoked by the agent` (`O/run-skill-tool.ts:423-446`). **[test]** `T/run-skill-tool.test.ts`.
- With this form, `activeSkills` is not cleared between turns by the capability itself; an up-front `createSkillActivator` replaces it each turn (section 9) (`ast:166-173`; `apply:314-318`). `[doc]` `d-act:187-189`.

## 9. Activator options (`createSkillActivator`) and "What decides that a skill matches?"

`createSkillActivator(options?) → block`. A sequencer that returns its input unchanged, so it can be `.tap()`ed anywhere before the generator; it reads `input.message` (`sa:60,152-160`). Default block name `skill-activator`. **[test]** `T/skill-activator.test.ts:29-45`.

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | `"skill-activator"` | Block name. | `sa:63-64,186` |
| `collectionKey` | `string` | `"skills"` | Collection to scan. | `sa:65-66,162` |
| `initialSkills` | `InitialSkill[]` or resolver | omitted | Seeds the catalog before any tier reads it. Pass the same value the library got; without it a fresh collection is empty on turn 1 and nothing matches. The seed step is added only when there are skills to seed or a resolver. | `sa:104-113,177-197`. **[test]** `T/saa:66` |
| `activeState` | `{ scope: "request" \| "session" \| "user" \| "org", field }` | `{ scope: "session", field: "activeSkills" }` | Where the matches are written. Point it at a binding's `activeState` to feed that generator. | `sa:89-97`; `apply:345-351` |
| `allowed` | `string[]` | all skills | Restrict every tier to these names: a `/skill` or keyword hit outside it is dropped, and the apply step filters again. Set it to the target binding's `allowed`. | `sa:98-103`; `sl:333-338,361-364`; `kw:416-417,452`; `cat:698`; `apply:377-379`. **[test]** `T/saa:51,93` |
| `enableKeywordMatch` | `boolean` | `true` | `false` skips tier 2. | `sa:80-88,164`. **[source]** (no test in `packages/*/test`) |
| `enableLlmClassifier` | `boolean` | `true` | `false` skips tier 3: no model call. Refused together with `evaluator` when explicitly `false`. | `sa:73-79,163`; `sa:139-143`. **[test]** `T/skill-activator.test.ts:40-44`; `T/sae:563` |
| `classifierModel` | `string` | `"intent/utility"` | Model of the generator classifier. Refused with `evaluator`. | `sa:67-68`; `cls:348`. **[test]** `T/sae:168` |
| `confidenceThreshold` | `number` | `0.65` | A match is kept when its confidence is at least this (`>=`). Refused with `evaluator`. | `sa:69-70`; `cls:305,391`. **[test]** `T/sae:168` |
| `maxSkillsInClassifier` | `number` | `20` | Cap on skills offered to tier 3, in collection order. Applies to the evaluator's options too. | `sa:71-72,216-220,230-234`; `cls:308`; `cat:682-705`. **[test]** `T/sae:267` |
| `evaluator` | evaluator block | omitted | Tier 3 runs on this block instead of the generator classifier (section 10). | `sa:114-127` |

Refusals at build time (`sa:130-150`):

- `evaluator` that is not an evaluator block: `createSkillActivator: "evaluator" must be an evaluator block (got handler "a-handler"). Build one with skillEvaluator(model), or core's evaluator() with skillQuestions.` (no `(got ...)` clause when the value has no kind). **[test]** `T/sae:532,545`.
- `evaluator` with `classifierModel`, `confidenceThreshold` or `enableLlmClassifier: false`: `createSkillActivator: "evaluator" can't be combined with <names>. Those options configure the generator classifier, which the evaluator replaces.` `enableLlmClassifier: true` is allowed. **[test]** `T/sae:563`.

### The tiers, in order

The tiers run in this order inside one sequencer, then the apply step (`sa:177-242`). A tier after the first only runs when nothing has resolved the turn (`sa:206-209,222-225,236-239`).

1. **Slash.** The message must start with `/` followed by the skill name, optionally followed by whitespace and an argument. Pattern `^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$`; anchored, so a leading space (` /foo`) is plain text, and the name must be the whole first word (`core/helpers/slash-command.ts:3-19`; `sl:354-358`). The argument is trimmed and becomes the activation's `input` (`sl:359-360,376-383`). It matches only when: the name is in `allowed` (if set), the skill exists in the collection (looked up by `<name>/SKILL.md`), and it is not `disable-model-invocation: true`. Any other case falls through without an error, so a later tier can still match (`sl:362-373`). A match sets `resolved`, so tiers 2 and 3 are skipped. No model call. **[test]** `T/saa:51` (outside `allowed` falls through); `T/sae:254` (slash resolves before the evaluator).
2. **Keyword.** Each skill's `keywords` are matched as plain substrings of the lowercased message. Every skill with at least one matching keyword activates, with `input` empty. A skill with no keywords is not considered. Skipped when `disable-model-invocation` or outside `allowed` (`kw:431-476`). Any match sets `resolved`; no match leaves tier 3 to run. No model call. **[test]** `T/saa:93`; `T/skill-md.test.ts:52` for the lowercase rule. Edge: because a list-form keyword is not trimmed and an empty string is kept, `keywords: [""]` matches every message (`"x".includes("")` is true) (`kw:456`; `skmd:320-323`). **[run]** parse gives `[""]`. **[source]** for the match.
3. **Classifier** (default). One generator call, model `classifierModel`, structured output with `reasoning` and `activeSkills: [{ name, input, confidence 0..1 }]` (`cls:313-323`). It sees up to `maxSkillsInClassifier` skills, each as `- <name>: <description>` (description followed by `when_to_use` on its own line), from the same allowed, model-invocable set (`cls:352-373`; `cat:682-705`). It may return several matches and may supply an `input`. A match is kept only when its name is in the allowed, non-disabled catalog (the cap is not applied to this check) and its confidence is at least the threshold (`cls:377-399`). Its calls are hidden from the client stream and from the model's history (`cls:351`). **[test]** `T/sae:168` (same prompt, same model, keeps only matches at or above 0.65), `:203` (drops matches outside the binding or marked `disable-model-invocation`, however confident).
   - Tier 3 runs only when tiers 1 and 2 did not resolve. A turn that resolves in tier 1 or 2 makes no model call (`sa:222-240`). `[doc]` `d-act:60-64`.
4. **Apply** (always last). Writes the resolved skills to `activeState` as `{ name, mode: "inline", input, activatedAt, source }`, **replacing** what the field held, so a turn with no match clears the previous turn's activations (`apply:362-402`; `store:141-160`). `source` is the tier that matched (`slash`, `keyword`, `classifier`). **[source]**; `[doc]` `d-act:183-187`.

### What decides that a skill matches (lookup)

For `createSkillActivator`, a skill can match only when all of these hold; then the first tier that answers wins:

| Condition | Where |
| --- | --- |
| The skill's `<name>/SKILL.md` is in the collection (seeded or written there) | `sl:366-370`; `kw:445-451`; `cat:690-697` |
| It is in `allowed` when the activator has one | `sl:364`; `kw:452`; `cat:698` |
| It does not have `disable-model-invocation: true` | `sl:373`; `kw:454`; `cat:700` |
| Tier 1: the message starts with `/<name>` | above |
| Tier 2: a keyword of the skill is a substring of the lowercased message | above |
| Tier 3, classifier: the model returns the name with confidence at or above the threshold | above |
| Tier 3, evaluator: the model picks the name | section 10 |

Other ways a skill becomes active outside the activator:

- `with({ active })`: always, on every step (`br:271-278`).
- `loadSkill` (binding with `dynamicActivation`): the model calls it (`ld:412-478`).
- `runSkill` (capability): the model calls it.
- A worker's `skills.active`: appended after the matcher each turn (`aflow:1275-1330`).

The description is what the classifier, the evaluator, the load listing and discovery show the model; `when_to_use` is appended to it (`cat:700-703`; `lib:511`). `[doc]` `d-auth:54`: "The trigger for both activation paths".

Entry point comparison the existing page also states: the activator's seed step makes the catalog populated before tier 1 on a fresh collection. **[test]** `T/saa:66`.

## 10. The evaluator tier (`skillEvaluator`, `skillQuestions`)

`skillEvaluator(model, { recentMessages? }) → evaluator block` (`ev:120-139`). `model` is a model string (resolved by core through the app's model resolver when the block runs) or an evaluation model instance used as given; a generate-only model is refused at the helper call (`ev:98-106`). **[test]** `T/sae:580,601`. Example: `examples/guides/routing-with-evaluators/src/activate.ts:28-33`. Block name `skill-evaluator` (`ev:132`).

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `recentMessages` | non-negative integer | `0` | How many earlier turns the model also sees, oldest first, before the message. A turn is one earlier request: the user's message and every assistant message it kept. User and assistant text only; no tool calls, results or reasoning, no hidden or transient messages, nothing from the current request. The session's history window caps how far back it reaches. Read only when the evaluator will run (never for a slash or keyword hit, or an empty catalog); on a first turn it is `[]`. A negative, fractional, `NaN` or non-numeric value throws `skillEvaluator: "recentMessages" must be a non-negative integer (got <value>).` | `ev:54-63,124-129`; `O/skill-evaluator-turns.ts:1-72`. **[test]** `T/sae:747-1135` (read 746; refusal 1109-1118) |

What the activator hands the evaluator: `{ message, skills }`, plus `recentMessages` when the block was built with a count above 0 (`ev:41-45`; `evt:210-222`). `skills` is `[{ name, description }]` from the same allowed, model-invocable, capped catalog as the classifier (`evt:195-200`). The options come from the collection only; a `skills` or `recentMessages` field smuggled into the action input is ignored (`evt:206-209`). **[test]** `T/sae:313,1015`.

`skillQuestions(input)` builds the one question the activator reads: a `skill` choice, "Which skill, if any, should be used to answer this user message? Pick a skill only when its description clearly fits what the user is asking for.", whose options are the offered skills (described by their description, or none when empty) plus a no-skill option with the key `NO_SKILL` (`ev:65-89`; `sat:299-304`). `NO_SKILL` is outside the skill-name grammar (uppercase and underscore), so it cannot collide with a real skill, including one named `none` (`sat:299-304`). **[test]** `T/sae:408`. `NO_SKILL` is not exported from the package. Use `skillQuestions` as `questions` for a hand-built `evaluator({ name, model, state, questions: skillQuestions })` (`ev:74`). `[doc]` `d-act:116-133`.

Semantics (`evt:140-156,224-275`):

- Runs only when tiers 1 and 2 did not resolve (`sa:222-225`). **[test]** `T/sae:254`.
- With an empty offered catalog, or one entirely outside the binding, the evaluator is not called and nothing activates (`evt:274`, `evt:229-233`). **[test]** `T/sae:297`.
- The pick is final: no confidence threshold applies. A skill activates with `source: "classifier"` and the model's own `confidence` when the model reported one; with none reported there is no confidence key (and the aggregate stays `null`). So a pick activates on models that report no confidence. **[test]** `T/sae:333,357`. A 0.1-confidence pick activates here and is dropped by the generator classifier (`T/sae:348`).
- The no-skill answer activates nothing (`evt:250-261`). **[test]** `T/sae:408`.
- At most one skill from this tier (keyword matches can activate several). The pick carries no `input`, so `$ARGUMENTS` is empty. `[doc]` `d-act:114` ("it can't pull an argument out of the message"). `evt:253-258`. **[source]**
- A picked skill removed, disabled or taken out of the binding while the call was in flight does not activate: the catalog is re-read after the call (`evt:244-248`). **[test]** `T/sae:382`, `:1077`.
- Any evaluator failure fails the activator, with no fallback to the default classifier, which is never built when an evaluator is passed: a provider error, a malformed result, or a model string the resolver cannot evaluate with. No skills are written. **[test]** `T/sae:433-466`. The write runs last (`sa:212-242`, `pipeline.tap(apply)`; `apply-skill-activation.ts:88-92`), so a failed evaluator skips it and the previous activations stay in the `activeState` field (session `activeSkills` by default). `.rescue` carries on without a new pick (`T/sae:474`); to carry on with no skill, the rescue block clears that field. **[read]**
- A hand-built evaluator that does not answer a `skill` choice question fails the activator with `Skill activator: evaluator "<block name>" did not answer a "skill" choice question. Build it with skillEvaluator(model), or pass skillQuestions as its questions.` (`evt:236-241`). **[test]** `T/sae:510`.
- A cancelled request ends `aborted`, not failed (`T/sae:488`). The evaluator's trace row sits under the activator with the options it was offered and its answer (`T/sae:636`).
- The block must be an evaluator block (section 9 refusals).
- Exports: `skillEvaluator`, `skillQuestions`, `skillEvaluatorInputSchema`, types `RecentMessage`, `SkillEvaluatorBlock`, `SkillEvaluatorInput`, `SkillEvaluatorOptions`, `SkillQuestions` (`O/index.ts:100-111`).

## 11. Where skills sit for a worker (folder levels and worker `skills` settings)

Skill locations by level (`rws:137-170,224-227`):

- A worker on a team reads three folders: `org/skills/`, `teams/<team>/skills/` and `teams/<team>/workers/<worker>/skills/`. An org worker reads two: `org/skills/` and `org/workers/<worker>/skills/`. A worker draws only from the levels it can see. Records come back in level order (org, team, own) (`rws:224-227,256-274`). **[test]** `WT/read-worker-skills.test.ts`. `[doc]` `d-biw:130-153`, `apps/docs/docs/skills/overview.md:146-183`.
- A skill beside the worker needs no list: the folder says whose it is (`rws:143-144`). `[doc]` `d-biw:157`.
- A level that is absent is not an error; one that exists and cannot be listed is (`rws:146-147`).
- Reading is per worker, so two teams may each have a `review`; neither worker's set holds the other's (`rws:11-14`). **[test]** `WT/worker-skills.test.ts:272`.
- Refusals (collected into `errors`, kind named; one bad folder does not cost the worker its other skills) (`rws:44-94,129-135`):
  - `scope:` in a `SKILL.md` left out of the set: `SKILL.md in "<path>/" declares \`scope:\`, which is not a setting a skill declares. Where a skill folder sits is what decides who can see it.` (`man:371-379`; `rws:326-333`). Detected on the raw frontmatter (`rws:388-391`).
  - The same name from more than one level: all copies left out, `Skill "<name>" reaches worker "<worker>" from <n> levels — <path> and <path>. Remove one: there is no precedence rule.` (`man:391-397`; `rws:256-272`).
  - A symlinked level, a symlinked ancestor folder, an unlistable level, and a skill folder that failed to load (kind `skill-load-failed`: naming error, symlink, missing or malformed `SKILL.md`) (`rws:53-65,301-322`).
  - A symlinked or unreadable root throws (`rws:149-153`).
- The same name from the app's `defineAgentWorkerFlow({ skills })` and a worker's folders is refused: `holds skill "<name>" from its own folders, and defineAgentWorkerFlow({ skills }) carries a skill of the same name. They fill one catalog and there is no precedence rule — rename one, or drop one.` (`aflow:515-533`). **[test]** `WT/worker-skills.test.ts:261`.
- Each user's copy keeps its own skills: the built-in worker flow's library is `scope: "user"`, `registerCatalogTools: false`, `flowIsolation: true`, seeded from a per-worker function, and on an installation `partitionBy` the worker the turn resolved (`aflow:982-1005`). Two people never share one worker's copy, and one worker's catalog is not another's. **[test]** `WT/worker-skills.test.ts:297-330` (each worker's own, none for a worker with none, app skills alongside own); `[doc]` `d-biw:128`. The catalog is the app's skills followed by the worker's own (`aflow:964-969`).
- Editing a skill's file later does not reach a worker already holding a copy; `refreshSeededSkills` pulls an edit through (section 0). `[doc]` `d-biw:185-187`.

Worker `skills` settings (a `WORKER.md` or hire's `skills:` block, on the built-in `agent` flow) (`aflow:534-583`):

| Key | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `active` | list of skill names | `[]` | Skills in context on every turn, appended after whatever the matcher resolved; a name already matched this turn is not added twice. A name the worker does not hold is refused **on the worker's first turn** (not at hire), naming the missing name and listing what it holds: `This worker lists "x" in \`skills.active\`, which it does not hold. It holds: "a", "b". A skill reaches a worker from the org's, its team's, or its own \`skills/\` folder, or from \`defineAgentWorkerFlow({ skills })\`.` | `aflow:547,671-686,1275-1330`. **[test]** `WT/worker-skills.test.ts:342,358,378,396,406` |
| `activateTool` | boolean | unset | Unset: on for a worker that holds at least one skill (unless `defaults` turns the `skillsIndex` section off), off for a worker that holds none. A value the worker sets always wins: `false` removes the tool and the listing; `true` installs the tool even with `defaults: false`, with no listing line. On, the model gets `loadSkill` and the prompt gets a listing of every skill the worker holds, a per-turn cost proportional to the catalog. | `aflow:565`; `wdl:86-99,308-312`. **[test]** `WT/worker-default-layer.test.ts:215,227,239,252,262`; `WT/worker-skills.test.ts:284,447,467` |
| `enableLlmClassifier` | boolean | `false` | Turns on the third tier, a model call per turn that classifies the message against the skill catalog. Left off, a slash hit, `active` and `activateTool` are the other ways in. | `aflow:582`; `aflow:1259-1272`. **[test]** `WT/worker-skills.test.ts:488` (no classifier call with it off) |

- The `skillsIndex` section of `defaults` (a `WORKER.md` `defaults:` key; `false` turns off every section, an object turns off each section set `false`) controls the skills listing and its line; listed in `wdl:47,61-70,81-84`. The line text is `Before you answer, check the skills listed here. If one fits the request, even in part, load it with \`loadSkill\` first, then answer.` (`wdl:101-103`). A worker that holds no skill is shown no listing and no line (`wdl:308-312`). **[test]** `WT/worker-default-layer.test.ts:227,239`.
- On a worker: slash matching always runs, on every turn, whatever the settings; keyword matching is never part of the built-in worker (`enableKeywordMatch: false` on both of its activators); the classifier tier runs only when `enableLlmClassifier` is true (`aflow:1245-1272`). A slash message only counts when the user typed it; the matcher reads the turn's `message` input. `[doc]` `d-biw:178`.
- App-level options on `defineAgentWorkerFlow`: `skills` (bundled skills every worker on the flow holds), `classifierModel` (model for the opt-in tier 3) and `confidenceThreshold` (default `0.65`) (`aflow:275,301-303,1265-1270`); `[doc]` `d-biw:94,98-99`. A `WORKER.md` that names `classifierModel` or `confidenceThreshold` is refused by name (`d-biw:104`). The worker-settings detail belongs to R-28 (`worker-md`); this page carries only the `skills` block and the activation behavior.
- The worker's skill catalog files are `workerSkills` in the settings bag; a file that declares `workerSkills:` is refused (`man:371-379` area; see R-28). Not for this page.
- `d-biw:179` says `activateTool` is "Off by default". **The code disagrees** (above). See section 13.

## 12. Types and shapes a reader meets

- `InitialSkill`: `{ name: string, skillMd: string, files?: SkillFile[] }`; `SkillFile`: `{ path, content }` (`core/types/skill.ts:157-175`).
- `ParsedSkillMd`: `{ state: SkillState, body: string, warnings: string[] }`; `parseSkillMd(text, { expectedName? })` (`skmd:99-116`).
- `serializeSkillMd(state, body)` writes `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, `context`, `disable-model-invocation`, `when_to_use`, `argument-hint`, `keywords`, then preserved fields, then the body, ending in one newline (`skmd:368-423`). **[test]** `T/skill-md.test.ts:228-300`.
- `SkillState` (stored on the manifest): the camelCase fields in section 1, plus `_seededAt` (ISO timestamp the seeder stamped) and `_preservedFields` (`core/types/skill.ts:45-107`). `contextMode` is typed `"inline"`; the collection schema still accepts `fork` and `pattern` so an old stored record does not lose its other fields (`coll:24-36,45`).
- `RefreshSeededSkillsResult`: `{ refreshed, skipped, removed, failed }`; `ImportSkillsDirectoryResult`: `{ imported, skipped, errors }`; `ReadSkillsDirectoryOptions`: `{ include?, exclude?, ignore? }` (`refr:222-247`; `imp:442-446`; `rd:29-36`).
- `defineSkillsCollection({ prefix = "skills", maxInstances, scope = "org", flowIsolation, partitionBy })` is the collection the library and capability register; use it directly to place the collection under any block's `resources` (`coll:57-164`).

## 13. Where the existing docs disagree with the code

Every row is a sentence on a current page that the code contradicts or leaves out. The page states the code's behavior.

| Existing page | Says | Code | Cite |
| --- | --- | --- | --- |
| `d-auth` frontmatter table (line 61), row `when-to-use` | The key is `when-to-use`. | The key is `when_to_use`. `when-to-use` is kept as an unknown key under `_preservedFields` and sets nothing. **[run]** | `skmd:66,310-312`; `T/skill-md.test.ts:395` |
| `d-auth` "Validation errors" | `parseSkillMd` throws on "An `agents:` block." | No code throws on `agents:`. It is preserved as an unknown key. **[run]** `agents:` with a list: no throw. A search of `packages/orchestration/src/skills` and `shared` for the key finds none. | `skmd:343-354` |
| `d-auth` frontmatter table, `disable-model-invocation` | "every activation path skips it" | True for slash, keyword, classifier, evaluator, the load tool, `runSkill`, the prompt listings and discovery; also a skill listed in `with({ active })` renders nothing. A non-boolean value is silently ignored, so `yes` disables nothing. | `sl:373`; `kw:454`; `cat:700`; `ld:450-454`; `rsb:498`; `skmd:303-308` |
| `d-auth` frontmatter table, `keywords` | "Lowercased tokens" | The parser lowercases the list entries but does not trim a list entry or drop an empty one; `[""]` matches every message. | `skmd:318-333` |
| `d-auth`, table | `argument-hint` is not listed | Parsed and stored; nothing reads it. | `skmd:314-316` |
| `d-auth` folder shape | Symlinked skill folder reported as an error; a symlink inside is skipped | Also: a symlinked `SKILL.md` is an error; the folder and manifest checks run per entry. | `rd:120-122` |
| `rd:34` JSDoc and any page that says `ignore` takes globs | "Skip files matching these globs (e.g. `["*.swp", ".DS_Store"]`)" | Entries are matched as exact names. **[run]** | `rd:34-35,50,159` |
| `core/types/skill.ts:88,135` doc comments | `argument-hint` is "Surfaced in tool description" | Nothing reads it. | `skmd:314-316` |
| `core/types/skill.ts:5-6` header | "The framework does not auto-match skills" | The activator and `with({ active })` activate without a model decision. | `sa:1-34` |
| `d-cfg:99` | `initialSkills`: "Seeded the first time a generator binds this library." | Also accepts a per-execution function, and seeds on the binding's first render (or the activator's seed step or the load tool's first call). | `lib:84-93,244-255` |
| `d-cfg:101` | `collectionConfig`: `{ maxInstances?, prefix? }` | The library also takes `flowIsolation` there. `partitionBy` is its own option. | `lib:104-107,116` |
| `d-cfg` (library table) | No `partitionBy` row | `partitionBy` is an option. | `lib:108-116` |
| `d-act:135-160` options example | Lists `collectionKey`, `activeState`, `classifierModel`, `confidenceThreshold`, `maxSkillsInClassifier`, `enableLlmClassifier`, `evaluator` | Omits `name`, `initialSkills`, `allowed` and `enableKeywordMatch`. | `sa:62-128` |
| `d-act:242` table "When to pick which" | Uses `presets({ runSkill: false })` while the earlier example uses `.with({ runSkill: false })` | Both work (`T/capability.test.ts:72`); `.with()` and `.presets()` replace each other's overrides. | `cap:157-180` |
| `d-biw:179` | `activateTool` is "Off by default, because turning it on puts a listing ... into every prompt." | Unset, it is **on** for a worker that holds a skill, and a `defaults: { skillsIndex: false }` or `activateTool: false` turns it off. | `wdl:86-99`; `WT/worker-default-layer.test.ts:215-262` |
| `aflow:546-548` doc comment | `skills.active` name not held "is refused at the mint" | It is refused on the worker's first turn; the check runs in a block, not at the mint. The function's own comment says so. | `aflow:658-669,1298` |

## 14. Rows moved to R-30, checked against the code

Command run: `grep -rhE --include=*.record.md -e '→ R-30( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` found six rows (sources `pages/catalog/workforce/index.record.md:85`, `pages/reference/worker-md.record.md:96`, `pages/reference/glossary.record.md:111`, `pages/build/route-with-an-evaluator.record.md:92-94`). All six hold. None is dropped. Notes on where each lands and one correction each needs.

| # | Row (short) | Verdict | Where it lands |
| --- | --- | --- | --- |
| 1 | Skill locations by level; activation by leading `/<skill>`, `skills.active`, or the load tool (on by default for a worker that holds a skill, with a listing; off with `activateTool: false` or `skillsIndex` off in `defaults`); each user's copy keeping its own skills | **True**, carried. Nuance: `activateTool: true` with `defaults: false` installs the tool with no listing line; `skillsIndex` only decides when `activateTool` is unset. Also a fourth door exists, `enableLlmClassifier`. | Section 11 |
| 2 | "Skills activator options: `active`, `activateTool` default, `enableLlmClassifier` and its per-turn model call, refusal of an unheld name." | **True**, carried, with one rename: these are the built-in worker's `skills:` settings, not `createSkillActivator` options. They get their own table so the activator table is not polluted. The refusal comes on the first turn, not at hire. | Section 11 (second table) |
| 3 | "Skill: folder and naming rules, binding, activation." | **True**, carried: sections 3-5, 7, 9. | Sections 3, 5, 7, 9 |
| 4 | "Activator tiers and order: slash, then keywords, then classifier; an `evaluator` option replaces the default classifier in the third tier." | **True**, carried. Scope note: this is `createSkillActivator`. The built-in worker has no keyword tier (`enableKeywordMatch: false`), so its order is slash then (opt-in) classifier. | Section 9 |
| 5 | "`skillEvaluator(model)` and `skillQuestions`: the single choice question it builds (a skill or none), and the export to use for a hand-built evaluator." | **True**, carried. It also has a `recentMessages` option, which the row omits. | Section 10 |
| 6 | "Activator evaluator semantics: slash and keyword matches win; the pick is final with no confidence threshold, so it works on models that report none; 'no skill' activates nothing; an evaluator error fails the activator with no fallback to the default classifier, and `.rescue` is the way to continue without a skill." | **True**, carried. Pinned by `T/sae:254,333,357,408,433-474`. Scope: "slash and keyword matches win" is for `createSkillActivator`; the worker has no keyword tier. | Section 10 |

Dropped: nothing. Left off the page by choice (mechanism, not observable): the two-binding, two-activator construction inside the built-in worker flow (`aflow:1020-1056`); the weak-map seeding sentinel; `ActivationLocation` internals; why `.default({})` is on the config schema.

## 15. Not for the page, and open points for the writer

- Not stated: why the name rule is ASCII beyond the one observable consequence; the reasons `fork` and `pattern` modes are gone (the page says only that `inline` is the one mode and other values warn); the seeding sentinel, the two-binding construction, the loader being a control and not a catalog tool beyond the one-line fact.
- Internal exports a reader cannot import and the page should not name: `validateSkillName`, `substitute`, `NO_SKILL`, `createLoadSkillTool`, `buildSkillBindingReader`, `ensureSeeded`, `listOfferedSkills` (`O/index.ts` has no export for any of these; the worker flow imports some from `@flow-state-dev/orchestration/internal`, `aflow:79`).
- The page can reference by name (not re-explain): the discovery door, `fundamentals/capabilities#capability-tools` for the generator-side tool fence, the Workforce layout page for where a worker's folders sit, R-28 for the rest of a worker's settings.
- The three-tier order is `createSkillActivator`'s. A page that also covers a worker should say in one line that a worker's tiers are slash, then the opt-in classifier.
- The first example a reader needs is a minimal `SKILL.md` with `name`, `description`, `keywords` and `when_to_use`, then `createSkillsLibrary` + `readSkillsDirectory` + `.with({ active })`. The kept example app is `examples/guides/routing-with-evaluators` (three skills under `src/skills/`); use `openai/gpt-6-luna` in any model string, as that guide's `models.ts` does not need citing.

## Revision round 1

- `context` other than `inline` cannot come from the parser: `skmd:292-298` resets any other value to `inline` with a warning. The renderer and the load tool still check a stored `contextMode` (`rsb:94`; `ld:152`), so only an edited stored copy can hold another value. **[source]**
- The evaluator tier writes `source: "classifier"` (`evt:117`); no separate evaluator source exists. **[source]**
- `$ARGUMENTS` for a classifier match is the `input` the classifier returned for that match (section 9 tier 3); empty for keyword and evaluator matches and for `active`.
- `loadSkill` refuses in six cases: naming rules, a collection not registered on the block, outside `allowed`, `Unknown skill`, `disable-model-invocation`, a stored non-inline `contextMode`.
- `allowed` does not filter what an `activeState` field holds; the activator's `allowed` does.
- The discovery door is the `discover` tool (`apps/docs/docs/orchestration/discovery.md`); `skillsManifestSource` feeds its `skills` domain.
- Moved off this page: worker folder levels and the same-name-at-two-levels refusal (to R-29 `workforce-folder`), worker skill-set assembly, the `defineAgentWorkerFlow({ skills })` collision and per-user copies (to R-25 `workforce`), the worker `skills:` keys and tiers (now a subsection of R-28 `worker-md`, "The `skills` block"). The `scope:` refusal in a worker's skill file moves with the folder rules (R-29). The page keeps a three-link pointer; the facts above remain the source for R-25 and R-29.
