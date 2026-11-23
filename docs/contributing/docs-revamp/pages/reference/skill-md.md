---
title: SKILL.md and skills options
type: reference
description: "Every SKILL.md frontmatter field, the folder and naming rules, the options of the skills library, capability and activator, and what decides that a skill matches."
---

# SKILL.md and skills options

A skill is a folder holding a `SKILL.md` file: a short description of when it applies, and instructions the model follows once it does. Skills exist so an app can keep many procedures out of the prompt and put one in only when a message calls for it. The description is always visible to whatever picks a skill. The body is added to the prompt when the skill activates.

The examples use a support app with three skills under `src/skills/`: `refund-request`, `plan-change` and `outage-status`.

```md title="src/skills/refund-request/SKILL.md"
---
description: Walk a customer through getting money back for a charge they didn't expect, including duplicate charges and charges after cancelling.
when_to_use: The customer wants their money back or disputes a charge.
keywords: [refund]
---

Confirm which charge the customer means, check whether it is a duplicate or came after a cancellation, and explain how long the money takes to come back.
```

```ts title="src/flows/support/skills.ts"
import path from "node:path";
import {
  createSkillsLibrary,
  readSkillsDirectory,
} from "@flow-state-dev/orchestration";

export const { skills: initialSkills, errors } = await readSkillsDirectory(
  path.resolve("src/skills"),
);
for (const { name, error } of errors) console.warn(`skill "${name}":`, error.message);

export const skills = createSkillsLibrary({ initialSkills });
```

All imports on this page come from `@flow-state-dev/orchestration`.

## Frontmatter fields

The file starts with `---` as its first characters, YAML settings, a closing `---` line, then the body. A leading blank line or byte-order mark, a missing closing fence or an empty block throws ``SKILL.md must begin with YAML frontmatter (--- delimited) including a `description` ``. The skill's name is its folder name.

`parseSkillMd(text)` returns `{ state, body, warnings }`. A wrong type for most fields returns a warning and drops the field. An error throws. `readSkillsDirectory` keeps errors and discards warnings, so call `parseSkillMd` yourself to see them.

| Key | Type | Rule | Bad value |
| --- | --- | --- | --- |
| `description` (required) | string | Not empty, at most 1024 characters, no XML tag (`<a>`; `a < b` passes). Shown to the model wherever skills are listed or picked. | Error |
| `name` | string | A valid [name](#which-names-are-refused). Must equal the folder name. | Error |
| `license` | string | Stored. Nothing renders it. | Warning, dropped |
| `compatibility` | string | At most 500 characters. Stored. | Non-string: warning. Over 500: error |
| `metadata` | map of string to string | Numbers and booleans become strings. A nested value is dropped with a warning naming `metadata.<key>`. Stored. | Not a map: warning, dropped |
| `allowed-tools` | list, or a string split on spaces and commas | Tool names the skill needs. Checked against the library's `catalog`. Shown to the model as a note. Grants nothing. | Warning, dropped |
| `context` | `inline` | The only value. Omitted means `inline`. | Any other value: warning, defaults to `inline` |
| `disable-model-invocation` | boolean | `true` keeps the skill in the collection and takes it out of every activation path, including `with({ active })`. | A non-boolean (`yes`, `"true"`) is ignored with no warning |
| `when_to_use` | string | **Spelled with underscores.** Added on its own line after `description` wherever skills are listed. | A non-string is ignored. `when-to-use` is kept as an unknown key and does nothing |
| `argument-hint` | string | Stored. Nothing reads it. | A non-string is ignored |
| `keywords` | list of strings, or a comma-separated string | Lowercased. A string is trimmed and empty pieces dropped. A list is not trimmed, and an empty string stays: `keywords: [""]` matches every message. Used by the keyword tier. | Warning, dropped |

Any other key is kept and written back by `serializeSkillMd`, with no error. `paths`, `hooks`, `shell`, `model` and `effort` are kept and add a warning ``SKILL.md field `<key>` is preserved but not honored at runtime``. `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are fields of the [Agent Skills](https://agentskills.io/specification) format. The rest are this framework's.

The parser reads a YAML subset shared with `WORKER.md`: `key: value`, inline and block lists, nested maps, `|` and `>` blocks (a `|` block keeps its final newline, `|-` and `>-` strip it), quoted strings without escapes, typed booleans, `null` and numbers. A trailing `# comment` after a value is part of the value. A repeated key takes its last value. CRLF line endings work.

### Body substitutions

When a skill activates, its body is added to the prompt inside `<active_skill name="<name>">`, followed by an `allowed-tools` note when the list is not empty. These are replaced, in this order:

| Token | Becomes |
| --- | --- |
| `${SKILL_DIR}`, `${CLAUDE_SKILL_DIR}` | `/workspace/<prefix>/<skill name>`, where `prefix` is the collection's `prefix`. That path exists only when a bash capability mounts the collection. |
| `$ARGUMENTS` | The activation's input: the text after `/<name> ` for a slash, the `input` the model passed to the load tool or `runSkill`, the input the classifier returned for a classifier match. Empty for a keyword or evaluator match, and for a skill in `active`. |
| `$1` to `$9` | The whitespace-split words of that input. A missing word is empty. |

A skill whose stored `SKILL.md` sets `disable-model-invocation: true`, or a `context` other than `inline`, renders nothing even when it is listed in `active`. Only an edited stored copy can have a `context` other than `inline`: the parser always resets it.

## Folder rules

`readSkillsDirectory(root, { include?, exclude?, ignore? })` returns `{ skills, errors }`. It is async and Node-only. A skill is `{ name, skillMd, files? }`, and `files` are `{ path, content }`. It reads only the direct children of `root`, as `<root>/<skill>/SKILL.md`.

| Case | Result |
| --- | --- |
| `root` missing or unreadable | Throws `Failed to read skills directory "<root>": <reason>` |
| One skill fails | Added to `errors`; the others load |
| A child that is a regular file, or any other entry that is not a folder or a symlink | Skipped, no error |
| Folder name breaks the naming rules (`.git`, `Bad`, `node_modules`) | One error per folder, unless named in `exclude` or `ignore` |
| Child is a symlink, to a folder or a file | Error `Symlinked skill folder "<name>" — ignored for safety`, even when `include` or `exclude` would have left it out |
| `SKILL.md` is a symlink | Error `Symlinked SKILL.md in "<name>/" — ignored for safety` |
| `SKILL.md` absent | Error `Missing SKILL.md in "<name>/"` |
| `SKILL.md` unreadable, or a directory | Error `SKILL.md in "<name>/" could not be read: <reason>` |
| Frontmatter does not parse, or `name:` differs from the folder | The parse error |
| A symlink inside the folder, at any depth | Skipped silently |
| `include: [names]` | Only those folders |
| `exclude: [names]` | Those folders are skipped |
| `ignore: [names]` | Exact file and folder names, at any depth, added to the defaults `.DS_Store` and `Thumbs.db`. Not globs: `"*.swp"` matches nothing. |

Every file under the folder other than the root `SKILL.md` is a supporting file, at any depth, read as UTF-8 and stored by its `/`-separated path. `scripts/`, `references/` and `assets/` are conventional names, and no layout is required. A `..` segment in a path throws. Do not name a supporting file `SKILL.md` in a subfolder: the collection lists it as a skill named after its folder, and it cannot be loaded.

## Which names are refused?

A name is checked in this order, and the first failure is the error. The same rules apply to a folder name, a `name:` key, a bundled skill and the name the model passes to the load tool.

| Refused | Message |
| --- | --- |
| Empty, or not a string | `Skill name must be a non-empty string` |
| More than 64 characters (64 is allowed) | `Skill name "<name>" exceeds 64 chars` |
| `_meta` | `Skill name "<name>" is reserved` |
| Not matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`: uppercase, `_`, `.`, spaces, non-ASCII letters, a leading, trailing or doubled hyphen | `Skill name "<name>" must be lowercase letters, digits, and single hyphens (not at the start or end)` |
| A Windows device name in lowercase: `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9` | `Skill name "<name>" is a reserved device name on Windows` |

`CON` fails the pattern row, with that row's message. `com0` and `lpt0` pass. The name must be ASCII because it is also a resource key, a `/slash` command and a mount path.

Where the refusal shows up:

- `readSkillsDirectory`: an entry in `errors`.
- A `name:` key: `parseSkillMd` throws.
- Seeding a bundled skill: the skill is skipped, with `console.warn("[skills] skipped initial skill: ...")`.
- `createSkillsLibrary`: the bundled skill is left out, so `with({ active: ["BadName"] })` fails as an unknown skill.
- The load tool and `runSkill`: the naming error comes back instead of "Unknown skill".
- The slash tier: no error. The message does not match and falls through.

## Stored skills

A skill folder is read when your code calls `readSkillsDirectory`. In a running app each skill becomes a copy in a resource collection, and the model reads the copy.

| | |
| --- | --- |
| Owner | Whoever holds the collection's scope: the org by default, one user at `scope: "user"`, one session at `"session"`. An edit to a copy is that holder's own. |
| Visible to | Everyone in that scope. On a [store that persists](../concepts/persistence.md) copies survive a restart. A client can read, create, update and delete entries. Its snapshot carries `description`, `disableModelInvocation` and, when present, `allowedTools`, `contextMode`, `keywords` and `seededAt`. |
| Stored | One key per file: `skills/<name>/SKILL.md` and `skills/<name>/<path>`, with `skills` the `prefix`. With `partitionBy`, `skills/<partition>/<name>/...`. |
| How many | One set per scope holder, per partition, and per flow copy under `flowIsolation`. No cap unless `maxInstances` is set. |

Seeding writes the bundled skills into a collection on its first use, once per collection per process: the first render of a binding, the first call of the load tool or `runSkill`, the activator's seed step, or the first read by the `discover` tool's skills source. It never puts back a skill a holder deleted and never removes a file the source dropped. A folder added to the source is copied on the next read. It leaves an edited copy alone, with one exception: a skill already seeded is written again from the source when its stored `contextMode` is set and is not `inline`, or when the source `SKILL.md` declares a `context` that differs from the stored `contextMode`. A later change to the folder on disk does not reach a collection that already holds the skill.

| Call | Does |
| --- | --- |
| `refreshSeededSkills(collection, sources)` | For each name present in the collection, writes the source and deletes every file in that skill's folder the source lacks. A file the holder added there is lost. A deleted skill is skipped. Returns `{ refreshed, skipped, removed, failed }`. |
| `importSkillsDirectory(root, collection, { overwrite })` | Reads a folder and writes each skill into a collection. A name already there is skipped and reported as `{ name, reason: "already exists" }`; `overwrite: true` replaces it. Returns `{ imported, skipped, errors }`. Does not delete dropped files. |

## Library options

`createSkillsLibrary(options?)` returns a capability named `skills`. Install it once with `uses: [skills]` and bind it to a generator with `skills.with({ ... })`.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `collection` | `string` | `"skills"` | Resource key of the collection. |
| `catalog` | tool map | `{}` | Tools skills may name in `allowed-tools`. A skill that a binding renders (named in `active` or `allowed`, or any bundled skill when `dynamicActivation` is on with no `allowed`) and that names a tool not in it fails the build: `skills: skill "<name>" declares tool "<key>", which is not in the catalog`. |
| `registerCatalogTools` | `boolean` | `true` | Whether a binding that renders skills puts the whole `catalog` on the generator. `false` checks `allowed-tools` and grants nothing. |
| `initialSkills` | `InitialSkill[]`, or `(ctx) => InitialSkill[] \| undefined` | none | Bundled skills, seeded on a binding's first render. A function is read on every render, so keep it a cheap read. With a function, `with({ active })` and `with({ allowed })` throw, since there is no list to check names against. |
| `scope` | `"org" \| "user" \| "session"` or a resource scope | `"org"` | Where the collection lives. |
| `collectionConfig` | `{ maxInstances?, prefix?, flowIsolation? }` | none | `maxInstances` caps manifests and files together. `prefix` is the key prefix and the mount path `${SKILL_DIR}` resolves under. `flowIsolation: true` gives each registered copy of the flow its own skill set; it is refused at `scope: "session"`. |
| `partitionBy` | `(ctx) => string \| undefined` | none | One skill set per partition. Return a non-empty string from data only the server writes. `undefined` means that run reads no skills and its writes throw. `""` or a non-string throws. |
| `itemVisibility` | visibility or list | none | Attaches the skills only to generators with a matching `itemVisibility`, or none set. `{ client: true, history: true }` keeps them off a generator marked `{ client: true, history: false }`; the `supervisor` pattern marks the generators it delegates to that way. |

A preset is a named switch on the library, set in the same `.with()` call as the binding options. `.with()` takes presets and binding keys in one object; any other key throws.

| Preset | Default | What it does |
| --- | --- | --- |
| `dynamicActivation` | off | Installs the `loadSkill` tool. A turn where the model loads a skill costs one extra model call. |
| `catalogContext` | on | Adds a `- name: description` listing of loadable skills to every prompt. `catalogContext: false` removes it. Has an effect only with `dynamicActivation`. |

### Binding options

`skills.with({ ... })` checks its keys strictly: a misspelled key throws at build time.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `active` | `string[]` | `[]` | Skills rendered into the prompt on every step. Each must be a bundled skill, or the build throws ``skills.with({ active: [...] }): unknown skill "<name>". Known skills: a, b.``. |
| `allowed` | `string[]` | all skills | The names the load tool may pull, and the listing shows. Checked like `active`. It does not filter what an `activeState` field holds; set the activator's `allowed` to the same list for that. |
| `activeState` | `{ scope: "request" \| "session" \| "user" \| "org", field: string }` | the generator's own block state, field `activeSkills` | Where activations are stored. Block state is private to the generator and lasts one request. A named scope shares across generators and, for `session`, `user` and `org`, across turns. An activator that runs before the generator must use one. `field` must not be empty. |

When the generator gets the catalog's tools:

| Binding | Catalog tools on the generator |
| --- | --- |
| `active` not empty | Yes, the whole `catalog` |
| `dynamicActivation: true` | Yes |
| `activeState` with `allowed` | Yes |
| `activeState` with neither `allowed` nor `dynamicActivation` | No; bodies written to the field render |
| Library built with `registerCatalogTools: false` | No |

A generator that declares `tools:` gets exactly what it names, except that `loadSkill` is never removed.

Skills render before every tool-loop step, so a skill the load tool writes appears on the next step of the same turn. The output begins `The following skills are active. Follow their instructions for the rest of this turn.` and is empty when nothing renders. A skill named in `active` and in `activeState` renders once. An activation is stored as `{ name, mode: "inline", input?, activatedAt, source? }`, with `source` one of `slash`, `keyword`, `classifier` or `manual-override`.

`loadSkill` takes `{ name, input? }` and returns `{ skill, mode, message }`. It refuses, as the tool's error: a name that fails the naming rules, a collection not registered on the block, a name outside `allowed` (`Skill "<name>" is not in this generator's allowed set. Allowed: a, b`), `Unknown skill "<name>". Available: a, b`, a skill with `disable-model-invocation: true`, and a skill whose stored `context` is not `inline`.

`skillsManifestSource({ collectionKey = "skills", allowed?, initialSkills? })` lists the loadable skills to the `discover` tool, which tells a worker what is in scope for it, with the description as each skill's `purpose`. Pass it the same `allowed` the binding has.

## Capability options

`createSkillsCapability(options?)` is the session-wide form, also named `skills`. Prefer `createSkillsLibrary`: the capability has no `partitionBy`, `flowIsolation` or function-form `initialSkills`. Using both on one generator fails the build on the duplicate `skills` collection key.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `collection` | `string` | `"skills"` | Resource key. |
| `catalog` | tool map | `{}` | Tools the `tools` preset registers. |
| `initialSkills` | `InitialSkill[]` | none | Seeded on the first `runSkill` call and the listing's first render. No function form. |
| `scope` | resource scope | `"org"` | Collection scope. |
| `collectionConfig` | `{ maxInstances?, prefix? }` | none | No `flowIsolation` or `partitionBy` here. |
| `itemVisibility` | visibility or list | none | Limits it to blocks with a matching `itemVisibility`. |

The `tools`, `context` (renders matched skill bodies; no skill appears without it) and `runSkill` (the `runSkill` tool, with a listing of every enabled skill) presets are on by default. Drop one with `.with({ runSkill: false })`. `.with()` and `.presets()` each replace the overrides the other set. Matches are written to a session state field `activeSkills`, which every generator in the session reads. The capability does not clear it between turns; an activator in front of the generator replaces it each turn.

A generator with its own `tools:` list gets only those, so it does not receive `runSkill`; `loadSkill` from the library is always delivered. `runSkill` takes `{ name, input? }`. It refuses a name that fails the naming rules, `Unknown skill "<name>". Available: ...` and a skill with `disable-model-invocation: true`.

## Activator options

`createSkillActivator(options?)` returns a block that passes its input through unchanged and reads `input.message`, which must be a string. Add it with `.tap()` before the generator.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | `"skill-activator"` | Block name. |
| `collectionKey` | `string` | `"skills"` | Collection to scan. |
| `initialSkills` | `InitialSkill[]` or a resolver | none | Seeds the collection before any tier reads it. Pass the library's value, or a fresh collection is empty on turn 1 and nothing matches. |
| `activeState` | `{ scope, field }` | `{ scope: "session", field: "activeSkills" }` | Where matches are written. Point it at a binding's `activeState` to feed that generator. |
| `allowed` | `string[]` | all skills | Limits every tier to these names. Set it to the binding's `allowed`. |
| `enableKeywordMatch` | `boolean` | `true` | `false` skips the keyword tier. |
| `enableLlmClassifier` | `boolean` | `true` | `false` skips the classifier tier, so there is no model call. Setting it to `false` alongside `evaluator` is refused. |
| `classifierModel` | `string` | `"intent/utility"` | Model of the classifier. Refused with `evaluator`. |
| `confidenceThreshold` | `number` | `0.65` | A classifier match is kept at or above this. Refused with `evaluator`. |
| `maxSkillsInClassifier` | `number` | `20` | Skills offered to the classifier or evaluator, in collection order. |
| `evaluator` | evaluator block | none | Runs the third tier on this block in place of the classifier. |

These options are refused at build time:

- `createSkillActivator: "evaluator" must be an evaluator block (got handler "a-handler"). Build one with skillEvaluator(model), or core's evaluator() with skillQuestions.`
- `createSkillActivator: "evaluator" can't be combined with <names>. Those options configure the generator classifier, which the evaluator replaces.`

## What decides that a skill matches?

A skill can match only if its `<name>/SKILL.md` is in the collection, it is in the activator's `allowed` when one is set, and it does not set `disable-model-invocation: true`. Then the tiers run in order, and the first that finds a match ends the turn's search. The activator then writes the result to `activeState`, replacing what was there, so a turn with no match clears the last turn's activations.

| Tier | Matches when | Model call |
| --- | --- | --- |
| 1 Slash | The message starts with `/<name>`, with an optional space and argument. A leading space makes it plain text. The name is `[a-z0-9][a-z0-9-]{0,63}`. The trimmed argument becomes the input. A name that is not allowed, not in the collection or disabled falls through without an error. | No |
| 2 Keyword | A keyword of the skill is a substring of the lowercased message. Every skill with a matching keyword activates, with empty input. A skill with no keywords is skipped. | No |
| 3 Classifier | The model returns the skill with a confidence at or above `confidenceThreshold`. It sees up to `maxSkillsInClassifier` skills as `- <name>: <description>`, with `when_to_use` on the next line, and may return several matches with an input each. Matches outside the allowed set or disabled are dropped. | One call |
| 3 Evaluator | The model picks one skill. See below. | One call |

Skills also become active outside the activator: `with({ active })` on every step, `loadSkill` when the model calls it, `runSkill` when the model calls it, and a worker's `skills.active`.

### Evaluator tier

`skillEvaluator(model, { recentMessages? })` returns an evaluator block named `skill-evaluator`. `model` is a model string or an evaluation model; a generate-only model is refused when you call it.

```ts title="src/flows/support/activator.ts"
import { createSkillActivator, skillEvaluator } from "@flow-state-dev/orchestration";
import { initialSkills } from "./skills";

export const activator = createSkillActivator({
  initialSkills,
  evaluator: skillEvaluator("openai/gpt-6-luna", { recentMessages: 2 }),
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `recentMessages` | `0` | How many earlier turns the model also sees, oldest first: user and assistant text only, within the session's history window. A negative, fractional or non-numeric value throws `skillEvaluator: "recentMessages" must be a non-negative integer (got <value>).` |

`skillQuestions` is the question the activator reads: one `skill` choice among the offered skills and a no-skill option. Pass it as `questions` to a hand-built `evaluator({ name, model, state, questions: skillQuestions })`. A hand-built evaluator that does not answer a `skill` question fails the activator with `Skill activator: evaluator "<name>" did not answer a "skill" choice question.`

- It runs only when the slash and keyword tiers matched nothing.
- With no offered skills, it is not called and nothing activates.
- The pick is final: no confidence threshold applies, so it works on models that report none. The activation has `source: "classifier"`, and the model's `confidence` when it gave one.
- The no-skill answer activates nothing. At most one skill activates, with empty input.
- A skill removed or disabled while the call ran does not activate.
- Any evaluator failure fails the activator. There is no fallback to the classifier. Writing the activations is the activator's last step, so a failure writes nothing and the earlier activations stay in the `activeState` field (session `activeSkills` by default). Wrapping the activator in `.rescue` carries on without a new pick. To carry on with no skill, the rescue block clears that field.

## Worker skills

A worker's skills come from `SKILL.md` folders at three levels (the org, the team, the worker), and its `skills:` block in `WORKER.md` or a hire sets which are always in context, whether the model gets the load tool, and whether the classifier tier runs. The worker's tiers are slash, which always runs, and the classifier when enabled; there is no keyword tier.

- Folder levels, and the refusal of the same name at two levels: [The workforce folder](./workforce-folder.md).
- Skill-set assembly, the `defineAgentWorkerFlow({ skills })` collision and per-user copies: [Workforce](./workforce.md).
- The `skills:` keys and the worker's tiers: [`WORKER.md`](./worker-md.md#settings-of-the-agent-flow).
