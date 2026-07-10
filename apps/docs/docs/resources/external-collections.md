---
sidebar_position: 4
sidebar_label: External collections
---

# External resource collections

A normal [resource collection](./collections.md) keeps its instances in framework storage. You write a row, the framework holds it, and reads come back from that copy. That works well when the framework owns the data. It works badly when your app already owns it.

An **external collection** points the framework at a store you already run — a SQL table, an HTTP API — and reads through to it. The framework never holds a copy. Each read re-asks your store for the truth. Your database stays the single source of truth, and the same data becomes something the agent can read and a screen can show, from one definition.

The term for this is **read-through**: instead of caching a copy that drifts, the framework re-queries on every read. No mirror, no dual-write, no stale cache to invalidate.

## When to reach for it

Reach for an external collection when:

- Your app is the source of truth for the data (it lives in your DB or behind your API), and
- You want the agent and the UI to see it without copying it into the framework first.

If the framework is a fine home for the data — it has no life outside a flow, no relational shape, no other system writing it — a plain `defineResourceCollection` is simpler. Use an external collection when copying the data in would mean fighting staleness.

## Defining one

You supply two backing functions. `read` resolves one record by its key. `search` resolves a filtered page — the agent's search tool, the list route, and `ctx.resources.<name>.list()` all push their query down to it, so your store's engine does the filtering and ranking, never the framework in memory.

```ts
import { defineExternalResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

const positions = defineExternalResourceCollection({
  pattern: "positions/*",
  scope: "user",
  stateSchema: z.object({ ticker: z.string(), shares: z.number() }),

  // Resolve one record from your store. `null` = no such record.
  async read({ key, ctx }) {
    return db.positions.findOne({ userId: ctx.userId, ticker: key });
  },

  // Push the query down to your store — never enumerate in memory.
  async search({ query, ctx }) {
    const rows = await db.positions.find({ userId: ctx.userId, limit: query.limit ?? 20 });
    return { hits: rows.map((r) => ({ key: r.ticker, state: r })) };
  },

  // Optional: render each record into agent-facing Markdown.
  contentTemplate: parseResourceTemplate(
    `<system>{{ state.ticker }}: {{ state.shares }} shares</system>`
  ),
  client: { state: { read: true }, content: { read: true } },
});
```

Register it under any accessor name, like any collection:

```ts
const desk = handler({
  name: "desk",
  resources: { portfolio: positions },
  execute: async (_input, ctx) => {
    const aapl = await ctx.resources.portfolio.get("AAPL");
    // aapl.state.shares — read straight from your store, validated through stateSchema
  },
});
```

`ctx.resources.portfolio` is typed read-only: `get` and `getOptional`, no `create` / `upsert` / `delete`. Reads within one request are memoized and de-duplicated, so a fanned-out read of the same key issues one `read` call.

## What the agent and UI see

Each record's `state` comes from your `read` hook, validated through `stateSchema` — the same normalization a framework-stored record gets. From there everything is identical to a normal collection:

- **Agent-facing content** — `contentTemplate` renders the record into Markdown against its `state`.
- **Client projection** — a `client` config projects each record's `clientData` for the UI, and the client state/content routes resolve through your `read` hook.

The snapshot does **not** enumerate your store. A client-visible external collection appears in the `/state` snapshot as an empty anchor (unknown cardinality, never a misleading count of zero); the UI discovers instances through the list/search route and then fetches each by key.

## Searching and listing

Every "find" path pushes its query down to your `search` hook — the framework never lists your store and scores in memory. Your hook returns a page of hits plus an opaque `nextCursor`; pass that cursor back to get the next page.

```ts
async search({ query, ctx }) {
  // query: { search?, prefix?, filter?, limit?, cursor? }
  const rows = await db.positions.find({
    userId: ctx.userId,
    q: query.search,
    after: query.cursor,
    limit: query.limit ?? 20,
  });
  return {
    hits: rows.map((r) => ({ key: r.ticker, state: r })),
    nextCursor: rows.nextCursor, // omit on the last page
  };
}
```

Three surfaces consume it:

- **In a block** — `ctx.resources.portfolio.list(query?)` returns `{ items, nextCursor? }`, where each item is a read-only ref (its `state` and rendered content already resolved). A bare string is shorthand for `{ search }`.
- **The agent** — when the collection is `llmReadable`, `searchResources` routes to your hook instead of scanning content in memory. It returns a `nextCursor` the model can page with. `globResources` and `grepResourceContent` deliberately **skip** external collections: their contract is deterministic path/line matching, which a pushed-down lexical or semantic search can't honor. An agent that already has a record's URI reads it directly with `readResourceContent`.
- **The UI** — `GET /sessions/:id/resources/:ref?limit=&cursor=` returns one page and the app's `nextCursor`. The React `useResourceCollectionList` hook accumulates pages and exposes `loadMore` / `hasMore` over that cursor.

Hits arrive in the order your hook returns them (your store's ranking), and each is validated through `stateSchema` — a row that fails validation is dropped and logged, so one bad record never sinks the page.

## Staying in sync

An external collection is a read-through view, so every read is already current — the framework holds no copy to go stale. The real question is *when* to read again after your store changes. There's no invalidation to manage; the freshness is structural. What's left is deciding what a change should trigger.

**Run work when your data changes.** Wire your app's own change event — a database trigger, a queue message, a webhook from an upstream system — to a flow action through an [inbound transport](../advanced/inbound-transports.md). The action reads the external collection the same way any block does, and because the read goes straight to your store, it sees the change.

```ts
// Your app already emits "position changed" somewhere. Point it at a flow —
// here through a declared webhook (see the Webhooks guide for the full setup):
const desk = defineFlow({
  kind: "desk",
  webhooks: {
    portfolio: {
      on: {
        "position.changed": {
          input: (e) => ({ ticker: e.payload.ticker }),
          block: rescoreThesis, // reads ctx.resources.portfolio.get(ticker) — fresh
        },
      },
    },
  },
  // ...actions, resources
});
```

The session doesn't have to be open — the dispatch stands one up. This is the path for "something changed, go re-derive / re-score / notify."

**Refresh a live screen.** Pushing a projected update into a session someone is watching *right now*, so the open view re-renders without a refetch, is a separate and heavier mechanism — it's a deferred follow-up. Until it lands, a live view stays current by re-reading: the client re-runs its list/search query, or an inbound event (above) dispatches a flow the open session observes.

## The trusted context

Your `read` / `search` hooks receive a `ctx` the framework derives from the request — never from caller input:

```ts
type ExternalResourceContext = {
  scope: "session" | "user" | "org";
  scopeId: string;   // the resolved sessionId / userId / orgId
  userId: string;    // the server-derived owner
  orgId?: string;
  tenantId?: string; // trusted tenant coordinate for multi-tenant queries
  flowKind: string;
  signal?: AbortSignal;
};
```

Scope your query with these fields, not with anything the caller passed. `userId` and `tenantId` are the framework's own trusted coordinates, so your store reads land in the same owner and tenant namespace the rest of the flow uses.

## Read-only by design

An external collection is read-only across every surface. The ref has no mutators, the agent CRUD tools skip it, and the client `POST` / `PATCH` / `DELETE` routes are closed. Declaring `client.content.create` / `update` / `delete` is a build-time error.

The agent still changes your data — through handlers that call your store directly, the same as any other app write. What an external collection adds is the *read* view. Your app's writes are observed; the resource surface does not offer a second way to write.

## Limits and tradeoffs

- **A hook call per read.** Read-through trades a cached copy for freshness. Reads are memoized per request, but there is no cross-request cache in this slice.
- **Patterns are wildcard-only.** `positions/*` or `positions/**`. Parameterized `[name]` patterns are rejected at build time — encode the discriminator into a wildcard segment.
- **The snapshot doesn't enumerate.** There is no `count()`; an honest count would need to either enumerate your store (forbidden) or a hook nobody has asked for yet. Listing is cursor-paged, so the UI pages through instead of asking "how many."
- **Search is your store's, not the framework's.** Ranking, filtering, and paging are whatever your `search` hook does. The framework passes the query down and the cursor back; it doesn't re-rank. Glob and grep skip external collections for the same reason — their deterministic contract isn't something a pushed-down search can promise.
- **Live-view push is a follow-up.** An idle session already reacts to your data changing — dispatch a flow through an inbound transport (see [Staying in sync](#staying-in-sync)). Pushing a projected delta into an *open* screen without a refetch is the deferred piece.
