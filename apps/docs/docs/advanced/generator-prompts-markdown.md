---
sidebar_position: 10
sidebar_label: Prompts as Markdown
---

# Generator prompts as Markdown files

A generator's `prompt` slot holds the system prose the model reads. You can author it inline in TypeScript, as a string or a function. You can also pull it out into a separate `.md` file and load it back in. Both surfaces stay supported. Inline prompts work exactly as before; nothing about them changes when this feature is present.

A `.md` prompt file is a small document with YAML frontmatter (metadata between `---` fences) on top and the prompt body below. The body is a [LiquidJS](https://liquidjs.com/) template, so it can interpolate the generator's input, the block context, and the resolved config. The file loads through a helper, gets spread into the generator config, and the framework renders it at run time.

## When to use it

Reach for a `.md` file when the prose is long, when several generators share fragments of it, or when you want the prompt reviewable on its own without TypeScript noise around it. A 120-line system prompt reads better as a document than as a `.join("\n")` array of string literals.

Keep prompts inline when they are short, when they need TypeScript-level logic that does not fit a template, or when the prompt is genuinely one-off. The `.md` format buys you nothing for a three-line instruction.

## File format

```
---
description: optional summary
intent: chat                 # informational; exposed as config.intent
model: openai/gpt-5.4-mini   # metadata only — does NOT set the generator's model
caching: true                # true | false | { enabled, breakpoints, ttl }
maxTokens: 1000
temperature: 0.5
---
<system>
System prompt prose. LiquidJS templating runs here.
{% render 'preamble' %}
</system>

<user>
Optional user-slot prose.
</user>

<context>
Optional. Presence switches on context override mode (see below).
</context>
```

The frontmatter is YAML, validated against a strict schema. Allowed keys: `name`, `description`, `intent`, `model`, `caching`, `maxTokens`, `temperature`. Any other key throws at parse time, so a typo surfaces immediately rather than being silently ignored.

The body is split into sections by line-anchored tags: `<system>`, `<user>`, and `<context>`. At least one `<system>` section is required. Each tag may appear at most once. The `model` field is metadata for documentation and tooling. The generator's actual model stays in TypeScript on the `model:` slot.

## Templating with LiquidJS

The body is rendered with LiquidJS, a template language with `{{ expression }}` output tags and `{% tag %}` logic tags. If you have used Liquid, Jinja, or Handlebars, the shape is familiar. A few things worth knowing up front:

- `{{ input.topic }}` outputs a value.
- `{% if config.context.documents %}...{% endif %}` is conditional logic.
- `{% assign x = input.a | upcase %}` binds a local variable.
- `strictVariables` is on. Referencing a variable or property that does not exist throws at render time. For optional fields, supply a fallback with the `default` filter: `{{ input.note | default: "" }}`.

The strict-variable behavior is the safer default. A typo in a variable name fails loudly instead of rendering an empty string into the model's prompt.

## What the template can read

Three top-level variables are in scope.

| Variable | What it is |
|----------|------------|
| `input` | The generator's typed input — the same value a TS `prompt` function receives. |
| `ctx` | The block context: `ctx.session.state`, `ctx.request.state`, `ctx.user.state`, `ctx.resources.<name>`, `ctx.cap.<capname>`. Async resource accessors work, because LiquidJS renders asynchronously. |
| `config` | The post-resolution view of the generator's config. Template-only. See below. |

### `config.context` vs the TypeScript `context:` slot

These have the same shape and are easy to confuse, so be explicit about which stage you are looking at.

The generator's TypeScript config has a slot literally named `context: { ... }`. That is the authoring surface where the developer and capabilities declare context entries. It is described in [Generator context](./generator-context.md).

The render variable `config.context` is the **aggregated, post-resolution** tag map derived from that slot **plus** every capability contribution, after normalization. It is a `Record<string, string>` keyed by XML tag name. Same shape as the authored map, different stage: one is what you write, the other is what the framework computed.

You read `config.context` in the template. You do not write the `context:` slot from the template.

## The `config` namespace

`config` exposes the resolved generator configuration. It is template-only in this version — a read surface for rendering, not a place to mutate settings.

| Field | Meaning |
|-------|---------|
| `config.context` | The aggregated tag map (`Record<string, string>`), keyed by XML tag name. |
| `config.model` | The resolved model id. |
| `config.intent` | The model intent, if set. |
| `config.tools` | The resolved tool names. |
| `config.caching` | The resolved caching config. |
| `config.maxTokens` | The resolved max-tokens setting. |
| `config.temperature` | The resolved temperature. |
| `config.providerOptions` | Provider-specific options. |

## Context override with the `<context>` block

By default, a `.md` prompt has no `<context>` section. In that case:

- The rendered `<system>` fills the system-prompt half.
- The framework appends the capability-aggregated XML context after it, exactly as it does for an inline prompt.

A template may still **read** `config.context` inside `<system>` in default mode. Reading it does not change the default append.

When the template **does** include a `<context>` section, it switches to override mode:

- The framework's default XML-tag append is suppressed.
- The template owns the context position entirely. You can reorder keys, conditionally include them, or restructure them.
- Keys you never render are silently dropped. That is intentional — it is how you prune.
- The rendered block is wrapped in `<context>...</context>`.

```liquid
<context>
{% if config.context.thesis %}{{ config.context.thesis }}{% endif %}
{% if config.context.risk_assessment %}
<priority-risks>
{{ config.context.risk_assessment }}
</priority-risks>
{% endif %}
{{ config.context.trade_proposal | default: "" }}
</context>
```

Here the template promotes the risk assessment into its own emphasized tag, gates the thesis on presence, and drops any other aggregated key that it does not name. Override mode is the tool when default key ordering or grouping does not match how you want the model to read the context.

## Shared fragments

A partial is a reusable fragment another template pulls in. Liquid has two ways to do that.

- `{% render 'name' %}` renders the partial in an **isolated scope**. The caller's variables do not leak in, and the partial cannot clobber the caller's variables. This is the safer default and the one to prefer.
- `{% include 'name' %}` renders the partial in the **caller's scope**. The partial sees and can overwrite caller variables. It is a footgun; reach for it only when you specifically need shared scope.

How partials get registered depends on where you load the prompt.

- **Node.** `loadPromptFile` auto-registers every sibling `.md` file in the prompt's directory as a partial. The filename without `.md` is the partial name, so `preamble.md` becomes `{% render 'preamble' %}`.
- **Browser or bundled.** You pass an explicit `partials` map to `parsePromptFile`, because the Node file system is not available.

A missing partial throws at parse time, not at render time, so a bad reference is caught when the file loads.

One sharp edge: section markers like `<system>` inside a partial are literal text, not section composers. Section splitting happens only in the top-level prompt file. A partial contributes prose, not structure.

## Built-in filters

The framework auto-registers four filters on every prompt file, so a template can format typed objects and arrays without pre-flattening them into strings in TypeScript first. They expose the same shapes as the [prompt formatters](../api/core.md#prompt-formatters) (`keyValues`, `list`, `table`), available inside the template.

| Filter | Input | Output |
|--------|-------|--------|
| `fsd_keyValues` | an object | `key: value` lines, one per entry |
| `fsd_list` | an array | a bullet list; pass `"ordered"` for a numbered list |
| `fsd_table` | an array of records | a Markdown table; extra args fix the columns |
| `fsd_json` | any value | a fenced ` ```json ` block, pretty-printed |

```liquid
<system>
Holdings:
{{ input.holdings | fsd_table }}

Run config:
{{ config.context.runMeta | fsd_keyValues }}
</system>
```

`{{ items | fsd_list: "ordered" }}` numbers the list; `{{ rows | fsd_table: "ticker", "qty" }}` pins the column set. Each filter is `fsd_`-prefixed to stay clear of LiquidJS built-ins and your own filters, and a custom filter of the same name overrides it (see below). LiquidJS also ships a bare `json` filter if you want the unfenced form.

## Custom filters

A filter transforms a value inside `{{ }}`: `{{ price | format_usd }}`. LiquidJS ships roughly 40 built-ins — `upcase`, `downcase`, `truncate`, `default`, `join`, `map`, `where`, `sort`, `date`, `round`, `replace`, `slice`, and more. The full list is in the [LiquidJS filter docs](https://liquidjs.com/filters/overview.html).

When a built-in is not enough, register a custom filter per prompt file through the `filters` option:

```ts
loadPromptFile("./analyst.prompt.md", import.meta.url, {
  filters: { format_usd: (n) => `$${n.toFixed(2)}` },
});
```

Custom filters are scoped to the file you register them on. There is no global registry. A custom filter may shadow a built-in of the same name (yours wins), and a filter may be async.

There is deliberately no `calculatedValues` config slot. Filters plus the `<context>` override cover the derivation cases, so the format does not need a separate computed-values surface.

### When to use what

- **Built-in filter** — standard transforms: casing, truncation, joining, date formatting.
- **Custom filter** — domain formatting the built-ins do not cover (currency, units, app-specific shapes).
- **`{% assign %}` / `{% capture %}`** — multi-source derivations inside the template, where you combine several values before output.
- **The `context:` slot in TypeScript** — when the value is real per-turn context the model should treat as context, not prompt prose. Author it on the generator, read the aggregated result via `config.context`.

## Loading the file

In Node, `loadPromptFile` reads the file and resolves sibling partials:

```ts
import { loadPromptFile } from "@flow-state-dev/core/prompt-file/node";

const pf = loadPromptFile("./analyst.prompt.md", import.meta.url, {
  filters: { format_usd: (n) => `$${n.toFixed(2)}` },
});
```

The second argument is the caller's `import.meta.url`, which `"./analyst.prompt.md"` resolves against. You can also pass an absolute path, in which case `import.meta.url` is ignored — useful under bundlers (Next.js) that make `import.meta.url` unreliable.

When a module loads several prompts from the same place, `createPromptLoader` captures the base directory and shared options once so each call site is just a filename:

```ts
import path from "node:path";
import { createPromptLoader } from "@flow-state-dev/core/prompt-file/node";

const load = createPromptLoader(path.resolve(process.cwd(), "src/prompts"), {
  partialsDir: path.resolve(process.cwd(), "src/prompts/_partials"),
});

const analyst = load("analyst.prompt.md");
const trader = load("trader.prompt.md", { filters: { format_usd } });
```

`baseDir` must be absolute; `relPath` joins onto it, so resolution never depends on `import.meta.url`. Per-call `filters` merge over (and override) the loader's shared filters.

Only the `/node` subpath imports `node:fs`. Browser and bundled consumers must not import it. Instead, import the raw text (Vite exposes a file's contents with the `?raw` suffix) and hand it to `parsePromptFile` with an explicit `partials` map:

```ts
import txt from "./analyst.prompt.md?raw";
import { parsePromptFile } from "@flow-state-dev/core/prompt-file";

const pf = parsePromptFile(txt, {
  sourcePath: "analyst.prompt.md",
  partials: { preamble: preambleTxt },
});
```

## Wiring into a generator

`definePromptFile(pf)` turns a parsed prompt file into the generator config fields it covers: `prompt`, `user`, `caching`, `maxTokens`, `temperature`, and optionally `name` and `description`. Spread it into the generator.

```ts
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { loadPromptFile } from "@flow-state-dev/core/prompt-file/node";

const pf = loadPromptFile("./analyst.prompt.md", import.meta.url, {
  filters: { format_usd: (n) => `$${n.toFixed(2)}` },
});

export const analyst = generator({
  name: "analyst",
  model: "openai/gpt-5.4-mini",
  ...definePromptFile(pf),
  tools: [searchTool],
  outputSchema: TradeProposalSchema,
});
```

**Or pass the `PromptFile` directly.** If you aren't overriding the file's prompt, hand the whole `PromptFile` to the `prompt` slot and skip the spread:

```ts
export const analyst = generator({
  name: "analyst",
  model: "openai/gpt-5.4-mini",
  prompt: load("analyst.prompt.md"),
  tools: [searchTool],
  outputSchema: TradeProposalSchema,
});
```

This expands the same fields `definePromptFile` covers (`user`, `caching`, `maxTokens`, `temperature`, and optionally `name` / `description`). Any sibling field you set explicitly on the generator wins, just like the spread form — so the precedence rules below apply either way.

**Spread precedence.** Whatever comes after the spread overrides what the spread set. An inline `prompt:` written below `...definePromptFile(pf)` wins over the file's prompt.

**The frontmatter-name footgun.** If the `.md` frontmatter sets `name`, that value flows through `definePromptFile`. Spread after the generator's own `name`, it overrides the generator's `name`. Omit `name` from frontmatter unless you intend the file to name the block.

## Frontmatter reference

| Key | Type | Effect |
|-----|------|--------|
| `name` | string | Sets the block name when spread. Usually omit (see footgun above). |
| `description` | string | Optional human description. |
| `intent` | string | Informational; exposed as `config.intent`. |
| `model` | string | Metadata only. Does not set the generator's model. |
| `caching` | bool or object | `true` / `false`, or `{ enabled, breakpoints, ttl }`. |
| `maxTokens` | number | Max output tokens. |
| `temperature` | number | Sampling temperature. |

## Examples

Minimal:

```liquid
---
description: A concise assistant.
---
<system>
You are a concise assistant. Answer {{ input.topic }} in two sentences.
</system>
```

Default mode, with a filter, a partial, and `ctx.session.state`:

```liquid
<system>
You are the desk analyst for {{ ctx.session.state.ticker }}.
The last close was {{ input.lastClose | format_usd }}.
{% render 'shared-output-preamble' %}
</system>

<user>
Write the analysis memo.
</user>
```

Override mode, reordering and pruning the aggregated context:

```liquid
<system>
You are the risk consolidator. Weigh the inputs below and decide.
</system>

<context>
{% if config.context.risk_assessment %}
<priority>{{ config.context.risk_assessment }}</priority>
{% endif %}
{{ config.context.thesis | default: "" }}
</context>
```

## Errors

| Error | When |
|-------|------|
| `PromptFileLoadError` | File IO failure in `loadPromptFile` (Node). |
| `PromptFileParseError` | Frontmatter parse or validation failure, missing / duplicate / empty `<system>`, unknown filter referenced, missing partial, or template compile failure. All at parse time. |
| Render-time strict-variable error | A `{{ }}` reference to an undefined variable or property. Propagates through the generator's normal error pipeline at run time. |

## Viewing the source in the DevTool

The DevTool's block-trace inspector shows a "Template Source" collapsible section for any generator built from a prompt file. It displays the raw `.md` source alongside the rendered "Prompt", so you can see the template and what it produced for a given run side by side.

## See also

- [Resource content from Markdown templates](./resource-templates-markdown.md) applies the same `.md` format to resource content, rendering templates against resource state instead of generator input.
