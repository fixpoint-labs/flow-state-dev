# Resources and Client Data

Resources are **concrete persisted data** attached to a scope. Client data entries are **derived views** computed from state and resources — the mechanism for exposing server-side data to clients. Together, they provide structured, typed data management within flows.

## Resources

A resource is a named, schema-typed data container associated with a scope (session, user, or project).

```ts
// Inline in flow definition
session: {
  resources: {
    plan: {
      stateSchema: z.object({
        steps: z.array(z.string()).default([]),
        status: z.enum(["draft", "active", "complete"]).default("draft"),
      }),
      writable: true,
    },
  },
}
```

### Resource Config

```ts
type ResourceConfig = {
  stateSchema: ZodTypeAny;     // Required: defines the data shape
  default?: JsonValue;          // Default initial value
  content?: string;             // Optional definition-time content body
  contentFile?: string;         // Optional path to initial content template
  render?: (content: string, state: JsonObject) => string | Promise<string>; // Optional renderer
  llmReadable?: boolean;        // Allows read tool access when readResourceContentTool is installed
  llmWritable?: boolean;        // Allows write tool access when writeResourceContentTool is installed
  dynamic?: boolean;            // Resolved at runtime
  writable?: boolean;           // Allow mutation from blocks
  allowedExtensions?: string[]; // Content type restrictions
  metadata?: Record<string, unknown>;
};
```


### Resource Content

Resources can also carry file-like text content. Use `content` for inline templates or `contentFile` to load at startup (mutually exclusive). `contentFile` is resolved relative to `process.cwd()` — use absolute paths for predictable behavior.

- `readContent()` returns rendered content (`string`) or `null` if no content exists.
- `readContentRaw()` returns the stored raw body (`string`) or `null`.
- Empty content (`""`) is valid and distinct from `null`.
- Template rendering is **opt-in** via `render`, e.g. `render: renderTemplate` from `@flow-state-dev/server`. Nested `{{#each}}` blocks are not supported. Templates longer than 512 KB are rejected.
- LLM content access is **tool-driven and opt-in**. Add `readResourceContentTool()` / `writeResourceContentTool()` to a generator's `tools` list when you want these capabilities available.

```ts
const soul = defineResource({
  stateSchema: z.object({ values: z.array(z.string()), tone: z.string() }),
  content: "## Values\n{{#each values}}- {{this}}\n{{/each}}Tone: {{tone}}",
  render: renderTemplate,
  llmReadable: true,
  llmWritable: false,
});
```

### Accessing Resources

Resources are accessed through scope handles in `BlockContext`:

```ts
// Read resource state
const plan = ctx.session.resources.plan;
const steps = plan.state.steps;

// Mutate resource state
await plan.patchState({ status: "active" });
await plan.setState({ steps: ["step1", "step2"], status: "draft" });
await plan.updateState((current) => ({
  ...current,
  steps: [...current.steps, "new-step"],
}));
```

### Portable Resource Definitions

For resources shared across flows, use `defineResource`:

```ts
import { defineResource } from "@flow-state-dev/core";

export const planResource = defineResource({
  stateSchema: z.object({
    steps: z.array(z.string()).default([]),
    status: z.enum(["draft", "active", "complete"]).default("draft"),
  }),
  writable: true,
});

// Use in flow
session: {
  resources: { plan: planResource },
}
```

`defineResource` exposes `StateType` and `ContextType` helpers for typing shared helper functions:

```ts
type PlanState = typeof planResource.StateType;
type PlanContext = typeof planResource.ContextType;

async function addStep(ctx: PlanContext, step: string) {
  await ctx.updateState((plan) => ({
    ...plan,
    steps: [...plan.steps, step],
  }));
}
```

### Resource Namespaces

Static resources are declared by name at definition time. Resource namespaces let you create typed collections of resources dynamically at runtime — useful when the number of instances isn't known ahead of time (file collections, per-topic knowledge stores, dynamic workspaces).

See [Resource Namespaces](./resource-namespaces.md) for the full reference: patterns, runtime API, eviction, lifecycle hooks, and storage model.

### Block-Level Resource Declarations

Blocks can declare their resource dependencies directly using `sessionResources`, `userResources`, and `projectResources` properties. These accept `defineResource()` values:

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

Declared resources surface on `BlockDefinition.declaredResources` as metadata. This enables automatic resource collection — blocks declare what they need, and the framework ensures those resources are available at runtime.

#### Sequencer Resource Collection

Sequencers automatically collect `declaredResources` from all child blocks added through the DSL chain (`.then()`, `.parallel()`, `.rescue()`, etc.). Nested sequencers bubble their collected resources upward:

```ts
const pipeline = sequencer({ name: "pipeline" })
  .then(planManager)      // declares session.plan
  .then(analyticsBlock)   // declares user.analytics
  .rescue([{ block: recoveryBlock }]);  // declares session.errorLog

// pipeline.declaredResources contains all three resources
```

#### Flow-Level Resource Merge

`defineFlow` collects `declaredResources` from all action blocks and merges them into the flow's scope configs automatically. Flow-level resource declarations take priority over block-declared resources:

```ts
const myFlow = defineFlow({
  kind: "my-app",
  actions: { chat: { block: pipeline } },
  session: {
    // Flow-level plan overrides block-declared plan (same key)
    resources: { plan: customPlanResource },
  },
});
// Block-declared analyticsBlock.userResources and errorLog are still merged in
```

#### Conflict Detection

When two blocks declare different `defineResource()` references for the same resource name in the same scope, the framework throws a build-time error:

```ts
const blockA = handler({ sessionResources: { plan: planResourceV1 } });
const blockB = handler({ sessionResources: { plan: planResourceV2 } });

// Error: Resource conflict: "plan" in session scope is declared
// with different defineResource() references.
sequencer({ name: "pipeline" }).then(blockA).then(blockB);
```

If both blocks reference the **same** `defineResource()` instance, there is no conflict — the merge succeeds silently.

## Client Data

Client data entries are derived views — computed from state and resources within a single scope. They're the mechanism for exposing server-side data to clients.

```ts
session: {
  clientData: {
    activePlan: (ctx) => ctx.resources.plan?.state.steps ?? [],
    messageCount: (ctx) => ctx.state.messageCount ?? 0,
  },
}
```

Every `clientData` entry is a function, and every entry is client-visible. There's no `client: true/false` toggle — if it's in `clientData`, clients can see it.

### ClientDataComputeFn

```ts
type ClientDataComputeFn<TState, TResources> =
  (ctx: ClientDataContext<TState, TResources>) => JsonValue | Promise<JsonValue>;

type ClientDataContext<TState, TResources> = {
  state: Readonly<TState>;
  resources: TResources;
};
```

**Key differences from the former projection system:**
- **Single-scope context**: Each compute function receives only the state and resources from its own scope — no cross-scope access. A session-level `clientData` entry sees session state and session resources, nothing else.
- **No output schema validation**: Compute functions return `JsonValue` directly. Type safety comes from usage patterns, not runtime schema validation.
- **No `defineProjection()`**: There's no portable projection builder. For shared computation logic, extract a regular function.

### All Three Scopes

```ts
defineFlow({
  kind: "my-app",
  session: {
    clientData: {
      artifactsList: (ctx) => {
        const artifacts = ctx.resources.artifacts?.state;
        return artifacts?.order.map(id => ({
          id,
          title: artifacts.byId[id]?.title ?? "Untitled",
        })) ?? [];
      },
      modeStatus: (ctx) => ({
        currentMode: ctx.state.mode ?? "chat",
        requestCount: ctx.state.requestCount ?? 0,
      }),
    },
  },
  user: {
    clientData: {
      preferences: (ctx) => ({
        displayName: ctx.state.displayName ?? "User",
        preferredModel: ctx.state.preferredModel ?? "gpt-5-mini",
      }),
    },
  },
  project: {
    clientData: {
      sharedConfig: (ctx) => ctx.state.config ?? {},
    },
  },
});
```

## Context Functions

Generators use `contextFn()` to pull typed data from scopes into model context — replacing the old projection reference helpers:

```ts
import { contextFn } from "@flow-state-dev/core";

const myContext = contextFn({
  sessionStateSchema: z.object({ mode: z.string() }),
  sessionResources: { plan: planResource },
  fn: (ctx) => {
    const steps = ctx.session.resources.plan?.state.steps ?? [];
    return `Current mode: ${ctx.session.state.mode}\nPlan steps: ${steps.join(", ")}`;
  },
});

const chatGenerator = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  context: [myContext],
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
});
```

### Prompt Formatters

The `@flow-state-dev/core/prompt` subpath provides utilities for formatting context data into LLM-friendly strings:

| Formatter | Purpose |
|-----------|---------|
| `section(title, content)` | Wrap content in a labeled section |
| `list(items)` | Bullet list |
| `keyValues(obj)` | Key-value pairs |
| `entries(items, fn)` | Map items through a formatter |
| `codeBlock(code, lang?)` | Fenced code block |
| `join(...parts)` | Concatenate with double newlines, filtering empties |
| `when(condition, content)` | Conditional inclusion |

## Type Helpers

The framework exports type utilities for working with resources and scopes:

```ts
import { StateOf, ContextOf, ResourceContext } from "@flow-state-dev/core";

// Extract state type from a schema or resource definition
type PlanState = StateOf<typeof planResource>;

// Get the context handle type for a scope/resource
type SessionCtx = ContextOf<typeof sessionStateSchema, "session">;
type PlanCtx = ContextOf<typeof planResource, "resource">;
```

`StateOf` and `ContextOf` work with both resource definitions and raw Zod schemas, so shared helper functions can use one consistent typing pattern.

## Client Visibility

**Important:** Raw state never reaches the client. Client-facing values are exposed **only** through `clientData` entries.

The client reads client data via the state snapshot endpoint:

```
GET /api/flows/sessions/:sessionId/state
```

Returns client data grouped by scope:

```json
{
  "clientData": {
    "session": { "activePlan": [...], "messageCount": 5 },
    "user": { "preferences": { "displayName": "User", "preferredModel": "gpt-5-mini" } },
    "project": {}
  }
}
```

Mid-request, `state_change` and `resource_change` stream items signal invalidation — clients should refetch the snapshot on `request.completed`.

## Canonical Authority

For full type signatures and edge cases, see `../preperation/architecture/FLOW_SYSTEM.md` and `../preperation/architecture/STATE_AND_SCOPES.md`.
