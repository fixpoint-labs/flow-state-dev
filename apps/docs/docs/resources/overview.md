---
sidebar_position: 1
---

# Overview

Think of resources as files your AI can work with. Each resource has content — a document, a plan, a code snippet, a template — alongside structured metadata about that content: title, status, tags, timestamps. Both live in one typed container with atomic operations.

Regular scope state is a flat object. Good for flags, counters, mode switches. But when your AI needs to manage artifacts with real content — design documents, research notes, generated code, plans with steps — scope state gets awkward fast. Resources give you named, schema-typed containers where content and metadata coexist naturally.

## defineResource

Declare a reusable resource with `defineResource()`:

```ts
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const artifactResource = defineResource({
  stateSchema: z.object({
    title: z.string().default("Untitled"),
    tags: z.array(z.string()).default([]),
    status: z.enum(["draft", "review", "final"]).default("draft"),
    updatedAt: z.number().default(0),
  }),
  content: "",
  writable: true,
});
```

The `stateSchema` defines the structured metadata. The `content` field holds the body — the "file" part. Both are versioned, both support atomic operations.

Config options:

- **stateSchema** — Zod schema for structured metadata
- **content** — initial content body (a string: markdown, code, prose, anything)
- **contentFile** — load initial content from a file path (mutually exclusive with `content`)
- **render** — template renderer: `(content, state) => string` for interpolating state into content
- **writable** — whether blocks can modify the resource
- **llmReadable**, **llmWritable** — control whether generators can read/write the content

## Resources vs scope state

| | Scope state | Resources |
|--|-------------|-----------|
| **Mental model** | Config flags and counters | Files with structured metadata |
| **Shape** | Flat key-value object | Named container: content body + typed state |
| **Content** | No | Yes — rich text, markdown, code, templates |
| **Identity** | Field names (shared namespace) | Resource name (isolated namespace) |
| **Collision risk** | Fields can conflict across blocks | Each resource is self-contained |

Use **scope state** for simple fields: mode flags, counters, config values. Use **resources** when you're working with content that has structure — documents, plans, artifacts, knowledge bases. See [Storage](/docs/resources/storage) for the full decision guide.

## Working with content

Read content with `readContent()` (renders templates) or `readContentRaw()` (returns the stored body):

```ts
execute: async (input, ctx) => {
  const artifact = ctx.session.resources.get("artifact");

  // Read the content body
  const raw = artifact.readContentRaw();     // "# {{ title }}\n\nDraft content..."
  const rendered = artifact.readContent();   // "# My Document\n\nDraft content..."

  // Read structured metadata
  const { title, status, tags } = artifact.state;
}
```

### Templates

Use `render` to interpolate state into content templates:

```ts
defineResource({
  stateSchema: z.object({
    title: z.string().default("Untitled"),
    author: z.string().default(""),
  }),
  content: "# {{ title }}\n\nBy {{ author }}",
  render: (content, state) =>
    content.replace(/\{\{(\w+)\}\}/g, (_, key) => state[key] ?? ""),
  writable: true,
});
```

`readContent()` returns the rendered result. `readContentRaw()` returns the template with placeholders intact.

## LLM access patterns

Resources are not automatically exposed to generators. Use `llmReadable` and `llmWritable` flags to control access, and wire `readResourceContentTool()` or `writeResourceContentTool()` to a generator's tools array when you want the model to interact with resource content directly.

## Resource namespaces

Static resources have a fixed name. Resource namespaces create typed collections where instances are added dynamically at runtime. Think of them as directories: the namespace defines the schema and constraints, individual instances are the files.

```ts
import { defineResourceNamespace } from "@flow-state-dev/core";

const filesNamespace = defineResourceNamespace({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string().default("text") }),
  maxInstances: 200,
  eviction: "lru",
});
```

Three pattern types:

- **`files/*`** — matches one level (`files/readme.md`, not `files/src/utils.ts`)
- **`files/**`** — matches any depth (`files/readme.md`, `files/src/deep/nested.ts`)
- **`[topic]/observations`** — parameterized segments (`react/observations`, `rust/observations`)

At runtime, namespace entries on `ctx.session.resources` are `ResourceNamespaceRef` instances with `create()`, `get()`, `getOrCreate()`, `list()`, `delete()`, and `count()` methods.

```ts
const ref = await ctx.session.resources.files.create("readme.md", { language: "markdown" });
const allSrc = ctx.session.resources.files.list("src/");
await ctx.session.resources.files.delete("old-file.ts");
```

When `maxInstances` is set, you can configure eviction: `"none"` (throws at cap, the default), `"lru"` (least-recently-accessed), or `"oldest"` (first-created).

Namespaces also support lifecycle hooks (`onInstanceCreated`, `onInstanceUpdated`, `onInstanceDeleted`) for logging, side effects, or cleanup.

Namespace instances are stored alongside static resources in the same flat map — no schema changes needed.

## Block-level resource declarations

Blocks declare resource dependencies with `sessionResources`, `userResources`, and `projectResources`:

```ts
const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => {
    await ctx.session.resources.plan.patchState({ status: "active" });
    return input;
  },
});
```

The block brings its own resource requirements. No need to repeat them in the flow definition.

## Automatic resource collection

Sequencers merge `declaredResources` from all child blocks. `defineFlow` collects resources from action blocks and merges them into the flow's scope configs. Flow-level resource declarations take priority over block-level ones. Blocks are self-documenting: their resource needs bubble up automatically.

## Resource scope levels

| Scope | Lifetime |
|-------|----------|
| **session** | One conversation |
| **user** | Across sessions for a user |
| **project** | Shared across sessions in a project |

Choose the scope that matches the data's lifetime. Session for conversation-local artifacts, user for personal notes and saved snippets, project for shared knowledge bases and team documents.

## Where to go next

- **[Storage](/docs/resources/storage)** — When to use resources vs scope state, scoping decisions, block-private vs shared
- **[State & Scopes](/docs/fundamentals/state-and-scopes)** — Broader state model, clientData, targets
