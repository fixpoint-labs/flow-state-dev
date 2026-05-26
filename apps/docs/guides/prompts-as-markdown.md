---
sidebar_label: Moving prompts to Markdown
---

# Moving generator prompts into Markdown files

A generator's system prompt is prose the model reads. When that prose is short, an inline TypeScript string is the right home. When it grows past a screen or two, gets templated with lots of `${...}` interpolation, or gets copied across several generators, the TypeScript file starts working against you. The prompt is the thing you want to read and edit, and it is buried in string concatenation.

You can move the prompt into a separate `.md` file and load it back into the generator. This guide walks through the migration. Nothing forces you to do it: inline prompts keep working exactly as before. Migrate the prompts that have outgrown the inline form, and leave the rest alone.

For the full format and API, see the [Prompts as Markdown reference](/docs/advanced/generator-prompts-markdown).

## Pick a prompt to extract

Good candidates:

- Long prose. A 100-line system prompt is a document, not a string literal.
- Shared fragments. If two generators paste the same preamble, that preamble wants to be a partial (a reusable template fragment).
- Prompts you review on their own. Pulling them out of TypeScript makes diffs about the prose, not the quoting.

Skip the short ones. A three-line instruction gains nothing from a file.

## Step 1 — Move the prose into a `.md` file

Create a file next to the generator, conventionally `<name>.prompt.md`. Put the system prose inside a `<system>` section. Frontmatter (the YAML metadata between `---` fences) is optional; add a `description` if it helps readers.

```liquid
---
description: Fundamentals analyst — synthesizes a thesis from financials
---
<system>
Identity: fundamentalsAnalyst — Fundamentals Analyst.
Synthesize a thesis from the financial data provided.
</system>

<user>
Synthesize the thesis from the data provided above. Return the JSON object only.
</user>
```

The `<user>` section is optional. Use it for the current-turn user message when it is fixed prose.

## Step 2 — Identify interpolated values

Find every value the old TypeScript prompt computed or interpolated, and rewrite it in LiquidJS. The template can read three variables: `input` (the generator's typed input), `ctx` (the block context, with `ctx.session.state`, `ctx.resources.<name>`, and so on), and `config` (the resolved generator config).

So `${input.ticker}` becomes `{{ input.ticker }}`, and `${ctx.session.state.date}` becomes `{{ ctx.session.state.date }}`.

:::warning Liquid uses `{{ }}`, not `${ }`
The body is a Liquid template, not a JavaScript template literal. If you write `${input.ticker}` out of habit, Liquid does not interpret it. It renders the literal characters `${input.ticker}` straight into the prompt the model sees. Use `{{ input.ticker }}`.
:::

Strict-variable checking is on, so a reference to something that does not exist throws at render time instead of quietly producing an empty string. For genuinely optional values, supply a fallback: `{{ input.note | default: "" }}`.

## Step 3 — Wire it back into the generator

Load the file and spread it into the generator. `definePromptFile` fills the `prompt`, `user`, `caching`, `maxTokens`, and `temperature` fields from the file.

```ts
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { loadPromptFile } from "@flow-state-dev/core/prompt-file/node";

const pf = loadPromptFile("./fundamentals.prompt.md", import.meta.url);

export const fundamentalsGenerator = generator({
  name: "fundamentals-analyst-generator",
  model: "openai/gpt-5.4-mini",
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(pf),
  outputSchema: thesisOutputSchema,
});
```

If you aren't overriding the prompt, you can skip the spread and pass the `PromptFile` straight to the `prompt` slot — `prompt: pf`. It expands the same fields, and explicit sibling fields still win. Use whichever reads better.

Two things to watch:

- **Spread precedence.** Anything written after `...definePromptFile(pf)` overrides what the spread set. That is the lever for keeping an inline override if you need one. The same precedence holds when you pass the `PromptFile` directly.
- **The frontmatter `name` footgun.** If the `.md` frontmatter sets `name`, it flows through `definePromptFile`. Spread after the generator's own `name`, it overwrites it. Leave `name` out of frontmatter unless you mean for the file to name the block.

In the browser, `loadPromptFile` is not available, since it reads the file system. Import the raw text instead (Vite exposes file contents with the `?raw` suffix) and hand it to `parsePromptFile` with an explicit `partials` map. The reference page covers this path.

## Step 4 — Confirm in the DevTool

Run the flow and open the block-trace inspector for the generator. It shows a "Template Source" section with the raw `.md` text next to the rendered "Prompt". Check that the rendered prompt is what you expected: interpolations filled, no stray `${...}`, no missing values. The side-by-side view is the fastest way to catch a templating mistake.

## Worked example: the trading-desk analysts

The trading-desk example shows the migration on real prompts. Each Phase 1 analyst used to carry its full system prompt as an inline string in `prompts.ts`, and every one of them repeated the same output-schema preamble: "Your output schema is enforced by the framework. Return a single JSON object…".

After the migration, each analyst's prompt lives in its own file under `phase-1/prompts/`, and the repeated preamble lives once as a partial.

A partial is just another `.md` file. In Node, `loadPromptFile` auto-registers sibling `.md` files in the prompt's directory as partials, named by filename. The shared preamble sits in a `_partials` directory and gets pulled in with `{% render 'shared-output-preamble' %}`:

```liquid
<system>
{% render 'phase1-analyst-preamble' %}

Identity: fundamentalsAnalyst — Fundamentals Analyst.
Synthesize a thesis from the financial data provided.

{% render 'shared-output-preamble' %}
</system>
```

`{% render %}` runs the partial in an isolated scope, so the partial cannot accidentally read or clobber the caller's variables. That is the safer default. There is also `{% include %}`, which shares the caller's scope; reach for it only when you specifically need that.

The example loads prompts through a small wrapper, `loadDeskPrompt`, built on `createPromptLoader` — it anchors paths at `process.cwd()` and points every `{% render %}` at the shared `_partials` directory, so each call site is just a filename. Anchoring at the working directory rather than `import.meta.url` is a deliberate call here, because the Next.js bundler makes `import.meta.url` unreliable for resolving sibling files. If your app bundles prompts, watch for the same issue.

### Reaching for context override

The analyst prompts above are default mode: the rendered `<system>` fills the system half, and the framework appends the aggregated XML context after it, exactly as it does for an inline prompt.

Sometimes the default ordering of that context does not match how you want the model to read it. A risk-consolidation prompt, for instance, might want to promote one input above the rest and drop the others. That is what the `<context>` section is for. Adding it suppresses the framework's default append and lets the template position the context itself, reading the aggregated map through `config.context`:

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

Here the template emphasizes the risk assessment, gates it on presence, and silently drops any aggregated key it does not name. You still declare the context entries on the generator's `context:` slot; the template only reorders and prunes the computed result. See [Generator context](/docs/advanced/generator-context) for how that aggregated map is built.
