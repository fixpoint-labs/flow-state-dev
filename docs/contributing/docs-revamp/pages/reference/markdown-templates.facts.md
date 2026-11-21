# Facts for Prompt and resource templates (R-31, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, and `goals/`. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a record row of another page was carried here, the row's page is named and the row was checked against the code. **[source]** marks a fact read from code where no test or exported doc comment pins it. **[test]** marks a fact a test pins. **[doc]** marks a fact the existing user docs state and the code agrees with.

Paths are from the repo root. Abbreviations:

- `pf` = `packages/core/src/prompt/prompt-file.ts`, `df` = `packages/core/src/prompt/default-filters.ts`, `rt` = `packages/core/src/markdown/role-tagged.ts`
- `rtp` = `packages/core/src/resource-template/resource-template.ts`, `res` = `packages/core/src/types/resource.ts`
- `pl` = `packages/engine/src/prompt-file-loader.ts`, `rl` = `packages/engine/src/resource-template-loader.ts`, `rr` = `packages/engine/src/context/resource-registry.ts`, `cp` = `packages/engine/src/resources/content-paths.ts`, `ec` = `packages/engine/src/context/createExecutionContext.ts`, `rro` = `packages/engine/src/routes/resource-routes.ts`, `ri` = `packages/engine/src/resources/internal.ts`
- `ma` = `packages/core/src/blocks/internal/message-assembly.ts`, `gen` = `packages/core/src/blocks/generator.ts`
- `pft` = `packages/core/test/prompt-file.test.ts`, `gpt` = `packages/core/test/generator-prompt-file.test.ts`, `rtt` = `packages/core/test/resource-template.test.ts`, `rlt` = `packages/engine/test/resource-template-loader.test.ts`, `fence` = `packages/engine/test/template-ref-owner-fence.test.ts`
- `gp` = `apps/docs/docs/advanced/generator-prompts-markdown.md` (the page today), `rp` = `apps/docs/docs/advanced/resource-templates-markdown.md`

## What the page is

A Reference page: tables and lookups, no narrative, no word budget. The plan names three tables (frontmatter fields, variables, how a template is found) and one lookup, "What happens when a variable is missing?". It covers two kinds of template file that share one format: a prompt file (a generator's prompt) and a resource template (a resource's content). Sections 1 to 8 are the prompt file, 9 to 12 the resource template, 13 the stored-part answers, 14 the rows other pages moved here.

## 1. The file format (both kinds)

- A template is a `.md` file: YAML frontmatter between `---` fences, then a body. `rt:54-81` (gray-matter parse, then section split). **[source]** `[doc]` `gp:18-45`.
- Three section tags are recognised: `system`, `user`, `context` (`rt:12`). A tag counts only when it starts a line (`^<tag>` with the `m` flag) and closes with `</tag>` (`rt:37`). **[source]**
- Each tag may appear at most once; a second one throws "Multiple <tag> blocks found; at most one is allowed." (`rt:39-43`). **[test]** `pft:116` (duplicate `<system>`). The parse error is wrapped as `PromptFileParseError` for prompt files (`pf:259-262`) and `ResourceTemplateParseError` for resource templates (`rtp:140-143`).
- Leading and trailing newlines inside a section are trimmed (`rt:46`). **[source]**
- Text outside the recognised tags is ignored in a prompt file. **[test]** `pft:122`.
- Section splitting happens only in the top-level file. Section tags inside a partial are literal text. `[doc]` `gp:137`; consistent with `rt` being called once, on the top-level text (`pf:257`, `rtp:138`). **[source]**
- Body language is LiquidJS: `{{ expression }}` output and `{% tag %}` logic (`pf:20`, `rtp:14`). `[doc]` `gp:49-56`.

## 2. Frontmatter fields

### Prompt file (strict)

- Allowed keys: `name`, `description`, `intent`, `model`, `caching`, `maxTokens`, `temperature`. The schema is `.strict()`, so any other key fails (`pf:60-70`). **[test]** `pft:41` (all known fields), `pft:63` (unknown rejected). The failure is a `PromptFileParseError` with message `Invalid frontmatter: <path>: <issue>; ...` (`pf:265-273`). `<path>` is the Zod issue path inside the frontmatter (`i.path.join(".")`), `(root)` when empty; an unknown key gives `Invalid frontmatter: (root): Unrecognized key(s) in object: 'x'`. The file path is on `sourcePath`, not in the message. **[source]**
- `name`: string, at least one character (`pf:62`).
- `description`: string, at most 1024 characters (`pf:63`).
- `intent`: string (`pf:64`). Read back as `config.intent` in templates (`gen:3113`, `pf:84-85`). `[doc]` `gp:23,293`.
- `model`: string (`pf:65`). Metadata only. The generator's model comes from its own `model` slot. `[doc]` `gp:24,45,294`. Template-side, `config.model` is the resolved model id, not the frontmatter value (`gen:3112`, `pf:82-83`). **[source]**
- `caching`: `true`, `false`, or an object with optional `enabled` (boolean), `breakpoints` (`"auto"` or `"manual"`) and `ttl` (`"5m"` or `"1h"`); unknown keys inside the object fail (`pf:50-56,66`). **[test]** `pft:72` (object form accepted), `pft:82` (a bare string is rejected).
- `maxTokens`: positive integer (`pf:67`).
- `temperature`: number from 0 to 2 (`pf:68`).
- Omitted frontmatter is allowed: `data` falls back to `{}` (`rt:76`). **[source]**
- `definePromptFile` turns `caching: true|false` into `{ enabled: true|false }`; an object passes through unchanged (`pf:446-453`). **[source]**

### Resource template (loose)

- Recognised keys: `name` (string, at least one character) and `description` (string, at most 1024). The schema is `.passthrough()`, so other keys are accepted and ignored (`rtp:27-32`). **[test]** `rtt:50` (unknown keys ignored).
- The generator-only keys `model`, `intent`, `caching`, `maxTokens`, `temperature` are accepted, listed in the template's `inertKeys`, and warned about once at parse time outside production: `[resource-template] Generator-only frontmatter keys ignored in resource context: ...` (`rtp:34-40,156-168`). **[test]** `rtt:35` (`inertKeys` holds `model`, `temperature`, not `name`).
- The warning is skipped when `process.env.NODE_ENV === "production"` (`rtp:163`). **[source]**

## 3. Sections: what each kind does with them

| Section | Prompt file | Resource template |
| --- | --- | --- |
| `<system>` | Required, and must not be blank. Becomes the generator's `prompt` (`pf:280-288,393-394`). | Becomes the content. When absent, the whole post-frontmatter body, trimmed, is the content (`rtp:170-171`). **[test]** `rtt:26`. |
| `<user>` | Optional. Becomes the generator's `user` slot (`pf:400-403`). | Parsed, ignored, warned about outside production (`rtp:173-178`). **[test]** `rtt:61`. |
| `<context>` | Optional. Switches on context override mode (section 5). | Parsed, ignored, warned about outside production (`rtp:179-184`). **[test]** `rtt:61`. |

- A prompt file with no `<system>` fails with `<system> block required; file appears to be empty.` (`pf:280-285`). A blank `<system>` fails with `<system> block is empty.` (`pf:286-288`). **[test]** `pft:108,112`.
- A resource template with an empty body renders as the empty string. **[test]** `rtt:128`.

## 4. Variables a template can read

### Prompt file: `<system>`, `<user>`, `<context>`

Three top-level variables (`pf:358-362`, `pf:95-101`). **[test]** `pft:130,167`.

| Variable | What it is | Source |
| --- | --- | --- |
| `input` | The generator's typed input, the same value a TypeScript `prompt` function receives. | `pf:97-98`, `ma:179-181`. `[doc]` `gp:64`. |
| `ctx` | The block context. `ctx.request`, `ctx.session`, `ctx.user` each have `.state`; `ctx.resources.<name>`; `ctx.cap.<name>`. | `packages/core/src/types/block.ts:352-354,411,479`. `[doc]` `gp:65`. **[test]** `pft:151` (`ctx` state in a conditional). |
| `config` | The resolved generator configuration, read-only. | `pf:75-93`, `gen:3111-3123`, `ma:177-181`. |

- Async accessors work in a template, because rendering is asynchronous (`pf:357-364`, `engine.render`). `[doc]` `gp:65`. **[source]**
- When a prompt file is called with no config (outside a generator), `config` is `{ context: {} }` (`pf:391,393-394`). **[source]**
- Nothing else is in scope: `{ input, ctx, config }` only (`pf:358-362`). **[source]**

`config` fields (`pf:78-93`, `gen:3111-3123`):

| Field | Meaning |
| --- | --- |
| `config.context` | The aggregated context map, `Record<string, string>`, keyed by XML tag name. It is built from the generator's `context:` slot plus every capability contribution, after normalisation (`ma:177-180`; `pf:79-81`). |
| `config.model` | Resolved concrete model id. |
| `config.intent` | The intent string, taken from the file's frontmatter `intent` (`gen:3113`). |
| `config.tools` | Resolved tool names (`gen:3114`). |
| `config.caching` | Resolved caching config (`gen:3115`). |
| `config.maxTokens` | Resolved max tokens, read from the generator's resolved config, so an override written after the spread wins (`gen:3116`). |
| `config.temperature` | Resolved temperature. An override written after the spread wins over the frontmatter value (`gen:3117-3121`). **[test]** `gpt:228`. |
| `config.providerOptions` | Provider-specific options (`gen:3122`). |

- `config.context` is the aggregated map; the TypeScript `context:` slot is where entries are authored. A template reads the first and cannot write the second. `[doc]` `gp:68-76`.

### Resource template

| Variable | What it is | Source |
| --- | --- | --- |
| `state` | The resource's current state object. | `rtp:245` (`{ state }`). **[test]** `rtt:94`. `[doc]` `rp:400-406`. |

- `state` is the only top-level variable. No `ctx`, `input`, `config`, session state or other resources (`rtp:245`). `[doc]` `rp:498-504`.
- Nested objects and arrays are readable: `{% for item in state.items %}` **[test]** `rtt:100`; nested objects **[test]** `rtt:137`.

## 5. The `<context>` section (prompt file only)

- Without a `<context>` section, the framework appends the aggregated context as XML tags after the rendered `<system>`, separated by a blank line (`ma:193-195,203-206`). **[test]** `gpt:47`. A template may read `config.context` inside `<system>` without changing that append. `[doc]` `gp:100`.
- With a `<context>` section, the default append is suppressed. The rendered section is wrapped as `<context>\n...\n</context>` and takes the append's place (`ma:186-188`). **[test]** `gpt:67`.
- A key the `<context>` section does not render is dropped. The section reorders and prunes the computed map; it adds nothing (`ma:186-188`). **[test]** `gpt:89` (capability-contributed keys dropped). `[doc]` `gp:105-106`.
- Context entries are still declared on the generator's `context:` slot and by capabilities; the template only positions them (`ma:177-180`, `gen:3124`). **[source]**
- The `<context>` section renders leniently (see the lookup, section 6). **[test]** `pft:343`.

## 6. Lookup: What happens when a variable is missing?

Prompt file (`pf:290-317`, comment at `pf:290-296`):

| Where | Missing `input`/`ctx`/`config` path | Mechanism |
| --- | --- | --- |
| `<system>` | Throws at render time. | `strictVariables: true` (`pf:298-300`). **[test]** `pft:141` (unknown variable), `pft:359` (absent `ctx` path). |
| `<user>` | Throws at render time. | Same engine as `<system>` (`pf:352,368`). **[source]** |
| `<context>` | Renders as empty and does not throw. A `{% if config.context.absent %}` test skips cleanly. | `strictVariables: false` (`pf:308-311`). **[test]** `pft:343`. |

- The thrown error carries the text "undefined variable" (`pft:144,361` assert `/undefined variable/i`), and propagates through the generator's normal error path at run time. `[doc]` `gp:347`. The error is not a `PromptFileParseError`; it is raised during `render`, so the call that renders (the generator run) fails, not the load (`pf:357-364`). **[source]**
- `default` does not rescue an absent property in `<system>` or `<user>`: under `strictVariables: true` an absent `input.note` throws `undefined variable` before the filter runs, and a bare `{% if input.q %}` on an absent key throws too (`pf:298-300`). Checked by running `parsePromptFile` with `{{ input.note | default: "none" }}` and an input without `note`. `default` replaces a present `null` value (**[test]** `pft:146` passes `{ notes: null }`). In `<context>` (lenient) and in a resource template (`lenientIf: true`, `rtp:237`; **[test]** `rtt:108`) an absent property is tolerated.
- The lenient setting covers every variable in a `<context>` section, not only `config.context` keys: the engine is built with `strictVariables: false` and receives the same `{ input, ctx, config }` (`pf:308-311,358-362`). **[source]**
- An unknown filter is always a parse-time error, in every section, because both engines set `strictFilters: true` (`pf:301,311`). **[test]** `pft:159`; for `<context>` too, per the comment at `pf:293-296`. A reference to a partial that is not registered also fails at parse time (section 8).
- `fsd_json` on an absent value in `<context>` renders `null`, so the fenced block stays valid JSON (`df:57`, comment `df:38-41`). **[test]** `pft:235`.

Resource template (`rtp:232-251`):

- A reference to a property that does not exist on `state` throws `ResourceTemplateRenderError` at render, with message `Template render failed: <cause>` (`rtp:232-236,245-249`; `strictVariables: true`). **[test]** `rtt:116`. `[doc]` `rp:408`.
- Render happens on every `readContent()` call, so the failure surfaces on the read, not at definition time (`rr:2270-2271`). **[source]**
- `lenientIf: true`: a test such as `{% if state.missing %}` on an absent property does not throw (`rtp:237`). **[source]** Not pinned by a test in `rtt`; the option is set in code. Say so in a clause only if the page states it.
- Optional values use `| default: "..."`, which covers an absent property here. **[test]** `rtt:108`. `[doc]` `rp:410-412`.
- Prototype properties are unreachable: `{{ state.constructor }}` throws `ResourceTemplateRenderError` (`rtp:235`, `ownPropertyOnly: true`). **[test]** `rtt:123`. `[doc]` `rp:501`.
- At parse time the resource template is compiled with `strictVariables: false` and `strictFilters: true` (`rtp:190-197`). A syntax error throws `ResourceTemplateParseError` with `Template compile failed: <cause>` (`rtp:198-203`). **[test]** `rtt:86`. An unknown filter is therefore caught at parse, not at render. **[source]**

## 7. Built-in filters (prompt file)

Four filters are registered on every prompt file's `<system>`, `<user>` and `<context>` engines (`df:42-58`, `pf:320-324`). **[test]** `pft:136,204-265`.

| Filter | Input | Output | Source |
| --- | --- | --- | --- |
| `fsd_keyValues` | an object | `key: value` lines, one per entry. `null` or `undefined` renders as empty; a non-object renders as `String(value)`. | `df:43-47`. **[test]** `pft:204`. |
| `fsd_list` | an array | A bullet list. Pass `"ordered"` for a numbered list. A scalar is wrapped as one item; `null`/`undefined` gives an empty list. | `df:19-29,48-49`. **[test]** `pft:210`. |
| `fsd_table` | an array of records | A Markdown table. Extra arguments name the columns, in order. A non-array renders as the empty string. | `df:50-56`. **[test]** `pft:220`. |
| `fsd_json` | any value | A fenced json code block, pretty-printed with two-space indent. An undefined value renders as `null`. | `df:57`. **[test]** `pft:229,235`. |

- Usage: `{{ items | fsd_list: "ordered" }}`, `{{ rows | fsd_table: "ticker", "qty" }}` (`pft:210-225`). `[doc]` `gp:160`.
- They expose the same vocabulary as the prompt formatters `keyValues`, `list`, `table` from `@flow-state-dev/core/prompt` (`df:5-9,16`). `[doc]` `gp:141`.
- Filters are merged built-ins first, caller filters second, so a caller filter of the same name replaces a built-in (`pf:320`). **[test]** `pft:188,248`.
- The four are also available inside `<context>`. **[test]** `pft:255`.
- Resource templates do not register the `fsd_` filters or take a `filters` option: `renderResourceTemplate` builds a Liquid engine with no `registerFilter` call and `parseResourceTemplate` accepts only `sourcePath` and `partials` (`rtp:123-126,232-242`). **[source]** LiquidJS's own built-in filters work (`default`, `join`: `rtt:108`; `rp:406`).

### Custom filters (prompt file)

- Register per file with the `filters` option on `loadPromptFile`, `parsePromptFile` or a loader's call: `{ filters: { format_usd: (n) => ... } }` (`pf:173-178`, `pl:129-132`). **[test]** `pft:181`. `[doc]` `gp:166-172`.
- A filter is `(input, ...args) => unknown`, and may return a Promise (`pf:37-39`). `PromptFileFilter` types `input` as `unknown`, so the page's example takes `(n)` and calls `Number(n)`; `(n: number) => ...` does not type-check. **[test]** `pft:195` (async). `[doc]` `gp:174`.
- Filters are scoped to the file; there is no global registry (`pf:290,320-324`, engines built per `parsePromptFile` call). `[doc]` `gp:174`.
- `createPromptLoader` merges `{ ...loaderFilters, ...perCallFilters }`, so a per-call filter wins (`pl:266-270`). `[doc]` `gp:221`.

## 8. How a template is found

### Prompt file: loading

All loader functions: `@flow-state-dev/engine/prompt-file` (`packages/engine/package.json:47-50`). The parser and `definePromptFile`: `@flow-state-dev/core/prompt-file` (`packages/core/package.json:59-62`). `[doc]` `gp:190,239` (the page says "the `/node` subpath" at `gp:235`, which is not an export; the engine subpath is `prompt-file`).

| Function | Signature | What it does | Source |
| --- | --- | --- | --- |
| `loadPromptFile(specifier, importerUrl, options?)` | `options`: `{ filters?, partialsDir? }` | Reads the file, registers partials, returns a `PromptFile`. Node only. | `pl:179-206` |
| `createPromptLoader(baseDir, options?)` | `options`: `{ partialsDir?, filters? }`; returns `(relPath, perCall?: { filters? }) => PromptFile` | Captures a base directory and shared options once. | `pl:208-276` |
| `parsePromptFile(text, options?)` | `options`: `{ sourcePath?, filters?, partials? }` | Isomorphic. Takes raw text and an explicit partials map. | `pf:172-181,248-251` |
| `resolveBaseDir(candidates, options?)` | `options`: `{ expect? }` | First candidate directory that exists and, when `expect` is given, contains that relative path. | `pl:52-127` |
| `moduleDir(importerUrl, relative = ".")` | returns `string \| undefined` | Directory of the calling module, optionally walked by `relative`. `undefined` when the URL is not a `file:` URL. | `pl:26-50` |
| `definePromptFile(pf)` | returns the spreadable config | See section 11. | `pf:437-457` |

- **Specifier resolution** (`pl:184-186`): an absolute `specifier` is used as-is and `importerUrl` is ignored. A relative one resolves against `importerUrl` (`new URL(specifier, importerUrl)`). Resolution never uses the working directory. `[doc]` `gp:225-231`.
- **`createPromptLoader`**: `baseDir` must be absolute, else it throws `TypeError` "createPromptLoader: baseDir must be an absolute path" (`pl:259-264`). `relPath` is joined onto `baseDir` (`pl:271`). `[doc]` `gp:221`.
- **`resolveBaseDir`**: skips `undefined` candidates; throws `TypeError` first if any defined candidate is not absolute; returns the first candidate that exists, is a directory, and contains `expect` when given; when none qualifies throws an `Error` listing every candidate and why it was rejected (`pl:86-126`). With `expect` omitted any existing directory qualifies (`pl:53-61`).
- **Error on a missing file**: `PromptFileLoadError` with message `Failed to read prompt file "<specifier>": <cause>` and `sourcePath` (`pl:188-196`). `[doc]` `gp:345`.
- **Browser or bundled** (no `node:fs`): import the raw text (Vite `?raw`) and call `parsePromptFile(text, { sourcePath, partials })`; the loader module must not be imported there (`pl:6-13`, `pf:10-13`). `[doc]` `gp:235-245`. **[test]** `pft:271` (explicit `partials`).
- **Base directory per runtime** (`pl:26-37,64-85`, `pl:244-252`): under Node, tsx and vitest `import.meta.url` is a `file:` URL, so a module-relative candidate works from any working directory. Under bundlers that rewrite `import.meta.url` (the doc comment names Turbopack and Next.js), `moduleDir` returns `undefined`, so the fallback is a `process.cwd()`-derived candidate, which Next.js dev and build pin to the app package. `[doc]` `gp:233`. The existing page does not name `fsdev run` and no source comment does; do not state a claim about it.
- Idiom (`pl:233-242`, `gp:209-219`): `resolveBaseDir([moduleDir(import.meta.url, "./prompts"), path.resolve(process.cwd(), "src/prompts")], { expect: "_partials" })`.

### Prompt file: partials

A partial is a reusable fragment a template pulls in.

- `{% render 'name' %}` renders in an isolated scope: the partial does not see the caller's variables. **[test]** `pft:284`. `{% include 'name' %}` renders in the caller's scope. `[doc]` `gp:127-128`; the tag semantics are LiquidJS's.
- Node: `loadPromptFile` reads every `.md` file in the partials directory except the prompt file itself, and registers it under its filename without `.md` (`pl:143-160`). **[test]** `pft:271` for the map form; the sibling scan has no test in `packages/engine/test/prompt-file-loader.test.ts` listed here, so it is **[source]**.
- The partials directory is the prompt file's own directory unless `partialsDir` is given. With `partialsDir`, the directory scanned is that one alone; the prompt's own directory is then not scanned (`pl:198-199`). **[source]**
- `createPromptLoader`'s `partialsDir` applies to every prompt the loader reads; its default is each prompt's own directory (`pl:210-215`).
- Only direct children are read, `.md` files only, non-recursive (`pl:154-157`). **[source]** An unreadable or missing directory gives no partials rather than an error (`pl:146-152`).
- Browser: pass the `partials` map explicitly (`pf:44-46,178-180`). `[doc]` `gp:133`.
- A statically named partial (`{% render 'x' %}` or `{% include 'x' %}` with a quoted literal) that is not registered fails at parse time with `PromptFileParseError`: `Referenced partial "x" is not registered. Add a sibling x.md (Node) or pass it in the partials map (browser).` Checked across `<system>`, `<user>` and `<context>` (`pf:207-214,326-338`). **[test]** `pft:278`. A partial named by a variable is not checked at parse (`pf:207-208`), so it fails at render time instead. **[source]**
- The partial key lookup strips a trailing `.md` (`pf:219-221`).

### Resource template: where the template comes from

`contentTemplate` and `contentTemplateRef` are `defineResource` fields (`res:269-287`). A resource has at most one content source among `content`, `contentFile`, `contentTemplate`, `contentTemplateRef`; two or more throw at definition: `defineResource() accepts at most one content source, got: ...` (`res:605-615`). `render` with `contentTemplate` or `contentTemplateRef` also throws at definition (`res:616-620`). `[doc]` `rp:448,494`.

| Form | Value | Resolved | Source |
| --- | --- | --- | --- |
| `contentTemplate: "./report.prompt.md"` | file path string | Not at process start or flow registration. `resolveStringContentTemplates` runs inside `createExecutionContext` (`ec:723-725`), so the first run's context build loads it; later contexts find it already resolved in place. A relative path resolves from the working directory. An absolute path is used as-is. | `rr:608-630`, `cp:44-46`. `[doc]` `rp:418,436`. |
| `contentTemplate: { path, importerUrl }` | anchored path (`AnchoredPath`) | Relative to the declaring module's directory first, then the working directory. The first candidate that exists wins. If none exists it throws `Failed to resolve contentTemplate for resource "<name>" (path: <path>). Tried: <paths>`. An unusable `importerUrl` (not a `file:` URL) falls back to the working directory. | `cp:47-59`, `res:150-163`. `[doc]` `rp:438-444`. |
| `contentTemplate: loadResourceTemplate(...)` | a parsed `ResourceTemplate` | Already parsed. | `res:280`, `rl:55-84`. `[doc]` `rp:450-462`. |
| `contentTemplateRef: "<resource name>"` | name of another resource | At every read. See below. | `res:281-287`, `rr:2273-2284`. |

- A string or anchored path that fails to load throws when the first run's execution context is built (`ec:723-725`), as does the `Failed to resolve contentTemplate ... Tried:` error: `Failed to load contentTemplate for resource "<name>" (path: <file>): <cause>` (`rr:624-628`). **[source]**
- `readContent()` renders the template against the current state. `readContentRaw()` returns the template source (`rr:2258-2272`). `[doc]` `rp:446`. For `contentTemplateRef`, `readContentRaw()` returns the referenced resource's raw content, or `null` when no resolver is available (`rr:2261-2265`).
- `loadResourceTemplate(specifier, importerUrl, options?: { partials? })` is at `@flow-state-dev/engine/resource-template` (`packages/engine/package.json:51-54`, `rl:55-84`). Absolute specifier used as-is and `importerUrl` ignored (`rl:60-62`). **[test]** `rlt:42`. Missing file throws `ResourceTemplateLoadError` (`rl:64-72`). **[test]** `rlt:36`. Sibling `.md` files in the template's directory register as partials; an explicit `options.partials` entry overrides a sibling of the same name (`rl:28-43,74-78`). **[test]** `rlt:30` (the test only asserts the template loads).
- `createResourceTemplateLoader(baseDir, options?: { partialsDir? })` mirrors `createPromptLoader`: absolute `baseDir` or `TypeError`; returns `(relPath) => ResourceTemplate` (`rl:91-108`). **[source]** No test; it is exported but the existing page does not mention it.
- `parseResourceTemplate(text, { sourcePath?, partials? })` is isomorphic, at `@flow-state-dev/core/resource-template` (`rtp:123-126`, `packages/core/package.json:79-82`). **[source]**
- Partials: a resource template's `{% render %}` partial names are not validated at parse (`rtp:189-197`: the test-compile uses `strictVariables: false` with the partials fs, which reports "exists" for any name); a missing partial fails at render, as `ResourceTemplateRenderError` (`rtp:244-250`). **[source]** The existing page says nothing about partials in resource templates.

### `contentTemplateRef`: finding the referenced template

- The value is the referenced resource's name as declared in the flow or block's resource map. `[doc]` `rp:490`.
- Lookup order at read: session scope (skipped when there is no session), then user scope, then org scope, using the resource key; the first scope that holds string content for the key wins (`ec:3011-3023`). **[source]**
- If no scope holds it, `readContent()` returns `null` (`rr:2279-2281`). **[source]** If the resolver does not exist, `readContent()` throws `Cannot resolve contentTemplateRef "<ref>" for resource "<name>" — template resolver not available` (`rr:2274-2278`). **[source]**
- The referenced content is parsed with `parseResourceTemplate` on every read, with no partials, and rendered against the referencing resource's state (`rr:2280-2283`). A syntax error in an edited template therefore throws `ResourceTemplateParseError` at the read. `[doc]` `rp:490-492`. **[source]**
- Edits take effect on the next read: write the template resource's content with `writeContent()` (`rr:2286` on). Nothing is cached between reads: each `readContent()` calls the resolver, which reads the scopes' current content, then parses afresh (`rr:2273-2283`, `ec:3016-3023`). `[doc]` `rp:492`. **[source]**
- The page says the template renders against the referencing resource's own state, not the template resource's: `renderResourceTemplate(template, readState())`, where `readState` is the referencing resource's (`rr:2283`). **[source]**
- A user-visible fence on the content route (`GET .../sessions/<id>/resources/<ref>/content`): a template stored under another user's owner-private key is not rendered for a different user (`content` is `null`); an owner-keyed row the scope serves to everyone, and a key with no owner segment, render for anyone; the owner sees their own row. **[test]** `fence:75-95`. On the route the template is read from the template resource's own declared scope, only when `ownerKeyMaySeed` admits the key for the session's user; otherwise `content` is `null`, then parsed and rendered as above (`rro:115-128`, `ri:287-291`). **[source]** The page states the four outcomes and links R-08 for `ownerPrivate`.

## 9. Limits and safety (resource template)

- Maximum template length 524,288 characters (`512 * 1024`, checked as `text.length`, so characters, not bytes; the code comment calls it 512 KB). A longer text throws `ResourceTemplateParseError`: `Template exceeds maximum length (524288 characters)` (`rtp:22,129-134`). **[test]** `rtt:80`. `[doc]` `rp:502`.
- Render engine limits: `renderLimit: 5000` (milliseconds of render time), `memoryLimit: 1e8`, `parseLimit: 512 * 1024` (`rtp:23-24,238-240`). **[source]** The existing page states only the 512 KB limit.
- `ownPropertyOnly: true` (`rtp:235`). **[test]** `rtt:123`.
- Rendering is synchronous and deterministic: `parseAndRenderSync`, no model call (`rtp:245`). `[doc]` `rp:362`.
- Prompt files use the same three limits: `parseLimit: 512 * 1024`, `renderLimit: 5_000`, `memoryLimit: 1e8` on both engines (`pf:303-305,313-315`). **[source]** The prompt-file parse path does not check text length itself. Only the engine's `parseLimit` applies.

## 10. Errors (both kinds)

| Error | Raised when | Source |
| --- | --- | --- |
| `PromptFileLoadError` | `loadPromptFile` cannot read the file. Has `sourcePath`. | `pf:183-191`, `pl:188-196` |
| `PromptFileParseError` | Frontmatter parse or validation fails; `<system>` missing, blank or duplicated; any section tag duplicated; an unknown filter; a statically referenced partial not registered; template compile failure. Has `sourcePath`. | `pf:193-202,259-262,265-273,280-288,331-336,344-347` |
| Render-time error (a Liquid `undefined variable` error) | A `<system>` or `<user>` reference to an undefined variable or property. Not a `PromptFileParseError`. The page lists it as an Errors-table row, "LiquidJS render error, message contains `undefined variable`". | `pf:298-300`; **[test]** `pft:141,359` |
| `ResourceTemplateLoadError` | `loadResourceTemplate` cannot read the file. | `rl:19-26,64-72` |
| `ResourceTemplateParseError` | Frontmatter invalid, text over 512 KB, a duplicate section tag, or a Liquid compile failure. | `rtp:42-49,129-134,146-153,198-203` |
| `ResourceTemplateRenderError` | Strict-variable miss, limit exceeded, a prototype-property read. | `rtp:51-58,247-249` |
| `ResourceTemplateResolutionError` | Declared and exported; the registry paths shown above throw plain `Error` for an unresolved ref and return `null` for a missing one. Do not list it as something a reader will meet. | `rtp:60-69`, `rr:2274-2281` |

## 11. Wiring a prompt file into a generator

- `definePromptFile(pf)` returns an object spread into `generator({ ... })`. Fields: `prompt` always; `user` when the file has `<user>`; `name` and `description` when set in frontmatter; `caching`, `maxTokens`, `temperature` when set in frontmatter (`pf:437-457`). Fields the file leaves unset are absent from the object (`pf:443-455`). **[test]** `pft:295`.
- Mapping from file to generator field:

| In the file | Generator field | Source |
| --- | --- | --- |
| `<system>` | `prompt` | `pf:441` |
| `<user>` | `user` (only if the section exists) | `pf:445` |
| `<context>` | no field: changes how the aggregated context is placed | section 5 |
| frontmatter `name` | `name` | `pf:443` |
| frontmatter `description` | `description` | `pf:444` |
| frontmatter `caching` | `caching` (object form) | `pf:446-453` |
| frontmatter `maxTokens` | `maxTokens` | `pf:454` |
| frontmatter `temperature` | `temperature` | `pf:455` |
| frontmatter `intent`, `model` | none. `intent` is exposed as `config.intent`; `model` is not applied to the generator. | `pf:437-457` (neither copied), `gen:3113` |

- Passing the whole `PromptFile` to the `prompt` slot, `prompt: pf` (type `PromptSlot | PromptFile`, `gen:608`), expands the same fields. The keys expanded are `name`, `description`, `user`, `caching`, `maxTokens`, `temperature`, and `prompt` becomes the file's system renderer (`gen:2871-2882`). A key the generator sets itself is kept (`authored[key] === undefined` guard, `gen:2878`). **[test]** `gpt:146,173,188`. `[doc]` `gp:269-281`.
- Precedence: a field written after `...definePromptFile(pf)` replaces the file's. An inline `prompt` after the spread wins over the file's. A `user:` after the spread wins over `<user>` (`pf:431-436`, `pf:404-412`). **[test]** `gpt:128,173,188`. `[doc]` `gp:283`.
- `name` flows through: if frontmatter sets `name` and the spread comes after the generator's own `name`, the file's wins. With `prompt: pf`, the generator's own `name` wins (`gen:2878`). **[source]** `[doc]` `gp:285`. Both orderings follow from the two precedence rules above.
- With `prompt: pf` and an explicit `caching:` on the generator, the generator's wins (`gen:2878`). **[test]** `gpt:188` (temperature). **[source]** for `caching`.
- `config.temperature` shows an override placed after the spread, not the frontmatter value (`gen:3117-3121`). **[test]** `gpt:228`.
- DevTool: a generator built from a prompt file records the raw `.md` source (`templateSource`) and frontmatter on its trace (`gen:3319-3322`). **[test]** `gpt:248`; inline prompts record none, `gpt:269`. `[doc]` `gp:349-351`.

## 12. Defaults and numbers to carry

- Template size ceiling: 524,288 characters (`pf:303`, `rtp:22`; LiquidJS documents `parseLimit` as characters).
- Render time limit: 5,000 (`pf:304`, `rtp:23`). The unit in LiquidJS's `renderLimit` is milliseconds; the code names it `RENDER_LIMIT_MS` (`rtp:23`).
- Memory limit: `1e8` (`pf:305`, `rtp:24`). LiquidJS documents `memoryLimit` as a cap on "new objects creation, including array concat/join/strftime", with no byte unit. The page says it is counted over new strings and arrays, not bytes of output.
- Description length: 1024 (`pf:63`, `rtp:30`).
- `temperature` range 0 to 2 (`pf:68`). `ttl` values `"5m"`, `"1h"`; `breakpoints` values `"auto"`, `"manual"` (`pf:53-54`).

## 13. The four stored-part questions

A template is a file the developer writes, or the content of a resource. The page describes the format, so the questions apply to two parts.

**Template file (prompt file or file-backed resource template).**
- Owner: the developer, in the app's source tree. The framework only reads it (`pl:188-196`, `rr:608-630`); nothing writes it.
- Who can see it: anyone with the source. The raw text of a prompt file also appears in the DevTool trace for a generator run (`gen:3319-3322`). **[test]** `gpt:248`.
- Where stored: on disk, at the path given. Parsed at load (prompt file: when `loadPromptFile` runs; string or anchored resource template path: when the first run's execution context is built, `ec:723-725`, `rr:608-630`).
- How many: one per file. A template directory's `.md` siblings each register as a partial (`pl:154-157`).

**Template resource (the target of `contentTemplateRef`).**
- Owner: whoever may write that resource: its `writable` setting and scope decide (`rr:2286` on, `res:278`). The page can state the resource is edited with `writeContent()`. `[doc]` `rp:492`.
- Who can see it: determined by the resource's scope (session, user, org) like any resource. The content route withholds a template stored under another user's owner-private key. **[test]** `fence:76-80`.
- Where stored: the resource content store, under the resource's key, in session, user or org scope; looked up in that order (`ec:3010-3022`).
- How many: one content string per resource key; the referencing resource reads it, so many resources may reference one template resource (`rr:2273-2284`). **[source]** Each referencing resource renders it against its own state.

## 14. Rows other pages moved here: carried and dropped

Fifteen rows were listed by the grep for R-31. Each was checked against the code.

| # | Row (shortened) | Verdict | Where |
| --- | --- | --- | --- |
| 1 | Prompt files: a template `<context>` block replaces the default append, and unrendered keys are dropped | True. | Section 5. `ma:186-188`; **[test]** `gpt:67,89`. |
| 2 | Variables a template can read: `input`, `ctx` (`ctx.session.state`, `ctx.resources.<name>`), `config` | True. `ctx` also has `request`, `user`, `cap`. | Section 4. |
| 3 | Missing variable: `<system>` and `<user>` throw; optional values take `\| default: ""`; `<context>` renders leniently, an absent `config.context` key renders empty and does not throw (marked corrected by pass 5) | True as corrected. Widened: lenient mode applies to every variable inside `<context>`, not only `config.context` keys, and a resource template also throws on a miss. | Section 6. `pf:298-311`; **[test]** `pft:141,343,359`. |
| 4 | Built-in filters table: `fsd_keyValues`, `fsd_list`, `fsd_table`, `fsd_json` | True. | Section 7. |
| 5 | Frontmatter and sections to generator fields (`definePromptFile`) | True. | Sections 3 and 11. |
| 6 | Passing a `PromptFile` to the `prompt` slot expands the same fields; explicit sibling fields win | True. | Section 11. `gen:2871-2882`; **[test]** `gpt:146,173`. |
| 7 | Precedence: fields written after the spread override the file's; same when passed directly | True. For `prompt: pf`, "after" means any explicitly set sibling, in any order, since the guard is "authored value is undefined". | Section 11. |
| 8 | Frontmatter `name` flows to the generator and overwrites an earlier `name` when spread after it | True for the spread. Does not apply to `prompt: pf`, where the generator's own `name` wins. | Section 11. `pf:443`, `gen:2878`. |
| 9 | Browser: `loadPromptFile` is Node only; import raw text (`?raw`) and call `parsePromptFile` with an explicit `partials` map | True. | Section 8. `pl:6-13`. |
| 10 | Partials: siblings auto-register by filename in Node; `partialsDir` points elsewhere | True. `partialsDir` replaces the prompt's own directory, not adds to it. | Section 8. `pl:198-199`. |
| 11 | Partial tags: `{% render %}` isolated scope versus `{% include %}` shared scope | True. `render` isolation pinned by **[test]** `pft:284`; `include` shared scope is LiquidJS semantics, stated in `gp:128` and not pinned by a test here. | Section 8. |
| 12 | Loader helpers: `createPromptLoader` (`partialsDir`), `resolveBaseDir` (candidates tried in order, first that exists and contains `expect`), `moduleDir` | True. Carried with the full signatures. | Section 8. `pl:26-127,208-276`. |
| 13 | Base directory per runtime: module-relative under vitest, tsx and `fsdev run`; `process.cwd()` under Next.js dev and build | Partly dropped. The Next.js half is true (`pl:30-36,64-70,244-252`; `gp:233`). Vitest and tsx are true by the same reasoning (`import.meta.url` is a real `file:` URL, `pl:244-247`). The `fsdev run` claim has no citable source (no comment, test or doc names it), so it is dropped. | Section 8. |
| 14 | `<context>` section: default mode appends the aggregated XML after the system text; adding `<context>` suppresses that append; template positions context via `config.context`; entries still declared on the `context:` slot | True. | Section 5. `ma:186-206`. |
| 15 | `<context>` behaviour: keys the template does not name are dropped; the template only reorders and prunes | True. | Section 5. **[test]** `gpt:89`. |

Rows not carried because they are not claims about R-31's tables: none beyond the part of row 13 named above.

## 15. Existing pages: what disagrees with the code

- `gp:235` says "Only the `/node` subpath imports `node:fs`". No `/node` subpath exists on `@flow-state-dev/engine` or `@flow-state-dev/core` (`packages/engine/package.json:47-54`). The loader is `@flow-state-dev/engine/prompt-file`, and the page's own imports (`gp:190,254`) use it. Use the import path, not "the `/node` subpath".
- `gp:176` ("There is deliberately no `calculatedValues` config slot") and `gp:56` ("The strict-variable behavior is the safer default") are design defence, not behaviour; leave them out.
- `gp:54` states `strictVariables` is on without saying the `<context>` section differs; row 3 corrects that.
- `rp:396` says generator-only keys "do nothing harmful; they just sit there". The code also warns once at parse time outside production (`rtp:163-168`). State the warning.
- `rp:396` says `<user>` and `<context>` are "ignored during resource rendering"; the code also warns for each, outside production (`rtp:173-184`).
- `rp:502` names `ResourceTemplateParseError` for the size limit; the code agrees (`rtp:129-134`).
- `rp:414` says templates use "the full filter library". True of LiquidJS's built-ins; the `fsd_` filters and custom `filters` are prompt-file only (section 7).
- Neither existing page says that `contentTemplateRef` templates get no partials, that a missing partial in a resource template fails at render, or that `lenientIf` is on for resource templates. Each is in the code (`rr:2283`, `rtp:189-197,237`).

## 16. Not stated, on purpose

- That `contentTemplateRef` templates can be read by the public content route: only the fence behaviour is pinned (`fence`), and only for `client.content.read: true` resources.
- Anything about how the engines are built beyond observable limits.
- Performance claims: nothing measures render cost.

## 17. Rows moved to other Reference pages

- `defineResource` content-field refusals (at most one source; `render` with a template field): carried on R-08 (`resources.md`, "What `defineResource` refuses"). The page links it.
- Content route and another user's `ownerPrivate` row (`fence:75-95`; the option is the collection's `ownerPrivate: { param }`): added to R-08's HTTP routes row. The page links it.
- A prompt-file generator records its raw source and frontmatter on the DevTool trace (`gen:3319-3322`, `gpt:248,269`): added to R-02 (`generators.md`, "What is recorded per call"). The page links it.
