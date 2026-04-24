---
sidebar_position: 11
---

# Flow Isolation and Cross-Flow State

User- and project-scope state is shared across flows by default. A single `UserRecord` per `userId` backs every flow registered on the same server. That's the right default when two flows genuinely represent different views of the same identity (preferences, profile, entitlements). It's a data-loss bug when two flows declare incompatible schemas over the same key.

The framework gives you two mechanisms, both active in Wave 1: a schema registry that catches incompatible declarations at startup, and an isolation escape hatch that opts a flow out of sharing entirely.

## Why user/project state is shared by default

Sessions and requests are flow-isolated already — each record carries `flowKind`. A chat flow's session is never confused with an agent flow's session.

User and project state are different. They represent long-lived identity, not conversation. A user's display name, preferred model, or project title is typically something multiple flows want to read and write. Sharing is the feature, not a bug.

The risk is silent data loss. Without a guardrail, Flow A writes `{ theme: "dark" }`, then Flow B writes `{ locale: "en" }` into the same record and `theme` disappears. No warning, no error.

## The cross-flow schema registry

When you register a flow, `FlowRegistry.register` collects the flow's `user.stateSchema`, `project.stateSchema`, and user/project resource schemas. Every new flow's declarations are compared against every previously registered flow's declarations:

- **Same schema reference** → merge, no warning.
- **Compatible object shapes** (overlapping keys with matching types; disjoint fields) → merge, with a `console.warn` flagging the drift.
- **Incompatible shapes** (a shared required field's types disagree, or both flows declare non-object roots that differ) → throw `CrossFlowSchemaConflictError`.

The error looks like this:

```
CrossFlowSchemaConflictError: Flows "profile" and "agent" declare incompatible
 user.stateSchema schemas.
  reason: incompatible-shape — field "theme": types differ: ZodString vs ZodNumber.
  Set isolateUserState: true on one of the flows to opt out of cross-flow sharing,
 or reconcile the schemas so they are structurally compatible.
```

The check is conservative. Wave 1 accepts false positives — being told to reconcile is annoying, but silent data loss is worse.

## Opting a flow out with isolation

Some flows genuinely don't share user or project state with anyone else. Internal admin flows, background jobs, domain-specific experiments. Declare them isolated:

```ts
defineFlow({
  kind: "internal-maintenance",
  isolateUserState: true,      // namespaces user storage by flowKind
  isolateProjectState: true,   // independent flag for project scope
  user: {
    stateSchema: z.object({ lastRunAt: z.number() }),
  },
  actions: { /* ... */ },
});
```

When `isolateUserState` is `true`:

- The flow's user-scope storage key becomes `${userId}:${flowKind}`.
- The flow does not participate in registry checks for the user scope. Another flow declaring `z.object({ something: z.boolean() })` on user state doesn't conflict with it.
- `ctx.user.state` in this flow only ever contains what this flow wrote — no other flow can pollute it.

`isolateProjectState` behaves identically for the project scope.

## What stays the same

- `UserRecord.userId` and `ProjectRecord.projectId` remain the bare identity. Admin views that list records by `userId` see both shared and isolated records for a user.
- Session and request scopes are unaffected. They are already flow-isolated via `flowKind` tagging.
- Resources on isolated scopes follow the same isolation — resource content for an isolated user scope lives under `user:${userId}:${flowKind}/<resource>`.

## When to pick which

Default is shared. Keep it that way when a field is something you'd expect to see for the user across all your flows (theme, locale, onboarding state, preferred model).

Reach for isolation when:

- The user-scope data is internal to one flow's implementation (scratchpad for a background job, per-flow experiment tracking).
- The data is sensitive or semantically wrong to expose to other flows.
- You want hard guarantees no other flow can read or overwrite it.

If you find yourself declaring the same field in two flows with the same schema: that's the shared case working correctly — leave it.

If you find yourself fighting the registry because two flows' schemas keep drifting: either extract the shared fields into a common schema both flows import, or isolate the less-shared flow.

## Flipping the flag is not a migration

Changing `isolateUserState: false` to `true` on an existing flow does not move data. The flow starts reading from a fresh `${userId}:${flowKind}` record; any data previously written to the shared record is still there but invisible to this flow.

If you need to migrate, write a one-off script that reads the shared record and copies the relevant subset into the isolated namespace before switching the flag.

## Resolving a `CrossFlowSchemaConflictError`

1. Look at the `flowA`, `flowB`, `scope`, and `field` on the error. The error message points at the exact declaration pair.
2. Decide whether the two flows should actually share this state.
3. If yes — reconcile. Usually that means importing one schema into the other, or extracting a common Zod schema shared by both flows.
4. If no — set `isolateUserState` (or `isolateProjectState`) to `true` on the flow that has the narrower, more internal use case.

## See also

- [State & Scopes](/docs/fundamentals/state-and-scopes) — the broader state model.
- [Server setup](/docs/server/setup) — how `FlowRegistry` is wired into the server boot path.
