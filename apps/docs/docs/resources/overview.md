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
- **contentFile** — load initial content from a file path (mutually exclusive with `content`). A bare string resolves from the working directory; pass `{ path, importerUrl: import.meta.url }` to resolve relative to the declaring module instead
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

Use **scope state** for simple fields: mode flags, counters, config values. Use **resources** when you're working with content that has structure — documents, plans, artifacts, knowledge bases. See [State vs Resources](/docs/resources/storage) for more guidance on when to use which.

## When resources load

A request doesn't load every resource the flow knows about. It loads what the dispatched action and its blocks actually declare, in three tiers.

**Flow-level resources** are declared in `defineFlow({ resources })`. They load at the start of every request, before any action runs. Use this tier for data every action needs.

**Action-level resources** are declared somewhere inside a dispatched action's block tree (a block's `resources` field, or a sequencer that bubbles them up). They load when that action runs. If a request dispatches the `chat` action, only `chat`'s resources load — a sibling `summarize` action's resources stay untouched.

So a `userProfile` declared at flow level loads on every request, while a `chatHistory` collection declared on the chat handler block loads only when the chat action dispatches:

```ts
defineFlow({
  kind: "assistant",
  // Loads on every request:
  resources: { userProfile: userProfileResource },
  actions: {
    // chatHistory (declared on chatHandler) loads only when chat dispatches:
    chat: { block: chatHandler },
    summarize: { block: summarizeHandler },
  },
});
```

There's a third tier for resources you want to defer even further. A `prefetchMode: 'lazy'` resource skips the action-level burst: a lazy single resource loads when the specific block that declares it dispatches, and a lazy collection loads per access (one store read per key you touch). `prefetchMode` is a cost optimization, not an API change. Collection reads (`get`, `getOptional`, `list`, `count`) are async in both modes, so you `await` them either way; eager just resolves against a preloaded cache while lazy fetches on demand. The default is `'eager'`. Lazy is worth reaching for on large or unbounded collections where you only read a handful of keys per request. See [Eager vs lazy collections](/docs/resources/collections#eager-vs-lazy-collections) for the read semantics and tradeoffs.

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

### Templates from Markdown files

For longer or shared templates, you can author resource content as a `.md` file using the same format as generator prompt files: YAML frontmatter plus a LiquidJS `<system>` body that renders against the resource's state. Load it with `loadResourceTemplate` and pass it as `contentTemplate`, or point at a live-editable resource with `contentTemplateRef`. See [Resource content from Markdown templates](/docs/advanced/resource-templates-markdown) for the full walkthrough.

## LLM access patterns

Resources are not automatically exposed to generators. Use `llmReadable` and `llmWritable` flags to control access, and wire `readResourceContentTool()` or `writeResourceContentTool()` to a generator's tools array when you want the model to interact with resource content directly.

## Resource collections

Static resources have a fixed name. Resource collections let you create typed sets of resources dynamically at runtime — useful when the number of instances isn't known ahead of time (file collections, per-topic knowledge, dynamic workspaces).

```ts
import { defineResourceCollection } from "@flow-state-dev/core";

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string().default("text") }),
  maxInstances: 200,
  eviction: "lru",
});
```

See [Resource Collections](/docs/resources/collections) for the full reference: patterns, runtime API, eviction, lifecycle hooks, and storage model.

To run a block when a resource or collection changes (emitting items, calling models, visible in traces), bind it with `reactTo`. See [Reactive blocks](/docs/resources/reactive-blocks).

## Block-level resource declarations

Blocks declare resource dependencies with `sessionResources`, `userResources`, and `orgResources`:

```ts
const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (_input, ctx) => {
    await ctx.session.resources.plan.patchState({ status: "active" });
  },
});
```

The block brings its own resource requirements. No need to repeat them in the flow definition.

### Fetch once, share by name: `getOrPatchState`

When several blocks in a run need the same fetched or computed value, write it into a resource the first time and let everyone else read that copy. `getOrPatchState(key, compute)` does exactly that: it returns `state[key]` if it's already there, and otherwise runs `compute`, stores the result under `key`, and returns it. The callback runs only on a miss, so the fetch happens once.

```ts
const fundamentals = await ctx.resources.financials.getOrPatchState(
  "fundamentals",
  () => fetchFundamentals(ticker),
);
```

This is a per-resource data spine, not a cache — there's no time-based expiry. A session-scoped resource keeps one stable copy of the data a run used, addressable by name, that any later block reads without re-fetching. A stored `null` counts as present (the callback won't re-run); a `compute` that returns `undefined` stores nothing. Concurrent misses on the same key within a request are single-flighted — they share one `compute` call, so fanning the same key out across parallel blocks issues a single upstream fetch. Distinct keys still compute in parallel and never block each other.

## Automatic resource collection

Sequencers merge `declaredResources` from all child blocks. `defineFlow` collects resources from action blocks and merges them into the flow's scope configs. Flow-level resource declarations take priority over block-level ones. Blocks are self-documenting: their resource needs bubble up automatically.

## Only declared resources load

A request loads content only for the resources the flow declares. The execution context resolves each declared fixed resource by its storage key and each collection by its pattern prefix, then reads exactly those from the content store. Content that no block or flow declares is never pulled into the context.

```ts
defineFlow({
  kind: "writer",
  resources: {
    draft: defineResource({ scope: "session", stateSchema: z.object({}) }),
  },
  // ...actions
});
```

Here a request loads the `draft` content and nothing else, even if other keys exist in the session scope from another flow or an earlier design. Declaring what you use keeps per-request loading proportional to the flow rather than to everything stored in the scope. The full set of stored content for a scope is still available through the [state endpoint](/docs/fundamentals/state-and-scopes); the scoping applies to the per-request execution context, not to the persisted data.

## Resource scope levels

| Scope | Lifetime |
|-------|----------|
| **session** | One conversation |
| **user** | Across sessions for a user |
| **org** | Shared across sessions in an org |

Choose the scope that matches the data's lifetime. Session for conversation-local artifacts, user for personal notes and saved snippets, org for shared knowledge bases and team documents.

## Resource identity: path, scope, and uri

Every resource handle you read, whether it points at a single resource or one instance inside a collection, carries three identity fields: `path`, `scope`, and `uri`. They're set when the handle is created and never change.

### path — the within-scope storage key

`path` is the slash-delimited string a resource is persisted under. For a collection with the pattern `files/**`, calling `create("readme.md")` gives you a handle whose `path` is `"files/readme.md"`. Parameterized patterns resolve the same way: a `[topic]/notes` pattern with `{ topic: "react" }` produces `path === "react/notes"`.

`path` is a plain string, not a filesystem path object. Manipulate it with ordinary string methods like `.split("/")` or `.startsWith(...)`. There's no path-library behavior implied: no segment normalization, no `..` traversal.

### scope — the lifetime tier

`scope` is one of `"session"`, `"user"`, or `"org"`, matching the scope the resource was defined under. It tells you how long the value lives (see [State & Scopes](/docs/fundamentals/state-and-scopes)).

### uri — `${scope}/${path}`

`uri` is the fully qualified identifier: the scope and the path joined with a slash. A session-scoped handle with `path === "files/readme.md"` has `uri === "session/files/readme.md"`. It's stable and unique across scopes within a flow, which makes it useful for logging, deduplication, or cross-scope addressing.

Treat `uri` as opaque. It is not an RFC-3986 URI, so don't feed it to `new URL()`. It's a plain identifier string.

```ts
console.log(ref.path, ref.scope, ref.uri);
// "files/readme.md"  "session"  "session/files/readme.md"
```

See [Resource Collections](/docs/resources/collections) for how parameterized patterns build these paths.

## Where to go next

- **[State vs Resources](/docs/resources/storage)** — When to use resources vs scope state, scoping decisions, shared vs block-private
- **[Resource Collections](/docs/resources/collections)** — Dynamic collections with patterns, eviction, and lifecycle hooks
- **[Reactive blocks](/docs/resources/reactive-blocks)** — Run a block automatically when a resource changes, inside the originating turn
- **[Client Access](/docs/resources/client-access)** — Exposing resources to the frontend: visibility config, React hooks, content endpoints
- **[State & Scopes](/docs/fundamentals/state-and-scopes)** — Broader state model, clientData, targets
