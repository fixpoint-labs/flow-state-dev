---
sidebar_position: 3
---

# Resource Collections

Static resources have a fixed name you declare up front: `plan`, `artifacts`, `preferences`. Resource collections handle the case where you don't know how many instances you'll need. An AI managing a set of files, accumulating observations per topic, or creating workspaces on the fly — these are collection problems.

A collection defines a shared schema and a key pattern. Instances are created and destroyed at runtime. The **property name** you assign in `sessionResources` is how you access it at runtime — not the pattern string.

```ts
import { defineResourceCollection } from "@flow-state-dev/core";

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string().default("text") }),
  maxInstances: 200,
  eviction: "lru",
});

// Register under any property name:
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesCollection },
  //                   ^^^^^ this is the access key
  execute: async (input, ctx) => {
    const files = ctx.session.resources.files;  // ← access via property name
    await files.create("readme.md", { language: "markdown" });
    return input;
  },
});
```

## Patterns

The pattern string determines which keys a collection can hold.

| Pattern | Example keys | Behavior |
|---------|-------------|----------|
| `files/*` | `files/readme.md` | Single-level wildcard. `files/src/utils.ts` would not match. |
| `files/**` | `files/readme.md`, `files/src/deep/nested.ts` | Deep wildcard. Matches any depth. |
| `[topic]/notes` | `react/notes`, `rust/notes` | Parameterized segment. The bracketed portion becomes a key parameter. |

`**` must be the last segment. Parameterized segments use `[name]` syntax.

## Runtime API

Collection entries on scope resource registries are `ResourceCollectionRef` instances.

### Core operations

```ts
execute: async (input, ctx) => {
  const files = ctx.session.resources.files;

  // Create a new instance — returns a ResourceRef
  const ref = await files.create("readme.md", { language: "markdown" });

  // Get existing instance (throws if not found)
  const existing = files.get("utils.ts");

  // Get or create — returns existing if present, creates with defaults if not
  const safe = await files.getOrCreate("config.json", { language: "json" });

  // List all instances, optionally filtered by prefix
  const allFiles = files.list();
  const srcFiles = files.list("src/");

  // Delete an instance (no-op if not found)
  await files.delete("old-file.ts");

  // Current instance count
  const count = files.count();
}
```

Each returned `ResourceRef` supports the same operations as a static resource: `state`, `patchState()`, `setState()`, `updateState()`, `readContent()`, `readContentRaw()`.

### Parameterized patterns

When a pattern has `[name]` segments, pass an object key instead of a string:

```ts
const topicNotes = defineResourceCollection({
  pattern: "[topic]/notes",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
});

// Register under any property name:
sessionResources: { notes: topicNotes }

// At runtime:
const notes = ctx.session.resources.notes;
const ref = await notes.create({ topic: "react" }, { entries: [] });
// Storage key: "react/notes"

const existing = notes.get({ topic: "rust" });
```

The framework resolves `{ topic: "react" }` to the storage key `react/notes`.

## Eviction

When `maxInstances` is set, the collection enforces a cap on live instances:

| Policy | Behavior |
|--------|----------|
| `"none"` (default) | Throws when the cap is reached. You must `delete()` before creating more. |
| `"lru"` | Evicts the least-recently-accessed instance. |
| `"oldest"` | Evicts the first-created instance. |

Setting `eviction` to `"lru"` or `"oldest"` without `maxInstances` throws at definition time. Without `maxInstances`, the collection is unbounded.

Set `maxInstances` for any collection that could grow without limit. An AI creating files in a loop with no cap will cause memory and storage pressure. `"lru"` is the safest default — it keeps the working set and discards stale entries.

## Lifecycle hooks

Collections support per-instance hooks for logging, side effects, or cleanup:

```ts
defineResourceCollection({
  pattern: "files/**",
  stateSchema: fileSchema,
  onInstanceCreated: (key, state, ctx) => {
    ctx.log(`Created: ${key}`);
  },
  onInstanceUpdated: (key, state, prevState, ctx) => {
    ctx.log(`Updated: ${key}`);
  },
  onInstanceDeleted: (key, ctx) => {
    ctx.log(`Deleted: ${key}`);
  },
});
```

Hook context provides `log(message)` and `scopeType`. Hooks are synchronous.

## Block declarations

Collections work with block-level resource declarations the same way static resources do:

```ts
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesCollection },
  execute: async (input, ctx) => {
    const ref = await ctx.session.resources.files.create("output.md", {
      language: "markdown",
    });
    return input;
  },
});
```

Sequencers collect collection declarations from child blocks. `defineFlow` merges them into scope configs. Two blocks declaring different collection refs for the same name will throw at build time. Same ref instance, no conflict.

## Storage model

Collection instances are stored in the same flat `resources` map as static resources. A collection with pattern `files/**` stores instances under keys like `files/readme.md` and `files/src/utils.ts`. No schema changes to scope records are needed.

## When to use collections vs static resources

Static resources work when you know the names ahead of time. Collections work when you don't.

The deciding factors:
- **Unknown count** — you can't enumerate the instances at definition time
- **Independent lifecycles** — each instance is created, updated, and potentially deleted on its own schedule
- **Pattern-based organization** — instances naturally fit a path structure

If the set is bounded and predictable (three artifact slots), a static resource with an array or record in its state is simpler. Collections add value when the set is dynamic and potentially large.
