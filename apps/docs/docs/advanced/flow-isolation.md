---
sidebar_position: 11
---

# Sharing State Across Flows

Most apps end up with more than one flow on the same server. A chat flow, an admin flow, a background job. They share users and orgs but do different things.

By default, all your flows share the same user and org records. If a chat flow writes the user's preferred theme, an admin flow reading that same user sees it. That's usually what you want — preferences, profile, org title — these belong to the user or org, not to a single flow.

This page covers how that sharing works, the guardrail that catches conflicts, and the one-line opt-out for flows that need their own private state.

## The default: shared user and org state

Every flow you register on a server reads from and writes to the same `UserRecord` for a given `userId`. Same for org. Sessions and requests are different — those carry the flow's identity and stay separate per flow.

So if two flows declare a `user.stateSchema`, they're declaring it over the *same* underlying record. That's powerful when the schemas agree, and it would be a silent data-loss bug if they didn't.

## The guardrail: schema conflicts caught at startup

When you register your flows with the server, the framework checks that every flow's user and org schemas are compatible with each other. If two flows declare the same field with different types, registration fails immediately:

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

With `isolateUserState: true`, this flow's user state is stored separately. No other flow can see it, no other flow can clash with its schema. `isolateOrgState` does the same for org scope. The flags are independent — you can isolate one and share the other.

## Private state follows the copy, not the definition

A flow definition can run as several named copies on one server — a `collection` flow, where each copy is registered under its own id. Two copies of a `review` definition, `review-east` and `review-west`, share the definition and nothing else.

Private state follows the copy. Each copy's isolated user and org state lives in its own place, so what `review-east` writes is not what `review-west` reads:

```ts
const reviewer = defineFlow({
  kind: "reviewer",
  cardinality: "collection",
  isolateUserState: true,
  isolateOrgState: true,
  user: { stateSchema: z.object({ lastSeenAt: z.number().optional() }) },
  actions: { run: { block: reviewBlock } },
});

const east = reviewer({ id: "reviewer-east" });
const west = reviewer({ id: "reviewer-west" });
```

For one user, `east` and `west` keep separate `lastSeenAt` values. A flow with the default `cardinality: "singleton"` has exactly one copy, whose id is its kind, so its isolated state has one home.

Two words that look alike and mean different things: a flow's `cardinality: "collection"` is about how many copies of the flow run, and a [resource collection](/docs/resources/collections) is about how many instances of one resource a scope holds. They are unrelated settings.

A resource that opts out stays shared across the copies too:

```ts
const shared = defineResource({
  scope: "user",
  flowIsolation: false,
  stateSchema: z.object({ theme: z.string().default("light") }),
});
```

`east` and `west` both read and write that one record, exactly as two separate definitions would.

### Ids are a storage commitment

Because private data is filed under the copy's id, renaming a copy points it somewhere new. Its old private state is still on disk, but the renamed copy no longer reads it. Treat the ids you give a collection's copies the way you'd treat a database name: pick them once, keep them.

### What isolation is not

Isolation keeps flows out of each other's storage. It does not decide who is allowed to call your flow — that is authentication and authorization, and it still applies in full. See [Authentication](/docs/server/authentication) for the trust model.

### Upgrading a deployment that already has copies

A server that has been running a collection flow with isolation on has data filed under the kind rather than under a copy. The framework will not guess which copy owns it: reads of unattributed records stop with `migration-required` until an operator attributes them. That attribution is one offline procedure, covered under [Who owns a record](/docs/persistence/overview#who-owns-a-record).

## Picking shared vs isolated

The default is shared, and most flows should stay that way. If two flows touch the same field and want it to mean the same thing, leave them shared.

Reach for isolation when:

- The state is internal to one flow's implementation and other flows shouldn't see it.
- The state is sensitive and you want a hard guarantee no other flow can read or overwrite it.
- The schemas genuinely disagree and reconciling them would be artificial.

If you find yourself fighting the schema check because two flows keep drifting apart, the answer is usually to extract the shared fields into a Zod schema both flows import — not to isolate.

## A note on switching the flag later

Flipping `isolateUserState` from `false` to `true` on an existing flow doesn't move data. The flow starts reading from a fresh isolated record, and whatever was in the shared record is still there for other flows but invisible to this one. If you need to migrate, copy the data first, then flip the flag. Renaming a copy of a collection flow has the same effect for the same reason.

## See also

- [State & Scopes](/docs/fundamentals/state-and-scopes) for the broader state model.
- [State vs resources](/docs/resources/storage) for where a resource's data lives and how `flowIsolation` picks it.
- [Persistence](/docs/persistence/overview#who-owns-a-record) for attributing an existing deployment's records to the copy that owns them.
- [Engine setup](/docs/server/setup) for how flows get registered.
