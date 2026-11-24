---
title: Resources and collections
type: reference
description: "Every option, method, route and refusal for resources and collections: definition fields, identity and storage, operations, search, edges, reactions, and what the model and the browser can reach."
---

# Resources and collections

A resource is named, stored data: a body of content and typed fields of its own, kept for one session, one user or one org. A collection is a set of resources created while the app runs. They exist for data that has a name and a body, like a refund policy every reply should follow or the notes piling up on a support ticket, which do not fit the flat fields of session state.

Each resource is a record of its own in the store, found by scope and path, so two resources never share a field namespace. A block declares the resources it needs and carries that declaration into every flow it joins. The browser reaches a resource only through its `client` config, and the model's content tools only through `llmReadable` and `llmWritable`. This page lists the options, methods, routes and refusals. The [Resources concept page](../concepts/resources.md) explains the model.

The examples use a support desk: `refundPolicy` is an org-wide document and `ticketNotes` is a collection of notes on one ticket.

## Quick answers

| Question | Answer |
|---|---|
| What is a resource's full storage key? | Its `path` within its scope. A single resource's path is its `ref`, or the name it is first declared under when it sets none. A collection entry's path is the pattern with the key filled in, such as `ticketNotes/n-1`. The `uri` puts the scope in front: `session/ticketNotes/n-1`. See [Identity](#identity-path-scope-and-uri). |
| Which resources load for a request? | The resources the flow declares itself, and the resources declared by the blocks of the action that runs. An undeclared resource is never loaded, so no block can read it. See [When a resource loads](#when-a-resource-loads). |
| What can the browser read without `expose`? | A resource with no `client` config: nothing. A single resource with a `client` config and no projection: its content when `client.content.read` is set, and none of its state. A collection with `client.state.read: true` and no projection: each entry's full state, minus `secret` fields. See [Browser access](#browser-access). |
| Can the model read or write a resource by default? | The content tools cannot: `llmReadable` and `llmWritable` default to off. `resourceTools()` create, update and delete are not gated by `llmWritable`. See [Model access](#model-access). |

## Defining a resource

`defineResource(config)` returns the definition. A block lists it in its `resources` map, and the flow collects it from there.

```ts title="src/flows/support/resources/refund-policy.ts"
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const refundPolicy = defineResource({
  scope: "org",
  ref: "refundPolicy",
  stateSchema: z.object({ version: z.string().default("v1") }),
  content: "Refunds are issued within 30 days of purchase. After that, offer store credit.",
  llmReadable: true,
  client: { content: { read: true }, expose: ["version"] },
});
```

The block that drafts replies declares it and reads the body:

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { refundPolicy } from "../resources/refund-policy";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Follow the refund policy you are given.",
  inputSchema: z.string(),
  resources: { refundPolicy },
  user: async (input, ctx) => {
    const policy = await ctx.resources.refundPolicy.readContent();
    return `Refund policy:\n${policy ?? ""}\n\nCustomer message:\n${input}`;
  },
});
```

### `defineResource` fields

| Field | Type | Meaning |
|---|---|---|
| `scope` | `"session"`, `"user"` or `"org"` | Required. Whose resource it is. See [Scopes](#scopes-and-sharing). |
| `stateSchema` | Zod object schema | Required. The typed fields. Must be a `z.object` when `edges` is set. |
| `ref` | string | The name the resource is stored under. Default: the name it is first declared under. Set it on user and org resources so moving a declaration does not move the stored data. |
| `default` | JSON object | The starting state. Without one, the schema's own defaults apply, then `{}`. |
| `content` | string | The starting body. |
| `contentFile` | string or `{ path, importerUrl }` | Load the starting body from a file. A bare string resolves from the working directory. With `importerUrl: import.meta.url`, a relative `path` resolves from the declaring module first. |
| `contentTemplate` | `ResourceTemplate`, path or `{ path, importerUrl }` | A Markdown template rendered against the resource's state. |
| `contentTemplateRef` | string | The path of another resource whose raw content is the template. Read at read time, so editing either resource changes the output. |
| `render` | `(content, state) => string` | Fill the body from state in your own code. Not with `contentTemplate` or `contentTemplateRef`. |
| `writable` | boolean | Default `true`. `false` makes every state and content write from a block throw `resource_read_only`. Reads work. |
| `llmReadable` | boolean | Default `false`. Opens `readResourceContentTool()`, `globResources`, `grepResourceContent` and `searchResources` to the resource. On a collection it also opens `resourceTools().readResource`. See [Model access](#model-access). |
| `llmWritable` | boolean | Default `false`. Opens `writeResourceContentTool()` only. It does not need `llmReadable`. |
| `secret` | state field names | Fields that never leave the server. See [Secret fields](#secret-fields). |
| `flowIsolation` | boolean | User and org scope only. Default `false`. See [Scopes](#scopes-and-sharing). |
| `sharedToLineage` | boolean | Session scope only. Default `false`. See [Scopes](#scopes-and-sharing). |
| `prefetchMode` | `"eager"` or `"lazy"` | Default `"eager"`. See [When a resource loads](#when-a-resource-loads). |
| `client` | object | What the browser can reach. Omit it and the resource is invisible to clients. See [Browser access](#browser-access). |
| `reactTo` | object | Run a block when the resource changes. `stateUpdated` and `contentUpdated` only. See [Reactions](#reactions). |
| `edges` | `true` or `{ vocabulary?, maxEdges? }` | Add a typed-link graph to the state. See [Edges](#edges). |
| `runBy`, `canWrite` | `"default"` or `{ flow }`, and a function | Let a client write a user or org resource. See [Client writes](#client-writes). |

At most one of `content`, `contentFile`, `contentTemplate` and `contentTemplateRef` may be set.

### What `defineResource` refuses

| Declaration | The error |
|---|---|
| `scope` missing or not one of the three | `defineResource() requires an explicit scope of "session", "user", or "org" (got …)` |
| More than one content source | `defineResource() accepts at most one content source, got: …` |
| `render` with `contentTemplate` or `contentTemplateRef` | `defineResource() rejects render with contentTemplate/contentTemplateRef …` |
| `flowIsolation: true` at session scope | `defineResource() rejects flowIsolation:true on session-scoped resources …` |
| `sharedToLineage: true` at user or org scope | `defineResource() rejects sharedToLineage:true on <scope>-scoped resources …` |
| `reactTo.created` or `reactTo.deleted` | `defineResource() does not support reactTo.<kind> …` |
| More than one of `client.expose`, `client.exclude`, `client.data` | `… client config may set at most one of expose, exclude, or data. Got: …` |
| A name in `expose`, `exclude` or `secret` that is not on `stateSchema` | `… names key(s) not on stateSchema: …. Valid keys: …` |
| A `secret` field also listed in `client.expose` | `… client.expose names secret key(s): …` |
| `client.live: true` with no projection | `… client.live requires the resource's clientData to be projected …` |
| `edges` with a `stateSchema` that is not a `z.object` | `defineResource() with edges requires an object stateSchema …` |
| `runBy` or `canWrite` set against the rules in [Client writes](#client-writes) | The error names the resource and the fix. |

## The resource handle

A block that declares a resource reads it as `ctx.resources.<name>`, where `<name>` is the key in the block's `resources` map. Reading a name the block did not declare is a type error. `ctx.resources.get(name)` returns the handle for a declared name, and `ctx.resources.list()` returns the handle of every declared resource, in an array.

| Name | Takes | Returns |
|---|---|---|
| `path`, `scope`, `uri` | | Strings, fixed when the handle is made. See [Identity](#identity-path-scope-and-uri). |
| `state` | | The current state. A synchronous getter, not a promise. |
| `patchState(updates)` | A partial state | `Promise<void>`. Merges the fields. |
| `setState(next)` | A whole state | `Promise<void>`. Replaces the state. |
| `updateState(updater)` | `(state) => state` | `Promise<void>`. Reads, applies, writes. |
| `incState(increments)` | `{ field: delta }` over number fields | `Promise<void>`. Adds each delta to what is stored. |
| `pushState(field, value)` | An array field and one element | `Promise<void>`. Appends. |
| `getOrPatchState(key, compute)` | A field name and a function | `Promise<value>`. Returns `state[key]` unless it is `undefined`: a field holding `null` counts as set. Otherwise runs `compute`, stores the result under `key`, and returns it. A `compute` that returns `undefined` stores nothing. |
| `readContent()` | | `Promise<string \| null>`. The body, rendered when the resource has a template or `render`. |
| `readContentRaw()` | | `Promise<string \| null>`. The stored body. |
| `writeContent(text)` | A string | `Promise<void>`. Replaces the body. |
| `edges` | | The [edge API](#edges), present when the resource declared `edges`. |

No state writer returns the new state. Read it back from `state`.

### State write rules

| Case | Result |
|---|---|
| A write whose result fails `stateSchema`, or is not an object | Nothing is stored. The write throws. |
| `incState` on a field holding something other than a number, or `pushState` on a field holding something other than an array | Throws a `FlowError` with code `resource_delta_refused` and `retryable: false`. The stored value is unchanged. |
| `incState` or `pushState` on an absent or `null` field | Starts from `0` or `[]`. |
| `incState` with several fields, one of them wrong | None of the call applies. |
| `incState` whose result is not finite | Refused, even from two finite numbers that overflow. |
| Any state or content write on a `writable: false` resource | Throws `resource_read_only`. |
| Two requests calling `incState`, `pushState` or `updateState` on one field | Both land: a write that loses the race re-runs against the winner's stored value. The filesystem store guards a key within one process only, so two processes over one directory can lose one. |
| Two requests patching different fields of one resource | Both changes are kept. |
| Two requests writing the same field | The last write wins. |
| A request reading a value, computing a new one and patching it back | A change made in between can be overwritten. Use `incState`, `pushState` or `updateState` for counters and lists. |

A request reads each resource as it was when the request first touched it. `readCommitted(ref, project)` from `@flow-state-dev/core/helpers` reads the stored value as it is at that moment and returns `project(state)`. It needs a ref the block may write, so a `writable: false` resource throws `resource_read_only`. It writes nothing.

### What gets stored

State is saved as JSON, and every store saves the same thing for the same write, the in-memory store included.

| Value in state | Stored as |
|---|---|
| `Date` | Its ISO string |
| `Map`, `Set` | `{}` |
| `Infinity`, `NaN` | `null` |
| `undefined` field, function | Dropped |
| `bigint`, or an object that refers to itself | The write fails with a `TypeError` and nothing is stored |

Within the request that made a write, `state` can hold the value as written. The stored form shows on the next read from the store.

A single resource's state is checked against `stateSchema` on every read. If any field fails, the whole state reads back as the resource's default, with no error. A `z.date()` field fails this way. Declare a date as `z.coerce.date()` on a single resource, or as a string on a collection entry, which is not parsed on read. Store a set as an array.

Content is not versioned: a later write replaces an earlier one.

State and content are stored separately, and a resource can have content with no state. Copying a store copies each: a deleted resource reads as never written afterwards, and a copied resource restarts at version 1.

## Scopes and sharing

| Scope | Whose | Stored in |
|---|---|---|
| `session` | One session | Stored for that session alone. A background session dispatched from a conversation has its own, empty one unless `sharedToLineage` is set. |
| `user` | One user, within one organization | Stored once per user and organization. The same user in another organization starts empty. |
| `org` | One organization | Stored once per organization. |

At user and org scope, a resource is shared by every flow the same user or org reaches, unless it is isolated.

| Setting | Effect |
|---|---|
| `flowIsolation: false` (default) | Every flow on the server sees the same resource. |
| `flowIsolation: true` | Only the flow instance that wrote it sees it. Two registered copies of one flow definition each get their own. |
| Flow-wide `isolateUserState` or `isolateOrgState` | The default for that flow's resources of that scope. A resource's own `flowIsolation` wins in either direction. |
| `sharedToLineage: true` (session scope) | One resource for a conversation and every background session dispatched under it, nested to any depth. Session state is not shared. Writes are not queued or ordered. |

Registering two flow kinds that declare the same shared `ref` with conflicting settings is refused.

## Identity: path, scope and uri

Every handle, for a single resource or a collection entry, carries three fixed strings.

| Field | Value | Example |
|---|---|---|
| `path` | The within-scope storage key | `refundPolicy`, `ticketNotes/n-1` |
| `scope` | `"session"`, `"user"` or `"org"` | `session` |
| `uri` | `${scope}/${path}` | `session/ticketNotes/n-1` |

Resource state and content are stored under the id of their scope: the session's id for `session`, the lineage's id for `sharedToLineage` resources, and the user and org scope ids for `user` and `org`: the record's id, plus the flow's id when the resource is flow-isolated. A copy that visits a scope id finds the resources under it and no others.

`uri` is an identifier string, not an RFC 3986 URI: do not pass it to `new URL()`. A collection key is normalized when it is resolved: backslashes become `/`, leading and trailing slashes are dropped, repeated slashes collapse, and `..`, null bytes and control characters are refused. A single resource's `path` is its `ref` unchanged. A `ref` on a collection is never read, because a collection is identified by its `pattern`.

Two names that point at one definition object share one stored slot. Two different definition objects declared under one name throw `Resource conflict: "<name>" is declared with different defineResource() references. Use the same reference across blocks, or pick distinct accessor keys.` A flow-level declaration of a name that a block also declares must be the same definition object, or `defineFlow` throws `Resource conflict in flow "…"`.

## Defining a collection

`defineResourceCollection(config)` takes the fields below. A block lists it in `resources` under any name. That name, not the pattern, is how the block reaches it.

```ts title="src/flows/support/resources/ticket-notes.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketNotes = defineResourceCollection({
  pattern: "ticketNotes/**",
  scope: "session",
  stateSchema: z.object({ author: z.string(), pinned: z.boolean().default(false) }),
  maxInstances: 200,
  eviction: "lru",
  indexes: { byAuthor: (_key, state) => state.author },
  client: { state: { read: true }, content: { read: true }, expose: ["author", "pinned"] },
});
```

A block adds a note and finds the notes by the same author through the index:

```ts title="src/flows/support/blocks/add-note.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { ticketNotes } from "../resources/ticket-notes";

export const addNote = handler({
  name: "add-note",
  inputSchema: z.object({ noteId: z.string(), text: z.string() }),
  resources: { notes: ticketNotes },
  execute: async (input, ctx) => {
    const author = ctx.user.identity.userId ?? "unknown";
    const note = await ctx.resources.notes.create(input.noteId, { author });
    await note.writeContent(input.text);
    const byAuthor = await ctx.resources.notes.findBy("byAuthor", author);
    return { notesByAuthor: byAuthor.length };
  },
});
```

### `defineResourceCollection` fields

A collection takes the `defineResource` fields `scope`, `stateSchema`, `contentTemplate`, `contentTemplateRef`, `llmReadable`, `llmWritable`, `secret`, `writable`, `flowIsolation`, `sharedToLineage`, `prefetchMode`, `reactTo`, `edges`, `runBy` and `canWrite`, with these differences.

| Field | Type | Meaning |
|---|---|---|
| `pattern` | string | Required. Which keys the collection holds. See [Patterns](#patterns). |
| `maxInstances` | integer, at least 1 | A cap on live entries. Without it the collection is unbounded. |
| `eviction` | `"none"`, `"lru"` or `"oldest"` | What happens at the cap. Default `"none"`. |
| `prefetchWindow` | integer, 0 or more | How many entries the session snapshot carries inline. Default `0`. Entries are taken in storage-key order, not by recency. Over 100 logs a warning. |
| `indexes` | object | Fields entries can be found by. See [Indexes](#indexes). |
| `ownerPrivate`, `ownerWrites` | `{ param }` | One owner per row. See [Owner-keyed rows](#owner-keyed-rows). |
| `stampOrgId` | boolean | Default `false`. Writes the executing org's id into each new entry's `orgId`. The `stateSchema` must declare `orgId`. |
| `onInstanceCreated`, `onInstanceUpdated`, `onInstanceDeleted` | functions | Per-entry callbacks. See [Reactions](#reactions). |

A collection has no `content`, `contentFile`, `default` or `render`. `contentTemplate` and `contentTemplateRef` apply to each entry.

`writable: false` on a collection covers every entry. It refuses `patchState`, `setState`, `updateState`, `incState`, `pushState`, `writeContent`, `upsert` on an existing key, `create` with `{ replace: true }` on an existing key, and `delete` (even when the key is absent). `create` and `getOrCreate` of a missing key are not refused. A refusal is a `FlowError` with code `resource_read_only` and `retryable: false`, with the message `Resource "<storageKey>" is read-only` for state and `Resource "<storageKey>" content is read-only` for content.

### What `defineResourceCollection` refuses

| Declaration | The error names |
|---|---|
| A pattern that is empty or malformed, has none of `*`, `**` and `[param]`, or has `**` anywhere but last | The pattern |
| `scope` missing or not one of the three | `defineResourceCollection() requires an explicit scope …` |
| `flowIsolation: true` at session scope, `sharedToLineage: true` at user or org scope | The same refusals as `defineResource` |
| `maxInstances` under 1 | `maxInstances must be >= 1` |
| `eviction` other than `"none"` with no `maxInstances` | `eviction requires maxInstances` |
| `prefetchMode: "lazy"` with `eviction` other than `"none"` | `does not support prefetchMode: 'lazy' with eviction …` |
| `prefetchWindow` negative or not an integer | `prefetchWindow must be a non-negative integer` |
| `contentTemplate` with `contentTemplateRef` | `accepts at most one template source: contentTemplate or contentTemplateRef, not both` |
| Both `ownerPrivate` and `ownerWrites` | `declares both ownerPrivate and ownerWrites; choose one` |
| An owner param not declared exactly once as a whole segment, or a pattern using `**` with an owner param | The collection and the rule |
| `ownerPrivate` with `client.state.read`, `client.content.read` or `client.content.prefetch` | `must not enable a browser read` |
| `ownerWrites` with an eviction policy other than `"none"` | `must not evict` |
| An index name that is empty or contains `@`, or a version that is not a positive integer | The collection and the index |
| `stampOrgId` without `orgId` on the schema | The pattern |
| `reactTo` bound to a non-block, or `when` that is not a function | `reactTo.<kind> must be a block` |
| `edges` with a `stateSchema` that is not a `z.object` | `… with edges requires an object stateSchema` |
| `runBy` and `canWrite` against the rules in [Client writes](#client-writes) | The error names the collection and the fix |

### Patterns

| Pattern | Holds | Key you pass |
|---|---|---|
| `files/*` | One level: `files/readme.md`, not `files/src/a.ts` | A string |
| `files/**` | Any depth. `**` must be the last segment. | A string |
| `[topic]/notes` | One entry per `topic` value | An object: `{ topic: "react" }` gives the key `react/notes` |

`collection.create("readme.md")` on `files/**` stores `files/readme.md`: the pattern's prefix is added for you, and `ref.path` returns the full key. Strip the prefix for a bare key.

### Collection operations

On `ctx.resources.<name>`. Every method is async, whatever `prefetchMode` is.

| Method | If the key exists | If it is missing |
|---|---|---|
| `create(key, initial?)` | Throws | Creates, returns the entry handle |
| `create(key, initial, { replace: true })` | Replaces the state as `setState` does | Creates |
| `getOrCreate(key, initial?)` | Returns it, writes nothing | Creates |
| `upsert(key, update, createOnly?)` | Patches with `update` | Creates with `{ ...createOnly, ...update }` |
| `get(key)` | Returns the handle | Rejects |
| `getOptional(key)` | Returns the handle | `undefined` |
| `delete(key)` | Deletes | No-op, unless `writable: false` |

| Method | Returns |
|---|---|
| `list(prefix?)` | The entries as handles, optionally under a key prefix |
| `count()` | The number of entries |
| `findBy(index, value)` | The entries whose declared index has that value, in key order |

`create` and `upsert` refuse an initial or merged state that fails `stateSchema`, and create or patch nothing. `maxInstances` is checked only when a new entry is added. `create` and the create branch of `upsert` throw at the cap when `eviction` is `"none"`. `onInstanceUpdated` fires on the replace and patch branches and `onInstanceCreated` on the create branch.

Each entry handle has the fields and methods of the [resource handle](#the-resource-handle). Two parallel branches creating different keys both land. Two writing one key are last-write-wins.

| `eviction` | At the cap |
|---|---|
| `"none"` | `create` throws. `delete` first. |
| `"lru"` | The least recently accessed entry is removed. |
| `"oldest"` | The first created entry is removed. |

An eviction fires `onInstanceDeleted` and a `deleted` reaction with `evicted: true`.

### Collections the bash tool syncs

The bash tool writes each file it saves into a collection it mounts as one entry: `path`, `hash` (a SHA-256 of the body) and `updatedAt` (an ISO string) go into the entry's state, and the body goes in as content. Declare all three in the collection's `stateSchema`, with `updatedAt` as a string.

### Indexes

`indexes: { name: (key, state) => value }` declares a field entries can be found by. The function must answer from `key` and `state` alone.

| Rule | Detail |
|---|---|
| Value | A string, number or boolean, or an array of them. The entry is found by each. `null` and `undefined` mean no value. |
| Matching | Equality only, and types stay apart: the number `1` is not found by `"1"`. |
| Versions | A bare function is version 1. `{ version, value }` with a higher version rebuilds the index on the next lookup in each scope. |
| First lookup | Builds the index from the existing entries: one read of the whole collection in that scope. No backfill step. |
| Cost | SQLite and Postgres: one index query, then one read per hit. Memory and filesystem: the entries, filtered in memory. |
| Unknown name | `findBy` throws. |
| A function that throws | Fails the write it ran for. |
| Two collections in one scope whose patterns can match the same keys, declaring one index name at two versions | The server refuses to start. |

### Owner-keyed rows

`ownerSegment(userId)` turns a user id into one key segment that starts with `~`. Put it at the pattern parameter named in `ownerPrivate` or `ownerWrites`.

| | `ownerPrivate: { param }` | `ownerWrites: { param }` |
|---|---|---|
| Who reads a row | Only the user its owner segment names | Everyone the scope serves, from the server or the browser |
| Who writes a row | Only that user | Only that user |
| To anyone else | Absent: lists and counts omit it, `getOptional` returns nothing, `get` or a write throws `A resource in an owner-private collection is readable only by the user it belongs to.` | A write throws `A resource in an owner-writes collection is written only by the user it belongs to.` and changes nothing |
| Browser read | Refused when the collection is defined | Allowed |
| Eviction | No extra rule | Must be `"none"` |

A key segment starting with `~` is reserved for these collections in every app. No other collection reaches such rows: a wider collection such as `[tenant]/**` lists without them, and a write to one through it is refused. If a flow declares a collection in the same scope whose pattern could reach an owner-keyed collection's keys, the app refuses to start.

## Projected collections

`defineProjectedResourceCollection` is a read-only view of data the app owns. The framework stores no copy: each read calls your `read` or `search` hook.

```ts title="src/flows/support/resources/orders.ts"
import { defineProjectedResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { findOrder, searchOrders } from "../../../lib/orders";

export const orderView = defineProjectedResourceCollection({
  pattern: "orders/*",
  scope: "user",
  stateSchema: z.object({ status: z.string() }),
  async read({ key, ctx }) {
    const order = await findOrder(key, { userId: ctx.userId, orgId: ctx.orgId });
    if (!order) return null;
    return { status: order.status };
  },
  async search({ query, ctx }) {
    const found = await searchOrders({ userId: ctx.userId, orgId: ctx.orgId, text: query.search });
    return { hits: found.map((order) => ({ key: order.id, state: { status: order.status } })) };
  },
  client: { state: { read: true } },
});
```

### Projected collection fields

| Field | Type | Meaning |
|---|---|---|
| `pattern` | string | Required. A wildcard pattern, `positions/*` or `positions/**`. |
| `scope` | `"session"`, `"user"` or `"org"` | Required. |
| `stateSchema` | Zod schema | Required. Every record is validated through it. |
| `read` | `({ key, ctx }) => record \| null` | Required. Resolves one record. `null` means the app has no such record. |
| `search` | `({ query, ctx }) => { hits, nextCursor? }` | Required. Returns a page of `{ key, state }` hits in rank order. |
| `contentTemplate`, `contentTemplateRef` | | Renders each record to Markdown against `state`. At most one. |
| `llmReadable` | boolean | Default `false`. Gates the model's read and search tools. |
| `client` | object | Projects `clientData` as for a collection. `client.content.create`, `update` and `delete` are refused. |
| `reactTo` | object | `created`, `stateUpdated` and `deleted` accepted at definition. See [Reactions](#reactions). |

There is no `writable`, `llmWritable`, `edges`, `prefetchMode`, `maxInstances` or `eviction`.

### The query and the context

`query` is `{ search?, prefix?, filter?, limit?, cursor? }`. `filter` is an equality map. Hits keep the order you return them, and the framework does not re-rank. Pass the page's `nextCursor` back as `query.cursor` for the next page. A bare string passed to `list` is `{ search }`.

`ctx` is derived by the framework from the request. Scope every query with it, not with caller input.

| Field | Holds |
|---|---|
| `scope` | `"session"`, `"user"` or `"org"`. |
| `scopeId` | The resolved session, user or org id. |
| `userId` | The server-derived owner. |
| `orgId` | The organization, when there is one. |
| `tenantId` | The tenant, when there is one. |
| `flowKind` | The flow the read runs under. |
| `signal` | The request's abort signal. |

A user-scoped collection belongs to a user inside one organization. Use both `userId` and `orgId` in every query.

### Reading a projected collection

`ctx.resources.<name>` has `get(key)`, `getOptional(key)` and `list(query?)`, which returns `{ items, nextCursor? }`. There is no `create`, `upsert`, `delete` or `count`. A ref has `path`, `scope`, `uri`, `state`, `readContent()` and `readContentRaw()`, and no writers. Two reads of one key in a request share one `read` call. The next request calls the hook again.

| Call | Result | `read` called |
|---|---|---|
| `get`, the app has the record | The ref | Yes |
| `get`, `read` returns `null` | Throws `not found` | Yes |
| `getOptional`, `read` returns `null` | `undefined` | Yes |
| `read` returns a record that fails `stateSchema` | Throws, naming `stateSchema` | Yes |
| `get` with a key that does not match the pattern | Throws `does not match` | No |
| `list`, a hit fails `stateSchema` | That hit is dropped and logged, the rest of the page returns | |
| Org scope, the session has no org | Routes refuse with an error naming the organization. In a block, `get` throws not found, `getOptional` returns `undefined` and `list` returns an empty page | No |

### Who reaches a projected collection

| Caller | What it gets |
|---|---|
| A block | `get`, `getOptional`, `list` |
| The model, `searchResources` | Calls `search`. Needs `llmReadable: true`. Returns `nextCursor` only when one projected collection is the only searchable source. |
| The model, `globResources`, `grepResourceContent` | Skip projected collections |
| The model, `resourceTools()` create, read, update and delete | Skip projected collections |
| The model, `readResourceContentTool()` | Reads a record whose `uri` it already has |
| HTTP list route | `GET /sessions/:id/resources/:ref?limit=&cursor=&topicPrefix=` runs `search`. `topicPrefix` becomes `query.prefix`. |
| HTTP item-state route | `200` with `null` when the app has no such record |
| HTTP create, update, delete | `403` `read-only projected collection` |
| Session snapshot | `{ prefetched: [] }` with no `count` |
| React | `useResourceCollectionList` pages through `nextCursor` |

Definition-time refusals: a `[name]` parameterized pattern, a scope other than the three, a missing `read` or `search`, `client.content.create`, `update` or `delete`, both `contentTemplate` and `contentTemplateRef`, and `reactTo.contentUpdated`.

A projected collection has no write surface through resources. Change the data through the app's own store. The next `get` or `list` sees it.

## Faceted collections

`defineFacetedCollection` is a collection that classifies each body with an evaluator when it is written, and stores the answers so a search is a filter over them. It returns `{ collection, search, reindex, resources }`.

| Field | Meaning |
|---|---|
| `name` | Required. The key the collection is registered under. Blocks declare `tickets.collection` under the same key. |
| `evaluator` | Required. An evaluator block whose questions are a fixed object. It receives the body string as input. |
| `stateSchema` | Required `z.object`. `facets` and `indexedAs` are added. |
| `pattern`, `scope` and other collection fields | As for `defineResourceCollection`. |
| `client` | Reads and deletes allowed. `content.create` and `content.update` refused. |
| `reactTo` | `created`, `stateUpdated`, `deleted` only. |

Pass `resources` to `defineFlow({ resources })`. It registers the collection under `name` and carries any resources the evaluator declares. If the flow registers nothing under `name`, or a different collection, the first body write saves the body and then throws an error naming `resources`. Only that turn fails.

| Refused when defined | |
|---|---|
| A pattern with parameters | Use a wildcard pattern |
| `writable: false` | |
| `client.content.create` or `client.content.update` | |
| Your own `reactTo.contentUpdated` | |
| A `stateSchema` that is not a `z.object`, or that declares `facets` or `indexedAs` | |
| A question with the id `minConfidence` | |
| A value that is not an evaluator block, or an evaluator whose questions are a function | |
| An evaluator whose input schema rejects a string, with no `connectInput` | |
| An evaluator with `flowConfigSchema`, a resource under `name`, or a single resource with `prefetchMode: "lazy"` | |

### What a write does

| Step | Behavior |
|---|---|
| Trigger | Every body write inside a flow turn, from an action, a tool or an agent. |
| 1 | The body is saved, and `facets` is cleared, so a failed classification leaves the entry matching no facet search. |
| 2 | The evaluator runs on a side chain. A failure shows in the trace and does not fail the save. |
| 3 | The answers are stored on `facets`, keyed by question id, exactly as the model gave them. `indexedAs` records which write they belong to. |
| Stale answers | If the body is written again during a classification, the earlier answers are discarded. On the filesystem store this holds within one process only. |
| Retries | None. An entry whose classification failed has no facets until reindexed. |

### The search and reindex blocks

| Block | Input | Output |
|---|---|---|
| `search` | One optional value per `choice` question, and optional `minConfidence` from 0 to 1 | `{ keys }` |
| `reindex` | `{ force? }` | `{ reindexed, failed }` |

`search` runs no model. An entry with no facets never matches. `minConfidence` applies to the choices the query names: a named choice whose stored answer has no confidence fails it, so a model that never reports confidence matches nothing once the query names a choice. A query that names no choice matches every entry that has facets. Used as a model tool, `search` shows each question's options as the allowed values.

`reindex` classifies entries without facets, or every entry with `force: true`. `failed` lists keys whose classification failed. They keep no facets and are not retried. An entry a newer write rewrote during the reindex is in neither list.

Question kinds are `choice`, `score` and `boolean`. All three are stored on `facets`. Only `choice` can be searched. On a projected collection, pass facet values in `filter` of your own query instead.

## Finding resources

The model's search tools come from `resourceSearchTools()`: `{ globResources, grepResourceContent, searchResources }`. All three cover single resources and collection entries, only see resources with `llmReadable`, and return scope-qualified `uri` strings.

| Tool | Input | Output |
|---|---|---|
| `globResources` | `pattern` (null lists every readable uri, sorted), `limit` (default 100) | `{ uris }` |
| `grepResourceContent` | `pattern`, `prefix`, `maxResults` (default 50) | `{ matches: [{ uri, line, snippet }] }`, lines counted from 1 |
| `searchResources` | `query`, `prefix`, `limit` (default 10), `cursor` | `{ results: [{ uri, score, snippet }], nextCursor? }` |

| Rule | Detail |
|---|---|
| Patterns and prefixes | `pattern` and `prefix` match the within-scope path (`concepts/**`, not `session/concepts/**`). Only results carry the scope. A prefix matches on a path boundary. |
| Glob | picomatch syntax: `*` within a segment, `**` across segments. Reads no content. |
| Grep | `pattern` is a regular expression, matched as a literal substring when it is not valid. Matches rendered content, line by line. The pattern is not sandboxed, so a pathological regex can be slow. |
| Search | Store-backed resources are scored by term frequency, and non-matches are dropped. Projected collections are ranked by the `search` hook's order, with `score` a descending number per collection: the first hit has the highest and the last has `1`. `cursor` applies to a single projected collection only. |
| Snippets | Cut to 200 characters. |
| What is matched | Rendered content, not template source. Search is lexical, not semantic. |

## Edges

`edges: true` or `edges: { vocabulary?, maxEdges? }` on a resource or collection stores a typed-link graph in its own state, under an `edges` array. The framework adds `edges: Edge[]` (default `[]`) to the schema, and an `edges` field you declare is left alone. A resource without `edges` is unaffected, and there is no separate storage key.

| Option | Meaning |
|---|---|
| `vocabulary` | Allowed relation types. `add` throws for any other type. Without it, any type is accepted. |
| `maxEdges` | A cap on stored edges. Without it, edges are unbounded. Past the cap, `add` removes superseded edges first (oldest first), then the lowest-confidence active edges (oldest first on a tie). The edge being added is kept. |

An edge is directed and typed. A node is a string id, conventionally `namespace:key`. `nodeRef("ticker", "NVDA")` builds `ticker:nvda` (the key is lowercased) and `parseNodeRef` splits at the first colon.

| Field | Meaning |
|---|---|
| `id` | Assigned by `add`. |
| `from`, `to` | Node ids. |
| `type` | The relationship, in active voice. |
| `confidence` | From 0 to 1. Default `1`. |
| `validFrom`, `validUntil` | When the edge was true. `validUntil: null` means the edge has not ended. |
| `source` | Provenance ids. Default `[]`. |
| `createdAt` | When it was recorded. |

Reads on `ref.edges` are synchronous and come from state. Writes are async and follow the [state write rules](#state-write-rules).

| Operation | Takes | Returns |
|---|---|---|
| `add(input)` | `{ from, to, type, confidence?, validFrom?, source? }` | The stored edge |
| `supersede(id, at?)` | An edge id | Sets `validUntil` to `at` (default: the current time). No-op when the id is absent. |
| `remove(id)` | An edge id | Deletes the edge |
| `all(opts?)` | `{ at? }` only | Every stored edge, or those active at `at` |
| `neighbors(node, opts?)` | A node | The edges touching it |
| `egoGraph(node, opts?)` | A node | `{ nodes, edges }` within `depth` hops |
| `shortestPath(from, to, opts?)` | Two nodes | The ordered edges, `[]` when `from` equals `to`, `null` when no chain exists within `depth` |
| `pruneDangling(nodes)` | The node ids you know | Removes edges with an endpoint not in the set, returns the count removed |

Traversal options: `depth` (default 2, at most 6), `direction` (`"both"` by default, or `"out"` or `"in"`), `relationTypes` (default all), `at` (default: the current time). Traversals only follow edges active at `at`. They are depth-bounded and cycle-safe. This is not a graph database: size it for hundreds to low thousands of edges per resource, and keep a larger graph in a store built for it.

## Reactions

`reactTo` runs a block when a resource changes.

| Kind | Payload | Fires on | Single resource | Collection |
|---|---|---|---|---|
| `created` | `ResourceChange` | A new entry | Refused | Yes |
| `stateUpdated` | `ResourceChange` | A state write | Yes | Yes |
| `deleted` | `ResourceChange` | A delete or eviction | Refused | Yes |
| `contentUpdated` | `ResourceContentChange` | A content write | Yes | Yes |

A projected collection accepts `created`, `stateUpdated` and `deleted` in `reactTo` and refuses `contentUpdated`. Its data changes in the app, outside the framework: to run flow work after a change, dispatch an action that reads the collection.

An entry is a block, or `{ block, when }` where `when(change)` returns a boolean and `false` skips the run. `patchState` fires `stateUpdated` only and `writeContent` fires `contentUpdated` only. Bind one block to both to react to either.

| `ResourceChange` field | Meaning |
|---|---|
| `key` | The entry key, or the single resource's name |
| `ref` | The full storage path, such as `ticketNotes/n-1` |
| `kind` | `"created"`, `"stateUpdated"` or `"deleted"` |
| `state` | State after the change. `null` on `deleted`. |
| `prevState` | State before. `null` on `created`. |
| `evicted` | `true` only for a delete caused by `eviction` |

`ResourceContentChange` is `{ key, ref, kind: "contentUpdated" }`. Bodies are never inlined: call `readContent()` in the block for the new body, which runs after the body is stored. `resourceChangeSchema(stateSchema)` and `resourceContentChangeSchema()` build a block's `inputSchema` for each payload.

| Behavior | Detail |
|---|---|
| `contentUpdated` | Shares timing, the cascade limit, `when` and trace nesting with the state kinds. |
| Timing | Blocking, inside the turn that made the change. Items emitted land in that turn's stream in order. |
| Failure | A reaction that throws fails the mutating turn. Use a sequencer with `.sideChain()` for work that should not. |
| Cascade limit | Per turn, depth 8 and a total of 1000 reactions. Neither is configurable. A breach skips the block that would exceed it and emits a failed `error` item with code `reactive_cascade_exceeded`. It does not throw. |
| Trace | Nested under the block that made the change, at `__reactive__/<ref>/<kind>#<n>`. |
| `contentUpdated` sources | Server-side writes: a tool's `writeContent`, the generic content tool, a file flush. `client.content.update` does not fire it. |
| Client writes through `runBy` | Run no `reactTo` binding. |
| `onInstance*` callbacks | Collections only. Awaited, and receive `{ log, scopeType, scopeId, cell, orgId }`. They cannot emit items or run blocks. Both can be set on one collection. |

## Model access

The model reaches a resource only through core's resource tools. The content tools and search tools need the definition to opt in. `resourceTools()` create, update and delete follow the flow's visibility rule instead.

| Setting | Effect |
|---|---|
| `llmReadable: true` | `readResourceContentTool()` can read the body. `grepResourceContent` and `searchResources` can find it. On a collection it covers every entry, and `resourceTools()`'s `readResource` also reads entry state without `secret` fields. |
| `llmWritable: true` | `writeResourceContentTool()` can overwrite the body. It does not need `llmReadable`, and does not gate `resourceTools()`. On a collection it covers every entry. |
| `writable: false` | Refuses the write even when `llmWritable` is set. |

| Tool | Input | Output |
|---|---|---|
| `readResourceContentTool()` | Optional `uri` | With a `uri`, `{ uri, content }`. Without, `{ uris }`, every readable uri sorted. A uri that is missing or not `llmReadable` throws `Readable resource not found for uri: …`. |
| `writeResourceContentTool()` | `uri`, `content` | `{ uri, ok: true }`. A uri that is missing or not writable throws `Writable resource not found for uri: …`. |
| `resourceTools()` | `createResource`, `readResource`, `updateResource`, `deleteResource`, each by `path` | Collections only. Projected collections are skipped. `readResource` needs `llmReadable`. `createResource`, `updateResource` and `deleteResource` reach every collection the `resourceVisibility` rule leaves `"visible"`, with `llmWritable` off or on. |

Tools address a resource by its `uri`, so a result from `globResources` or `grepResourceContent` feeds a read.

`defineFlow({ resourceVisibility })` narrows what the model reaches on each turn. The rule is `(ctx, { name, ref }) => "visible" | "read-only" | "hidden"`. Keep it synchronous: it runs on every listing and lookup. Decide from what your server wrote, not from the turn's input.

| Result | Effect |
|---|---|
| `"visible"` | What the resource's own flags allow |
| `"read-only"` | Listed, searched and read, not written |
| `"hidden"` | Absent from every listing, and "not found" when named |

The rule narrows only. It does not affect `ctx.resources.<name>` in your own blocks.

## Browser access

A resource with no `client` config is invisible to clients. Its routes answer `404` when the flow does not declare it, and `403` when it does.

### `client` fields

| Field | Applies to | Meaning |
|---|---|---|
| `content.read` | Both | Clients can fetch the body. |
| `content.prefetch` | Both | The snapshot carries the body inline. |
| `content.create`, `content.update`, `content.delete` | Collections | Clients can create, edit or delete entries, through the session routes. Session scope only. |
| `state.read` | Collections | The list and item-state routes work, and `prefetched` entries carry `clientData`. |
| `expose` | Both | State fields to send. Checked against `stateSchema`. |
| `exclude` | Both | State fields to hide. A field added to the schema later is sent. |
| `data` | Both | `(state) => JsonValue`. Computed shapes. It sees the full state, and a `secret` field in what it returns is dropped. |
| `live` | Both | Stream each state change as an inline delta. See [Live updates](#live-updates). |

Set at most one of `expose`, `exclude` and `data`. Prefer `expose`: a new field stays private until you list it.

| Resource | Projection set | `clientData` sent |
|---|---|---|
| Single | `expose`, `exclude` or `data` | The projection |
| Single | None | Omitted from the snapshot. Content is available when `content.read` is set. |
| Collection | Any projection, with `state.read: true` | The projection of each entry |
| Collection | None, with `state.read: true` | Each entry's full state minus `secret` fields |
| Collection | Without `state.read` | None. The list and item-state routes return `403`, and `prefetched` carries only `topic` and `storageKey` (and `content` when `content.prefetch` is set). |

A collection's `count` is in the snapshot whenever the collection has a `client` config, whatever `state.read` says. An owner-keyed collection counts only rows the caller may see.

### Secret fields

`secret: [fields]` on a definition keeps fields on the server. They are left out of the session snapshot, the list and item-state routes, live deltas, the debug routes and `readResource`. Blocks read and write them through the handle. A `client.data` function sees them and may derive from them. With no projection, or with `exclude`, `ClientDataOf` includes `secret` fields in its type, although their values are never sent. Pair `secret` with `expose`. `secret` covers state, not content: a template that interpolates a secret field puts it in the body. Every flow that declares a shared user or org collection must name the same `secret` fields, or registering throws.

### Session snapshot

```text
resources: {
  org: { refundPolicy: { clientData: { version: "v1" }, content?: "…" } },
  session: { ticketNotes: { count: 3, prefetched?: [{ topic, storageKey, clientData?, content? }] } }
}
```

The snapshot groups resources by scope. A single resource's entry has `clientData` when a projection is set and `content` when `content.prefetch` is set. A collection's entry has `count`, and `prefetched` when `prefetchWindow` is above 0. A projected collection has `{ prefetched: [] }`.

### HTTP routes

All paths are under `/api/flows`. The read routes:

| Method | Path | Purpose | Notes |
|---|---|---|---|
| `GET` | `/sessions/:id/resources/:ref/content` | A single resource's body | `403` without `content.read`; `400` for a collection |
| `GET` | `/sessions/:id/resources/:ref/:topic/content` | An entry's body | `404` for a missing entry; `400` when the topic does not match the pattern |
| `GET` | `/sessions/:id/resources/:ref` | One page of entries | `limit` 1 to 200 (default 50, anything else `400`), `cursor`, `topicPrefix`. Returns `{ items: [{ topic, storageKey, clientData }], nextCursor? }`. `403` without `state.read`. |
| `GET` | `/sessions/:id/resources/:ref/:topic` | One entry's state | `200` with `null` when absent. `403` without `state.read`. |
| `GET` | `/sessions/:id/manifest` | The [manifest](#the-manifest) | `404` for an unknown session |

Both content routes answer `content: null` when a resource's `contentTemplateRef` template is stored under an owner segment for a user other than the caller, unless an `ownerWrites` collection in the template's scope covers that key. See [Owner-keyed rows](#owner-keyed-rows).

The write routes:

| Method | Path | Purpose | Notes |
|---|---|---|---|
| `POST` | `/sessions/:id/resources/:ref` | Create an entry | Body `{ topic, content? }`. `201`. Needs `content.create`. |
| `PATCH` | `/sessions/:id/resources/:ref/:topic/content` | Replace an entry's body | Body `{ content }`. Needs `content.update`. |
| `DELETE` | `/sessions/:id/resources/:ref/:topic` | Delete an entry | Needs `content.delete`. Deleting a missing entry is `200`. |

The write routes work for session-scoped collections only and answer `501` otherwise. `:topic` takes slashes, which clients encode as `%2F`. A topic named `content` is not reachable through the item-state route.

Create, update and delete refuse as follows.

| Status | When |
|---|---|
| `400` | `POST` for a collection whose `stateSchema` cannot produce a valid state from `{}`, naming the field. Give required fields a `.default()`. |
| `409` | `POST` for a topic that already exists. On SQLite and Postgres, of two simultaneous creates of one topic, one gets `201` and one `409`. On the filesystem store that holds within one store instance only. |
| `409` | `DELETE` when the entry's state changed while the request was served. The entry and its content stay intact. Re-read and retry. |
| `403` | The permission is not granted, or the collection is projected, or the write is refused by an owner rule. |

`POST` writes the entry's state, then its content. If the content write fails, the request errors but the entry exists with no content row: reading it returns `null`, and creating the same topic again gets `409`. Repair it with `PATCH`. Grant `content.update` with `content.create`, and send `content` with every `POST`.

### Live updates

A change made during a turn emits a `resource_change` event on that turn's stream. By default it only tells the client to refresh the snapshot when the request completes.

| Resource | Announces mid-stream |
|---|---|
| Collection | Every entry mutation, whatever its `client` config |
| Single resource | State writes only when `client.live: true` |
| Single resource, content write | Falls back to the refresh |

With `client.live: true`, each state change carries the projected `clientData` inline and the React hooks apply it without a refetch. Only the projection travels, never content. A deleted entry is marked gone. A collection's `count` and list pages reconcile when the request ends. `live` requires `clientData` to be visible: a projection, or `state.read: true` on a collection.

Changes from another session reach a view that gives `useSession` the `live` option, which reads again when any other session changes a resource the client can read. The notice carries no data, and the view re-reads with the caller's own permissions.

`lifecycleSchema(statuses)` returns a field set for a `stateSchema`: a required `status` enum and nullable `startedAt`, `completedAt` and `errorMessage`.

### React hooks

From `@flow-state-dev/react`.

| Hook | Returns |
|---|---|
| `useResource(def, options?)` | The resource or collection at any scope, kept current. At user or org scope it needs no session. At session scope pass `{ session }`, or `{ sessionId }` where the screen has no session view. Returns `{ value, stale }`. A user or org resource adds `set(value)` and `update(updater)`. A user or org collection has the first page of entries (up to 200) as `value`, and adds `set(entry, value)`, `update(entry, updater)` and `delete(entry)`. |
| `useResourceContent(session, ref)` | `{ clientData, content, isLoading, refetch }` for a single resource |
| `useResourceCollection(session, ref)` | `{ list, get, query, actions, refetch, prefetched, count, live, wrap }`. `actions` has `create`, `update`, `delete`. |
| `useResourceCollectionList(session, ref, { limit?, topicPrefix? })` | `{ items, hasMore, isLoading, error, refetch, loadMore }`, paged by cursor |
| `useCollectionResource(session, ref, topic)` | `{ item, isLoading, error, refetch }` |
| `useResourceManifest(session)` | `{ manifest, isLoading, error }`, cached per flow kind |

`ClientDataOf<typeof definition>` gives the projected `clientData` type of a definition. Pass it as the type parameter of a hook. The type follows the projection: `expose` gives a `Pick`, `exclude` an `Omit`, no projection the full state, `data` the function's return type. A `data` function needs an annotated return for the type to be precise.

`@flow-state-dev/client` exposes the same calls as `client.resources`.

| Method | Route |
|---|---|
| `getResourceContent(sessionId, ref)` | Single resource body |
| `getCollectionResourceContent(sessionId, ref, topic)` | Entry body |
| `listCollectionResources(sessionId, ref, { limit?, cursor?, topicPrefix? })` | One page |
| `getCollectionResourceState(sessionId, ref, topic)` | Entry state, or `null` |
| `createCollectionResource(sessionId, ref, { topic, content? })` | Create |
| `updateResourceContent(sessionId, ref, topic, { content })` | Replace a body |
| `deleteCollectionResource(sessionId, ref, topic)` | Delete |
| `getResourceManifest(sessionId)` | The manifest |

A refused call rejects with `ClientHttpError`, whose `status` is the server's answer.

### The manifest

`GET /sessions/:id/manifest` returns `{ flowKind, resources }`. It is the same for every session of a flow kind, and it needs only that the session exists. Cache it by flow kind.

| Entry field | Meaning |
|---|---|
| `ref` | The name in the flow's `resources` |
| `kind` | `"single"` or `"collection"` |
| `scope` | `"session"`, `"user"` or `"org"` |
| `pattern`, `prefetchWindow` | Collections only. `prefetchWindow` is `0` when unset. |
| `hasClientData` | Collection: `state.read` is `true`. Single: a projection is declared. |
| `client` | The declared `content` and `state` flags |

A resource appears when its `client` config sets any permission flag to `true`, or `hasClientData` is true. An empty `client: {}` is not listed. The manifest carries no schemas, no per-entry data and nothing that changes while a session runs.

### Client writes

`runBy` lets a client write a user or org resource, or the entries of a user or org collection, with no session. `client.resource(def)` from `@flow-state-dev/client` reads and writes it.

| `runBy` | Who writes |
|---|---|
| Omitted | A client cannot write. Flows write it from their actions. |
| `"default"` | The framework's default write flow checks the schema, the owner, then `canWrite`, then the version the client read. |
| `{ flow: "<kind>" }` | The named flow's actions write it by their own rules. |

| Rule | Refused when defined |
|---|---|
| `canWrite` | Without `runBy: "default"` |
| `runBy` | At session scope; with `flowIsolation: true`; with no `client` config |
| `runBy` on a single resource | With a `client` config that projects no state |
| `runBy` on a collection | Without `client.state.read: true` |
| `runBy: "default"` | With `writable: false`, a computed `client.data`, or a collection `eviction` other than `"none"` |
| `runBy: "default"` on an org resource or collection | Without `canWrite`. Declare `canWrite: () => true` to let everyone in the org write. A user resource or collection needs no `canWrite`: it is its owner's. |

`canWrite({ prev, next, userId, orgId })` returns whether to admit a write. On a collection it also gets `key`, with `prev` undefined on a create and `next` undefined on a delete. Identity comes from the verified sign-in.

| `client.resource(def)` handle | Methods |
|---|---|
| Single resource | `read()` returns `{ value, version }`; `state()`; `set(value, { version? })`; `update(updater)`; `send(action, input)` |
| Collection | `list({ limit?, cursor?, topicPrefix? })`; `listAll()`; `entry(key)`; `send(action, input)` |
| Entry | `read()` (`null` at version 0 when absent); `set`; `update`; `delete({ version? })` |

A write carries the version it read. If another write landed first, it is refused with `stale_version`. `update` reads again and re-runs the updater, three times at most, then rejects. A refusal rejects with `ResourceWriteError`, whose `code` is `stale_version`, `write_refused` or `not_writable`. A write only stores fields the client can read: fields hidden by `expose`, `exclude` or `secret` keep their stored values. It runs no `reactTo` binding. Views that pass `live` to `useSession` re-read after it.

The routes are `GET /resources/:scope/:key`, `GET /resources/:scope/:key/entries`, `GET /resources/:scope/:key/entries/:entry` and `POST /resources/:scope/:key/actions/:actionName`.

## When a resource loads

A request loads the resources its flow declares, directly or through its blocks. Stored data nothing declares stays stored and is not loaded.

| Declared on | Loads |
|---|---|
| The flow, `defineFlow({ resources })` | At the start of every request |
| A block, or a sequencer or router that collects it | When an action containing that block runs. A sibling action's resources do not load. |
| A block, with `prefetchMode: "lazy"` | A single resource loads when its declaring block runs. A lazy collection reads one entry from the store per key you touch. |

A sequencer collects its steps' declarations, a router its routes', and `defineFlow` merges the result into the flow's `resources`. A block carries its declaration into every flow it joins. A capability a block uses can carry resources as well. One `defineResource` reference installs once, however many blocks and capabilities list it. A different reference under one accessor throws at build: `Resource conflict in capability "<cap>" (<source>): accessor "<key>" is declared with different defineResource() references` when two capabilities clash, and `Resource conflict: accessor "<key>" is declared with different defineResource() references. Use the same reference across blocks.` when a capability clashes with the block's own `resources`.

| `prefetchMode` | Collection reads |
|---|---|
| `"eager"` (default) | The whole prefix is read before any block runs. `list()` and `count()` are exact. |
| `"lazy"` | Nothing up front. `get` reads one entry and caches it. `list()` and `count()` read the whole prefix in one unbounded scan. `maxInstances` and eviction see only loaded entries, so lazy requires `eviction: "none"`. |

Declaring a single resource with `prefetchMode: "lazy"` on the flow throws, because a flow-level declaration has no block to trigger the load. Declare it on the block. The DevTool's block trace shows, per block, which resource keys came from the store and which from cache.

### Load modes

The DevTool labels each load with the mode that triggered it.

| Mode | Triggered by |
|---|---|
| Flow eager | A resource declared on the flow, when the request starts |
| Action eager | A resource declared under the action that runs, when the action starts |
| Block eager | A lazy single resource, or an eager one not yet loaded, when the block that declares it starts |
| Lazy | A read inside a block that needs the data |

Eager is the default for a collection. A lazy collection loads on the first read that needs the data: `get`, `getOptional`, `list` and `count` each record a Lazy load. `findBy` loads through `list`. `create`, `getOrCreate`, `upsert` and `delete` also load the key first but record no load. Nothing loads before one of these runs.

A request loads only the resources of the flow, the action it runs and the blocks that run. Another action's resources are not loaded.

A projected collection reads through its `read` hook on every access. It is never loaded from the store and has no load records.

A store fetch is a round trip to the store. A cache hit is a read served from memory the request already loaded, so it carries no time. Repeated identical cache hits collapse into one record with a count. The record fields are on [Items](./items.md#resource-load-records).

## Next

- [Resources](../concepts/resources.md) explains the model with the support desk example.
- [Search a collection](../build/search-a-collection.md) finds entries by path and content.
- [Link records with edges](../build/link-records.md) builds a graph over resources.
- [Run a block when a resource changes](../build/react-to-a-change.md) uses `reactTo`.
- [Find by facets](../build/find-by-facets.md) sets up a faceted collection.
