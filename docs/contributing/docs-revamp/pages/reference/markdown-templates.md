---
title: Prompt and resource templates
type: reference
description: "The Markdown template format for a generator's prompt and a resource's content: frontmatter fields, sections, variables, filters, partials, how a template file is found, and what happens when a variable is missing."
---

# Prompt and resource templates

A prompt that lives in a TypeScript string is hard to hand to someone who does not write TypeScript. A template moves it into a `.md` file: YAML frontmatter, then a body written in LiquidJS, where `{{ expression }}` prints a value and `{% tag %}` does logic. The format is read in two places: a **prompt file** is a generator's prompt, and a **resource template** is a resource's content, rendered against its state.

The examples use the `support` flow. Its `draftReply` generator takes its prompt from a file.

```md title="src/flows/support/prompts/draft-reply.md"
---
name: draft-reply
description: Draft a reply to a customer ticket.
maxTokens: 800
temperature: 0.3
---

<system>
You write replies for the support team.
{% render 'tone' %}
</system>

<user>
Ticket: {{ input.subject }}
Note: {{ input.note }}
</user>
```

```ts title="src/flows/support/blocks/draft-reply.ts"
import { z } from "zod";
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { loadPromptFile } from "@flow-state-dev/engine/prompt-file";

const pf = loadPromptFile("../prompts/draft-reply.md", import.meta.url);

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  inputSchema: z.object({ subject: z.string(), note: z.string() }),
  ...definePromptFile(pf),
});
```

`tone` is `src/flows/support/prompts/tone.md`, a sibling file that registers as a partial.

## Sections

| Section | Prompt file | Resource template |
| --- | --- | --- |
| `<system>` | Required, not blank. Becomes the generator's `prompt`. | Becomes the content. With no sections, the whole body after the frontmatter is the content. |
| `<user>` | Optional. Becomes the generator's `user`. | Ignored. |
| `<context>` | Optional. Positions the aggregated context. See [`<context>`](#the-context-section). | Ignored. |

- A tag counts when it starts a line and closes with its end tag. Each tag may appear once; a second one is a parse error.
- Leading and trailing newlines inside a section are trimmed. Text outside the tags is ignored in a prompt file.
- Sections are split in the top-level file only. A tag inside a partial is literal text.
- A resource template with `<user>` or `<context>`, or with generator-only frontmatter keys, logs a warning once at parse time outside production. An empty body renders as the empty string.

## Frontmatter fields

A prompt file's frontmatter is strict: a key not in the table is a `PromptFileParseError` with the message `Invalid frontmatter: <path>: <issue>`, where `<path>` is the key's location inside the frontmatter, or `(root)` when there is none. An unknown key `x` gives `Invalid frontmatter: (root): Unrecognized key(s) in object: 'x'`. The file path is on the error's `sourcePath`. Frontmatter may be omitted.

| Field | Type | What it does |
| --- | --- | --- |
| `name` | string, at least 1 character | Becomes the generator's `name`. |
| `description` | string, at most 1024 characters | Becomes the generator's `description`. |
| `intent` | string | Read in templates as `config.intent`. Not copied to the generator. |
| `model` | string | Metadata only. The generator's model comes from its own `model`. |
| `maxTokens` | positive integer | Becomes the generator's `maxTokens`. |
| `temperature` | number, 0 to 2 | Becomes the generator's `temperature`. |
| `caching` | `true`, `false`, or `{ enabled?, breakpoints?, ttl? }` | Becomes the generator's `caching`. |

In the `caching` object, `enabled` is a boolean, `breakpoints` is `"auto"` or `"manual"` and `ttl` is `"5m"` or `"1h"`. Any other key inside the object fails, as does a bare string. `true` and `false` become `{ enabled: true }` and `{ enabled: false }`.

A resource template's frontmatter is loose: `name` and `description` are recognised, other keys are accepted and ignored. The generator-only keys (`model`, `intent`, `caching`, `maxTokens`, `temperature`) are accepted, do nothing, and trigger the parse-time warning.

## Variables

Nothing outside the variables below is in scope.

| In | Variable | What it is |
| --- | --- | --- |
| Prompt file | `input` | The generator's typed input, the value a TypeScript `prompt` function receives. |
| Prompt file | `ctx` | The block context: `ctx.request`, `ctx.session` and `ctx.user`, each with `.state`; `ctx.resources.<name>`; `ctx.cap.<name>`. |
| Prompt file | `config` | The resolved generator configuration, read-only. |
| Resource template | `state` | The resource's current state. Nested objects and arrays are readable. |

A value that is a Promise is awaited before it prints. A resource template has no `ctx`, `input`, `config`, session state or other resources. Outside a generator, a prompt file's `config` is `{ context: {} }`.

| `config` field | Value |
| --- | --- |
| `config.context` | The aggregated context, `Record<string, string>` keyed by XML tag name: the generator's `context:` slot plus every capability's contribution. A template reads it and cannot add to it. |
| `config.model` | The resolved model id, not the frontmatter value. |
| `config.intent` | The frontmatter `intent`. |
| `config.tools` | Resolved tool names. |
| `config.caching` | Resolved caching config. |
| `config.maxTokens`, `config.temperature` | Resolved values. An override written after the spread wins over the file. |
| `config.providerOptions` | Provider-specific options. |

## The `<context>` section

Without a `<context>` section, the framework appends the aggregated context as XML tags after the rendered `<system>`, separated by a blank line. A template may read `config.context` inside `<system>` without changing that.

With a `<context>` section, the append is suppressed. The rendered section is wrapped as `<context>` ... `</context>` and takes its place. A key the section does not render is dropped.

```md title="src/flows/support/prompts/draft-reply.md"
<context>
{% if config.context.orderHistory %}{{ config.context.orderHistory }}{% endif %}
</context>
```

## What happens when a variable is missing?

| Where | A missing variable or property |
| --- | --- |
| Prompt file `<system>`, `<user>` | Throws at render, with an `undefined variable` error. The generator run fails. It is not a `PromptFileParseError`. A bare `{% if input.q %}` on an absent key throws too. |
| Prompt file `<context>` | Renders as empty. `{% if config.context.absent %}` skips cleanly. Every variable in the section behaves the same way. |
| Resource template | Throws `ResourceTemplateRenderError` (`Template render failed: <cause>`) on `readContent()`, not at definition. A bare `{% if state.missing %}` test does not throw, and `default` supplies a fallback for an absent property. |

- In a prompt file's `<system>` and `<user>`, `default` does not rescue an absent property: `{{ input.note | default: "none" }}` throws when `note` is missing. It replaces a value that is present and `null` or empty. Make an optional field always present before the generator runs, for example with a step that fills it in, or read it in `<context>`, where `default` and `{% if %}` on an absent key work.
- Prototype properties are unreachable in a resource template: `{{ state.constructor }}` throws `ResourceTemplateRenderError`.
- An unknown filter is a parse-time error in every section and in both kinds of template.
- A render that runs longer than 5,000 ms, or that builds more strings and arrays than LiquidJS's memory limit allows, throws. A template longer than 524,288 characters is refused at parse; a resource template throws `ResourceTemplateParseError` (`Template exceeds maximum length (524288 characters)`).

## Filters

LiquidJS's own filters (`default`, `join`, and the rest) work in both kinds of template. Prompt files add the filters below, in `<system>`, `<user>` and `<context>`:

| Filter | Takes | Renders |
| --- | --- | --- |
| `fsd_keyValues` | an object | `key: value` lines, one per entry. `null` or `undefined` renders empty. |
| `fsd_list` | an array | A bullet list. `fsd_list: "ordered"` numbers it. A scalar is one item. |
| `fsd_table` | an array of records | A Markdown table. Extra arguments name the columns in order: `fsd_table: "ticker", "qty"`. |
| `fsd_json` | any value | A fenced `json` block, two-space indent. An undefined value renders `null`. |

Resource templates have no `fsd_` filters and take no `filters` option.

A custom filter is `(input, ...args) => unknown` and may return a Promise. Its parameters are typed `unknown`, so convert the input before using it. Register it on a prompt file with the `filters` option. It is scoped to that file. A caller filter with a built-in's name replaces the built-in.

```ts title="src/flows/support/lib/prompts.ts"
import { loadPromptFile } from "@flow-state-dev/engine/prompt-file";

export const refundOffer = loadPromptFile("../prompts/refund-offer.md", import.meta.url, {
  filters: { format_usd: (n) => `$${Number(n).toFixed(2)}` },
});
```

```md title="src/flows/support/prompts/refund-offer.md"
<system>
You offer refunds for the support team.
</system>

<user>
Offer {{ input.refundAmount | format_usd }} back on order {{ input.orderId }}.
</user>
```

## How a template is found

### Prompt file loading

| Function | Import | What it does |
| --- | --- | --- |
| `loadPromptFile(specifier, importerUrl, options?)` | `@flow-state-dev/engine/prompt-file` | Reads the file and registers partials. Node only. `options`: `{ filters?, partialsDir? }`. |
| `createPromptLoader(baseDir, options?)` | `@flow-state-dev/engine/prompt-file` | Fixes a base directory and shared options once. Returns `(relPath, perCall?) => PromptFile`. A per-call filter overrides a loader filter. |
| `parsePromptFile(text, options?)` | `@flow-state-dev/core/prompt-file` | Takes raw text, so it runs in a browser. `options`: `{ sourcePath?, filters?, partials? }`. |
| `resolveBaseDir(candidates, options?)` | `@flow-state-dev/engine/prompt-file` | Returns the first candidate directory that exists and, with `expect`, contains that relative path. |
| `moduleDir(importerUrl, relative?)` | `@flow-state-dev/engine/prompt-file` | The calling module's directory. `undefined` when the URL is not a `file:` URL. |
| `definePromptFile(pf)` | `@flow-state-dev/core/prompt-file` | Returns the fields to spread into `generator({ ... })`. |

- An absolute `specifier` is used as-is and `importerUrl` is ignored. A relative one resolves against `importerUrl`, never the working directory.
- `createPromptLoader` throws a `TypeError` for a relative `baseDir`. `resolveBaseDir` throws if a defined candidate is relative, or, when none qualifies, an `Error` listing each candidate and why it failed. It skips `undefined` candidates.
- A file that cannot be read throws `PromptFileLoadError` (`Failed to read prompt file "<specifier>": <cause>`).
- Under Node, tsx and vitest, `import.meta.url` is a `file:` URL, so a module-relative candidate works from any working directory. Bundlers such as Next.js rewrite it and `moduleDir` returns `undefined`, so list a `process.cwd()`-based candidate after the module-relative one:

```ts title="src/flows/support/lib/prompt-dir.ts"
import path from "node:path";
import { createPromptLoader, moduleDir, resolveBaseDir } from "@flow-state-dev/engine/prompt-file";

const baseDir = resolveBaseDir(
  [moduleDir(import.meta.url, "../prompts"), path.resolve(process.cwd(), "src/flows/support/prompts")],
  { expect: "tone.md" },
);

export const loadPrompt = createPromptLoader(baseDir);
```

In a browser, or where `node:fs` is unavailable, import the raw text (Vite's `?raw`) and call `parsePromptFile(text, { sourcePath, partials })`. Do not import `@flow-state-dev/engine/prompt-file` there.

### Partials

A partial is a reusable fragment a template pulls in. `{% render 'name' %}` renders it in an isolated scope: it does not see the caller's variables. `{% include 'name' %}` renders it in the caller's scope.

- Node: `loadPromptFile` registers every `.md` file in the prompt's own directory, except the prompt, under its filename without `.md`. Only direct children are read. `partialsDir` replaces that directory; the prompt's own directory is then not scanned. `createPromptLoader`'s `partialsDir` applies to every prompt it loads. A missing or unreadable directory gives no partials.
- Browser: pass the `partials` map to `parsePromptFile`.
- A quoted partial name that is not registered fails at parse with `PromptFileParseError`, in any section. A partial named by a variable fails at render.
- In a resource template, a missing partial fails at render as `ResourceTemplateRenderError`.

### Resource template sources

`contentTemplate` and `contentTemplateRef` are `defineResource` fields. What `defineResource` refuses when they are combined with other content fields is on [Resources and collections](./resources.md#what-defineresource-refuses).

| Form | Value | Found |
| --- | --- | --- |
| `contentTemplate: "./report.md"` | A path | Loaded at the first run, then reused. A relative path resolves from the working directory. |
| `contentTemplate: { path, importerUrl }` | An anchored path | From the declaring module's directory, then the working directory. The first that exists wins. |
| `contentTemplate: loadResourceTemplate(...)` | A parsed `ResourceTemplate` | Already loaded. |
| `contentTemplateRef: "<resource name>"` | Another resource's name | At every read, from that resource's stored content. |

A path that fails to load fails the first run (`Failed to load contentTemplate for resource "<name>" (path: <file>): <cause>`). An anchored path with no match throws `Failed to resolve contentTemplate ... Tried: <paths>`.

`readContent()` renders against the current state. `readContentRaw()` returns the template source.

`loadResourceTemplate(specifier, importerUrl, options?: { partials? })` comes from `@flow-state-dev/engine/resource-template`. It registers sibling `.md` files as partials, and an `options.partials` entry overrides a sibling of the same name. A missing file throws `ResourceTemplateLoadError`. `createResourceTemplateLoader(baseDir, options?: { partialsDir? })` fixes a base directory the way `createPromptLoader` does. `parseResourceTemplate(text, { sourcePath?, partials? })` comes from `@flow-state-dev/core/resource-template` and runs anywhere.

For `contentTemplateRef`, the template is another resource's stored content, so you change it at runtime by writing that resource with `writeContent()`. The edit takes effect on the next read, because every `readContent()` looks the content up again: session scope (skipped without a session), then user scope, then org scope, and the first scope holding string content wins. That text is parsed with `parseResourceTemplate`, with no partials, and rendered against the referencing resource's own state, not the template resource's. A syntax error in the edited text throws `ResourceTemplateParseError` on that read. If no scope holds the template, `readContent()` returns `null`.

On the content route, `GET .../sessions/<id>/resources/<name>/content`, a template stored under another user's owner-private key is not rendered for you, and `content` comes back `null`. The owner sees their own. A key the scope serves to everyone, or a key with no owner segment, renders for anyone. The `ownerPrivate` option itself is on [Resources and collections](./resources.md#http-routes).

## Wiring a prompt file into a generator

`definePromptFile(pf)` returns fields to spread into `generator({ ... })`. Fields the file leaves unset are absent.

| In the file | Generator field |
| --- | --- |
| `<system>` | `prompt` |
| `<user>` | `user`, only when the section exists |
| frontmatter `name`, `description` | `name`, `description` |
| frontmatter `caching`, `maxTokens`, `temperature` | the same names |
| `<context>` | no field |
| frontmatter `intent`, `model` | none |

A field written after `...definePromptFile(pf)` replaces the file's, including an inline `prompt` or a `user:`. A `name` in the frontmatter overwrites an earlier `name` when spread after it.

Passing the file as `prompt: pf` expands `name`, `description`, `user`, `caching`, `maxTokens` and `temperature` the same way, with the file as the system prompt. Here a field the generator sets itself is kept, in any order, so the generator's own `name` wins.

What a prompt-file generator records is on [Generators](./generators.md#what-is-recorded-per-call).

## Errors

| Error | Raised when |
| --- | --- |
| `PromptFileLoadError` | The file cannot be read. Has `sourcePath`. |
| `PromptFileParseError` | Frontmatter is invalid; `<system>` is missing, blank or duplicated; a section tag repeats; a filter is unknown; a quoted partial is unregistered; the template does not compile. Has `sourcePath`. |
| `ResourceTemplateLoadError` | `loadResourceTemplate` cannot read the file. |
| `ResourceTemplateParseError` | Frontmatter is invalid, the text is over 524,288 characters, a section tag repeats, or the template does not compile. |
| `ResourceTemplateRenderError` | A variable is missing, a limit is exceeded, or a prototype property is read. |
| LiquidJS render error, message contains `undefined variable` | A prompt file's `<system>` or `<user>` names a missing variable. Raised when the generator renders, so the generator run fails. |

Messages: `<system> block required; file appears to be empty.` and `<system> block is empty.`; `Multiple <tag> blocks found; at most one is allowed.`; `Referenced partial "x" is not registered. Add a sibling x.md (Node) or pass it in the partials map (browser).`
