---
title: Keep prompts in Markdown files
type: recipe
description: "Move a generator's system prompt into a separate Markdown file and load it back."
---

# Keep prompts in Markdown files

A generator is a block that calls a model, and its prompt is the prose the model reads. While that prose is short, an inline string is the right home. When it runs past a screen, fills with `${...}` interpolation, or gets copied across generators, the prompt is buried in TypeScript quoting.

You can move it into a `.md` file and load it back. Inline and file prompts work side by side, so move only the prompts that have outgrown a string.

This page moves the `draftReply` generator of the support desk onto a prompt file. For every option and error, see the [Markdown templates reference](../reference/markdown-templates.md).

## Step 1: Move the prose into a `.md` file

Create the file beside the block, named `<block>.prompt.md`. The prose goes in a `<system>` section, which every prompt file needs. A `<user>` section is optional and holds the user message sent each turn, written as a template. Frontmatter, the YAML between `---` fences, is optional too.

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

Text outside the sections is ignored. The model, schemas, tools and context stay in TypeScript.

## Step 2: Replace interpolations with Liquid

The body is a Liquid template, not a JavaScript template literal. Write `{{ input }}` where the old prompt wrote `${input}`. The template reads `input` (what the generator was called with), `ctx` (the block context, such as `ctx.session.state`) and `config` (the resolved generator settings).

:::warning
`${input}` is not interpreted. It reaches the model as the literal characters `${input}`.
:::

A variable that does not exist throws when the prompt renders. For an optional value, write `{{ input.note | default: "" }}`. The [reference](../reference/markdown-templates.md) lists the variables, filters and sections.

## Step 3: Load it into the generator

Pass the loaded file to the `prompt` slot. If your generator sets `user`, delete it: the file's `<user>` section takes its place.

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

`loadPromptFile` reads the file when your code loads it and throws if the file is unreadable, has bad frontmatter or lacks a `<system>` section. The generator takes the file's `<user>` section and frontmatter values too. A field you write next to `prompt` wins over the file's. Frontmatter `model` does nothing: the model stays the one set in TypeScript. Leave `name` out of the file. With `prompt:` your `name` wins, but if you spread `...definePromptFile(pf)` after the generator's `name`, the file's `name` overwrites it, and items carry that name.

`loadPromptFile` needs Node; the reference covers browser bundles.

## Step 4: Check the rendered prompt

Run `fsdev dev`, send a message, and open the `draft-reply` block in the DevTool. It shows the rendered Prompt and the raw `.md` under Template Source. Look for stray `${...}` and empty values.

## Who can change the prompt

A prompt file is source code. Only a change in your repository, through code review, can edit it. The model, the customer and the generator's run cannot, and nothing in the framework writes it.

The file is read when `loadPromptFile` runs, which for a module-level call is when the module is imported. Editing it while the server runs changes nothing until the module loads again.

## Share a fragment between prompts

A partial is another `.md` file a prompt pulls in. Every other `.md` file beside the prompt file loads as one. Put lines every support prompt repeats in `src/flows/support/blocks/house-style.md`, beside `draft-reply.prompt.md`:

```liquid title="src/flows/support/blocks/house-style.md"
Write in plain sentences. Never promise a refund date.
```

In the prompt, add `{% render 'house-style' %}` inside `<system>`. The name is the file name without `.md`. `render` runs the partial in its own scope, so it cannot read the caller's variables. A missing partial fails when the file loads.

### Keep partials in their own directory

To move partials into `src/flows/support/blocks/_partials/`, build one loader for the flow and point it there:

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

`draftReply` then calls `loadPrompt("draft-reply.prompt.md")`. `resolveBaseDir` takes the first candidate holding `expect`. Under Next.js `import.meta.url` is a virtual path, so the `process.cwd()` candidate covers it.

## Render a resource from a template

A resource's content can render from a Markdown template against one variable, `state`, the resource's own state. There is no `input`, `ctx`, session state or other resource, and no model call. A missing state field throws on read, so use `default`.

`contentTemplate: { path, importerUrl: import.meta.url }` renders a file. It is app code: only developers edit it, and every session shares it. `contentTemplateRef: "<resource name>"` uses another resource's content as the template instead. It is re-read on every `readContent()`, so a `writeContent()` on it changes the next read. Set `writable: true` there; block code can write it, a client only if the resource declares `client` access. That resource lives in its own scope, so if it is `session`-scoped, one customer's edit does not touch another's summary. A resource takes one content source; `defineResource` throws at build time if you set two.

## Next

- [Markdown templates](../reference/markdown-templates.md) for every variable, filter, section, loader option and error.
- [Generators and tools](../concepts/generators-and-tools.md) for the `context` slot a prompt's text is assembled from.
- [Debug a run](./debug-a-run.md) for reading a block's trace.
