# Resource Collections

Static resources are declared by name at definition time. You know up front that there's a `plan` resource and an `artifacts` resource. Resource collections handle the case where you don't know how many instances you'll need. An AI managing files, accumulating per-topic observations, or creating workspaces on the fly — these are collection problems.

A collection defines a shared schema and pattern. Instances are created and destroyed at runtime. The property name you assign in `sessionResources` (or `userResources`, `projectResources`) is the key you use to access the collection at runtime — not the pattern string.

```ts
import { defineResourceCollection } from "@flow-state-dev/core";

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string().default("text") }),
  maxInstances: 200,
  eviction: "lru",
});

// In a block definition:
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesCollection },
  //                   ^^^^^ this property name = ctx.session.resources.files
  execute: async (input, ctx) => {
    const files = ctx.session.resources.files;
    // ...
  },
});
```

For background on resources in general, see [Resources and Client Data](./resources-and-client-data.md).

## How access keys work

The property name in `sessionResources` determines how you access the collection on `ctx.session.resources`. The pattern string only affects **storage keys** for instances.

```ts
// You declare:
sessionResources: { docs: myCollection }

// You access:
ctx.session.resources.docs  // ← property name, not the pattern

// Instances are stored under pattern-resolved keys:
// "documents/readme.md", "documents/src/utils.ts", etc.
```

This means the same collection definition can be registered under different property names in different blocks or flows without conflict.

## Patterns

The pattern string determines which keys a collection can hold and how they're matched.

| Pattern | Example keys | Behavior |
|---------|-------------|----------|
| `files/*` | `files/readme.md` | Single-level wildcard. `files/src/utils.ts` would not match. |
| `files/**` | `files/readme.md`, `files/src/deep/nested.ts` | Deep wildcard. Matches any depth. |
| `[topic]/observations` | `react/observations`, `rust/observations` | Parameterized segment. The `[name]` portion becomes a key parameter. |

Constraints:
- `**` must be the last segment
- Parameterized segments use `[name]` syntax
- A collection pattern cannot overlap with another collection pattern or a static resource name in the same scope

## Runtime API — `ResourceCollectionRef`

At runtime, collection entries on scope resource registries (`ctx.session.resources`, `ctx.user.resources`, `ctx.project.resources`) are `ResourceCollectionRef` instances.

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

// Register under any property name you want:
sessionResources: { notes: topicNotes }

// At runtime:
const notes = ctx.session.resources.notes;
const ref = await notes.create({ topic: "react" }, { entries: [] });
// Storage key: "react/notes"

const existing = notes.get({ topic: "rust" });
// Storage key: "rust/notes"
```

The framework resolves `{ topic: "react" }` to the storage key `react/notes`.

## Eviction

When `maxInstances` is set, the collection enforces a cap on live instances. What happens when a `create()` would exceed that cap depends on the eviction policy:

| Policy | Behavior |
|--------|----------|
| `"none"` (default) | Throws an error. The caller must explicitly `delete()` before creating more. |
| `"lru"` | Evicts the least-recently-accessed instance to make room. |
| `"oldest"` | Evicts the first-created instance. |

Setting `eviction` to `"lru"` or `"oldest"` without `maxInstances` throws at definition time. If you don't set `maxInstances`, the collection is unbounded.

Practical guidance: set `maxInstances` for any collection that could grow without limit. An AI that creates files in a loop with no cap will eventually cause memory and storage pressure. `"lru"` is the safest default for most use cases — it keeps the working set and discards stale entries.

## Lifecycle hooks

Collections support per-instance lifecycle hooks for logging, side effects, or cleanup:

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

Hook context (`CollectionHookContext`) provides `log(message)` and `scopeType`. Hooks are synchronous — they run inline during the operation and should not perform heavy I/O.

## Storage model

Collection instances are stored in the same flat `resources` map as static resources. A collection with pattern `files/**` stores instances under keys like `files/readme.md`, `files/src/utils.ts`. No schema changes to scope records are required. This means collection instances are subject to the same persistence and CAS semantics as static resources.

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

Sequencers collect collection declarations from child blocks. `defineFlow` merges them into scope configs. Conflict detection applies: two blocks declaring different collection refs for the same name will throw at build time. If both blocks reference the same `defineResourceCollection()` instance, the merge succeeds.

## When to use collections vs static resources

Use a static resource when you know the resource names at definition time: `plan`, `artifacts`, `preferences`. These are fixed parts of your flow's data model.

Use a collection when instances come and go at runtime. The deciding factors:

- **Unknown count** — you can't enumerate the instances ahead of time
- **Independent lifecycles** — each instance is created, updated, and potentially deleted on its own schedule
- **Pattern-based organization** — instances naturally fit a path structure (`files/src/utils.ts`, `topics/react/notes`)

If the collection is bounded and predictable (say, three artifact slots), a static resource with an array or record in its state is simpler. Collections add value when the set is dynamic and potentially large.

## Canonical Authority

This document is authoritative for resource collections. See also [flows-and-actions.md](./flows-and-actions.md) and [state-and-scopes.md](./state-and-scopes.md). For full type signatures, refer to the published types in `@flow-state-dev/core`.
