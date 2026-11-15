---
title: Keep prompts in Markdown files
type: recipe
description: "Move a generator's system prompt into a separate Markdown file and load it back."
---

# Keep prompts in Markdown files

A generator is a block that calls a model, and its prompt is the prose the model reads. While that prose is short, an inline string is the right home. When it runs past a screen, fills with `${...}` interpolation, or gets copied across generators, the prompt is buried in TypeScript quoting.

You can move it into a `.md` file and load it back. Inline prompts and file prompts work side by side, so move only the prompts that have outgrown a string. Skip a three-line instruction; it gains nothing from a file.

This page moves the `draftReply` generator of the support desk onto a prompt file. For every option and error, see the [Markdown templates reference](../reference/markdown-templates.md).

## Step 1: Move the prose into a `.md` file

Create the file beside the block, named `<block>.prompt.md`. The prose goes in a `<system>` section, which every prompt file needs. A `<user>` section is optional and holds a fixed user message for each turn. Frontmatter, the YAML between `---` fences, is optional too.

```liquid title="src/flows/support/blocks/draft-reply.prompt.md"
---
description: Answers a customer support message
---
<system>
You answer customer support messages. Be brief and specific.
</system>

<user>
Customer message:
{{ input }}
</user>
```

Text outside the sections is ignored. The model, the schemas, the tools and the context stay in TypeScript; the file holds prose only.

## Step 2: Replace interpolations with Liquid

The body is a Liquid template, not a JavaScript template literal. Write `{{ input }}` where the old prompt wrote `${input}`. The template reads `input` (what the generator was called with), `ctx` (the block context, such as `ctx.session.state`) and `config` (the resolved generator settings).

:::warning
`${input}` is not interpreted. It reaches the model as the literal characters `${input}`.
:::

A variable that does not exist throws when the prompt renders. For an optional value, write `{{ input.note | default: "" }}`. To render a list or a table without flattening it in TypeScript, use a built-in filter such as `{{ input.items | fsd_table }}`. The [reference](../reference/markdown-templates.md) lists the variables, the filters and the sections that differ.

## Step 3: Load it into the generator

Pass the loaded file to the `prompt` slot. The `<user>` section replaces the old `user` line, so that line goes.

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { loadPromptFile } from "@flow-state-dev/engine/prompt-file";
import { z } from "zod";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: loadPromptFile("./draft-reply.prompt.md", import.meta.url),
  inputSchema: z.string(),
  itemVisibility: { client: true, history: true },
});
```

`loadPromptFile` reads the file when your code loads it and throws if the file is unreadable, has bad frontmatter or lacks a `<system>` section. The generator takes the file's `<user>` section and frontmatter values too. A field you write next to `prompt` wins over the file's.

Do not put `name` in the frontmatter when you spread the file with `...definePromptFile(pf)` from `@flow-state-dev/core/prompt-file`. The spread would overwrite the generator's own name. The `prompt:` form above keeps yours.

`loadPromptFile` needs Node. In a browser bundle, import the raw text and call `parsePromptFile`; the reference covers that path.

## Step 4: Check the rendered prompt

Run `fsdev dev` and send a message. Open the `draft-reply` block in the DevTool. Its detail shows the rendered Prompt, and a Template Source section shows the raw `.md` text beside it. Look for stray `${...}` and for empty values.

## Share a fragment between prompts

A partial is another `.md` file that a prompt pulls in. Put the lines every support prompt repeats in `src/flows/support/blocks/_partials/house-style.md`:

```liquid title="src/flows/support/blocks/_partials/house-style.md"
Write in plain sentences. Never promise a refund date.
```

In the prompt, add `{% render 'house-style' %}` inside `<system>`. The name is the file name without `.md`. `render` runs the partial in its own scope, so it cannot read the caller's variables. A missing partial fails when the file loads.

Sibling `.md` files register as partials on their own. To keep them in a `_partials` directory, build one loader for the flow:

```ts title="src/flows/support/prompts.ts"
import path from "node:path";
import {
  createPromptLoader,
  moduleDir,
  resolveBaseDir,
} from "@flow-state-dev/engine/prompt-file";

const flowDir = resolveBaseDir(
  [moduleDir(import.meta.url), path.resolve(process.cwd(), "src/flows/support")],
  { expect: "flow.ts" },
);

export const loadPrompt = createPromptLoader(path.join(flowDir, "blocks"), {
  partialsDir: path.join(flowDir, "blocks/_partials"),
});
```

`draftReply` then calls `loadPrompt("draft-reply.prompt.md")`. `resolveBaseDir` takes the first candidate that exists and contains the `expect` path. The first candidate works under vitest, tsx and `fsdev run`. The `process.cwd()` one covers Next.js, where `import.meta.url` is a virtual path. Keep both if your app is bundled.

## Next

- [Markdown templates](../reference/markdown-templates.md) for every variable, filter, section, loader option and error.
- [Generators and tools](../concepts/generators-and-tools.md) for the `context` slot a `<context>` section reorders.
- [Debug a run](./debug-a-run.md) for reading a block's trace.
