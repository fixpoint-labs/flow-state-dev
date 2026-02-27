# Resources and Projections

Resources are **concrete persisted data** attached to a scope. Projections are **derived views** computed from state and resources. Together, they provide structured, typed data management within flows.

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
  dynamic?: boolean;            // Resolved at runtime
  writable?: boolean;           // Allow mutation from blocks
  allowedExtensions?: string[]; // Content type restrictions
  metadata?: Record<string, unknown>;
};
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

## Projections

Projections are derived views — computed from state, resources, and other scope data. They're the **only way** to expose values to the client.

```ts
session: {
  projections: {
    activePlan: {
      client: true,  // Makes this visible to the client
      compute: (ctx) => ctx.session.resources.plan?.state.steps ?? [],
    },
  },
}
```

### Projection Config

```ts
type ProjectionConfig = {
  client: boolean;             // Whether client can see this
  outputSchema?: ZodTypeAny;   // Optional output type (defaults to z.any())
  compute: (ctx: ProjectionContext) => ProjectionValue | Promise<ProjectionValue>;
  // Optional scope schemas for portable projections:
  sessionStateSchema?: ZodType;
  userStateSchema?: ZodType;
  projectStateSchema?: ZodType;
  // Optional for portable projections created with defineProjection()
  // (inline projections infer resource types from the flow automatically)
  sessionResourceSchemas?: ZodType | Record<string, ZodType | DefinedResource>;
  userResourceSchemas?: ZodType | Record<string, ZodType | DefinedResource>;
  projectResourceSchemas?: ZodType | Record<string, ZodType | DefinedResource>;
};
```

### Shorthand

For simple cases, projections can be just a compute function:

```ts
session: {
  projections: {
    // Shorthand: just the compute function (client: true must be in the full form)
    messageCount: (ctx) => ctx.session.state.messageCount ?? 0,
  },
}
```

### Projection Context

The `compute` callback receives a `ProjectionContext` with scope handles:

```ts
type ProjectionContext = {
  request: RequestScopeHandle;
  session: SessionScopeHandle & { resources: ... };
  user: (UserScopeHandle & { resources: ... }) | null;
  project: (ProjectScopeHandle & { resources: ... }) | null;
};
```

**Rules:**
- Projection `compute` is read-oriented — avoid scope mutations inside it
- Inline projections inherit parent scope schemas automatically
- Inline projections also inherit resource state types from their scope resource configs (for example `ctx.session.resources.plan.state` is strongly typed)
- Use `defineProjection()` for portable projections that need explicit schema declarations

### Portable Projection Definitions

```ts
import { defineProjection } from "@flow-state-dev/core";

export const topicsProjection = defineProjection({
  client: true,
  outputSchema: z.array(z.string()),
  userStateSchema: z.object({
    subscribedTopics: z.array(z.string()).default([]),
  }),
  compute: (ctx) => ctx.user?.state.subscribedTopics ?? [],
});
```

## Generator Context References

Generators should use projection references for model context, not raw state dumps:

```ts
import { projection, projectionText, projectionData, projectionMessages } from "@flow-state-dev/core";

const chatGenerator = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  context: [
    projectionText("session.activePlan"),     // Include as text context
    projectionData("user.preferences"),        // Include as structured data
  ],
  history: [
    projectionMessages("session.conversationHistory"),  // Include as messages
  ],
  user: (input) => input.message,
});
```

### Slot Reference Helpers

| Helper | Returns | Use For |
|--------|---------|---------|
| `projection(uri)` | Raw projection value | General projection access |
| `projectionText(uri)` | String text | Text context for LLM |
| `projectionData(uri)` | Structured data | JSON data context |
| `projectionMessages(uri)` | Message array | Conversation history |
| `resource(uri)` | Resource value | Concrete resource access |

Options for all helpers:

```ts
{
  optional?: boolean;      // Don't fail if missing
  missing?: "error" | "empty";  // Behavior when missing
  limit?: number | { tokens: number };  // Truncation
  as?: string;            // Alias in context
}
```

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

**Important:** Client-facing values are exposed **only** through projections with `client: true`.

The client reads projections via the state snapshot endpoint:

```
GET /api/flows/sessions/:sessionId/state
```

Returns projections grouped by scope:

```json
{
  "projections": {
    "session": { "activePlan": [...], "messageCount": 5 },
    "user": { "topics": ["ai", "workflows"] },
    "project": {}
  }
}
```

Mid-request, `state_change` and `resource_change` stream items signal invalidation — clients should refetch the snapshot on `request.completed`.

## Canonical Authority

For full type signatures and edge cases, see `../preperation/architecture/FLOW_SYSTEM.md` and `../preperation/architecture/STATE_AND_SCOPES.md`.
