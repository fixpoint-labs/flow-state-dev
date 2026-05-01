---
sidebar_position: 11
---

# Sharing State Across Flows

Most apps end up with more than one flow on the same server. A chat flow, an admin flow, a background job. They share users and projects but do different things.

By default, all your flows share the same user and project records. If a chat flow writes the user's preferred theme, an admin flow reading that same user sees it. That's usually what you want — preferences, profile, project title — these belong to the user or project, not to a single flow.

This page covers how that sharing works, the guardrail that catches conflicts, and the one-line opt-out for flows that need their own private state.

## The default: shared user and project state

Every flow you register on a server reads from and writes to the same `UserRecord` for a given `userId`. Same for project. Sessions and requests are different — those carry the flow's identity and stay separate per flow.

So if two flows declare a `user.stateSchema`, they're declaring it over the *same* underlying record. That's powerful when the schemas agree, and it would be a silent data-loss bug if they didn't.

## The guardrail: schema conflicts caught at startup

When you register your flows with the server, the framework checks that every flow's user and project schemas are compatible with each other. If two flows declare the same field with different types, registration fails immediately:

```
Flows "chat" and "admin" declare incompatible user.stateSchema schemas
(incompatible-shape: field "theme": ZodString vs ZodNumber).
Set isolateUserState: true on one of the flows to opt out of cross-flow
sharing, or reconcile the schemas.
```

You see this once at startup and fix it. You never see it in production with users losing data.

The check is structural and conservative: identical schemas merge cleanly, schemas that one flow extends with extra optional fields merge with a console warning, and anything that would actually overwrite data throws.

## Opting a flow out

Some flows really do want their own private state. A maintenance job that tracks `lastRunAt`, an experimental flow with a schema that shouldn't leak into your main app, an admin tool with sensitive per-user audit data.

Set one flag:

```ts
defineFlow({
  kind: "maintenance",
  isolateUserState: true,
  user: {
    stateSchema: z.object({ lastRunAt: z.number() }),
  },
  actions: { /* ... */ },
});
```

With `isolateUserState: true`, this flow's user state is stored separately. No other flow can see it, no other flow can clash with its schema. `isolateProjectState` does the same for project scope. The flags are independent — you can isolate one and share the other.

## Picking shared vs isolated

The default is shared, and most flows should stay that way. If two flows touch the same field and want it to mean the same thing, leave them shared.

Reach for isolation when:

- The state is internal to one flow's implementation and other flows shouldn't see it.
- The state is sensitive and you want a hard guarantee no other flow can read or overwrite it.
- The schemas genuinely disagree and reconciling them would be artificial.

If you find yourself fighting the schema check because two flows keep drifting apart, the answer is usually to extract the shared fields into a Zod schema both flows import — not to isolate.

## A note on switching the flag later

Flipping `isolateUserState` from `false` to `true` on an existing flow doesn't move data. The flow starts reading from a fresh isolated record, and whatever was in the shared record is still there for other flows but invisible to this one. If you need to migrate, copy the data first, then flip the flag.

## See also

- [State & Scopes](/docs/fundamentals/state-and-scopes) for the broader state model.
- [Server setup](/docs/server/setup) for how flows get registered.
