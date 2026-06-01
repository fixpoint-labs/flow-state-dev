---
sidebar_label: "Resource templates"
title: "Resource content from Markdown templates"
---

# Resource content from Markdown templates

A resource's content can be rendered from a `.md` template file, the same format used by [generator prompts](./generator-prompts-markdown.md). The template renders against the resource's state, deterministically, with no model call. State fields become template variables; updates to state produce new content on the next read.

The template can be a build-time file on disk or a live-editable resource whose content other blocks modify at runtime.

## When to use it

Use the inline `render` function when content is short and the interpolation is trivial. A one-line Mustache replacement fits fine in TypeScript.

Reach for a `.md` template when the content is long, when multiple resources share the same template structure, or when you want the template itself editable at runtime without redeploying. A 60-line status report reads better as a document than as a chain of string concatenations in a `render` callback.

## The format

Resource templates use the same file format as generator prompt files: YAML frontmatter between `---` fences, followed by a `<system>` body.

```
---
name: status-report
description: Weekly status report template
---
<system>
# Status Report: {{ state.title }}

**Author:** {{ state.author }}
**Week of:** {{ state.weekOf }}

## Summary
{{ state.summary | default: "No summary provided." }}

## Key Results
{{ state.keyResults | default: "None yet." }}
</system>
```

The frontmatter keys `name` and `description` carry metadata about the template. Generator-specific keys like `model`, `caching`, `maxTokens`, and `temperature` are accepted by the parser but inert when used for resource content. They do nothing harmful; they just sit there. The `<user>` and `<context>` sections are generator-only and ignored during resource rendering.

## Rendering against state

The template body is a [LiquidJS](https://liquidjs.com/) template. One top-level variable is in scope.

| Variable | What it is |
|----------|------------|
| `state` | The resource's current state object, matching its `stateSchema`. |

So if your `stateSchema` declares `title`, `author`, and `tags`, the template reads them as `{{ state.title }}`, `{{ state.author }}`, `{{ state.tags | join: ", " }}`.

`strictVariables` is on. Referencing a property that does not exist on the state throws at render time. Use the `default` filter for optional fields:

```liquid
{{ state.note | default: "" }}
```

This is different from the inline `content` + `render` approach on `defineResource`, where you write your own interpolation function. Templates use LiquidJS with the full filter library. If you have used generator prompt files, the rendering model is the same, just with `state` in place of `input` / `ctx` / `config`.

## A template in a file

`loadResourceTemplate` reads a `.md` file from disk and returns a parsed template object. Pass it to `contentTemplate` on the resource definition.

```ts
import { defineResource } from "@flow-state-dev/core";
import { loadResourceTemplate } from "@flow-state-dev/core/resource-template/node";
import { z } from "zod";

const reportTemplate = loadResourceTemplate("./report.prompt.md", import.meta.url);

const report = defineResource({
  stateSchema: z.object({
    title: z.string().default("Untitled"),
    author: z.string().default(""),
    summary: z.string().default(""),
  }),
  contentTemplate: reportTemplate,
  writable: true,
});
```

`readContent()` renders the template against the current state. `readContentRaw()` returns the raw template source. No `render` function needed.

`contentTemplate` and `render` are mutually exclusive. If both are present, the definition throws at build time.

## A template in a resource (live-editable)

When the template itself should be editable at runtime, point to another resource that holds the template content with `contentTemplateRef`.

```ts
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const templateSource = defineResource({
  stateSchema: z.object({}),
  content: "<system>\n# {{ state.title }}\n{{ state.body }}\n</system>",
  writable: true,
});

const document = defineResource({
  stateSchema: z.object({
    title: z.string().default("Untitled"),
    body: z.string().default(""),
  }),
  contentTemplateRef: "template-source",
  writable: true,
});
```

The `contentTemplateRef` value is the resource name as declared in the flow or block's resource map. When a block calls `document.readContent()`, the framework reads the current content of the referenced template resource, parses it as a prompt file, and renders it against `document`'s state.

Edit the template resource's content with `writeContent()`, and the next `readContent()` on the referencing resource picks up the change. This is useful for flows where a model or user refines the template over multiple turns.

`contentTemplateRef` is mutually exclusive with `content`, `contentFile`, `contentTemplate`, and `render`. Declaring more than one content source throws at build time.

## Safety and limits

Template rendering is sandboxed to the resource's own state.

- The `state` scope is the only top-level variable. There is no access to `ctx`, `input`, session state, or other resources.
- Property access is `ownPropertyOnly`. Prototype properties are not reachable from the template.
- Templates that exceed the size limit (default 512 KB) throw a `ResourceTemplateParseError` rather than producing unbounded output.

These constraints keep resource templates deterministic and predictable. If you need full context access, conditional logic across resources, or model-aware rendering, use a handler that reads the state and writes content explicitly.

## See also

- [Prompts as Markdown](./generator-prompts-markdown.md) for the full `.md` file format, LiquidJS templating, partials, and custom filters
- [Resources overview](/docs/resources/overview) for the resource API and `readContent` / `readContentRaw` semantics
