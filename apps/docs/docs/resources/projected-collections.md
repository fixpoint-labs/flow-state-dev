---
sidebar_position: 4
sidebar_label: Projected collections
description: A read-only view of data the app already owns. Each read asks the app again.
---

# Projected resource collections

A projected collection is a read-only view of data the app already owns. The framework does not store a copy. Each `get`, `list`, or client read calls the `read` or `search` hook you supply, and the answer is whatever the app returns that moment.

Reach for it when the app is the source of truth and you do not want a second copy in the framework. When the framework should own the rows, use a [resource collection](./collections.md).

## Defining one

`defineProjectedResourceCollection` takes a wildcard pattern, a scope, a `stateSchema`, and the two hooks. `read` resolves one record by key (`null` means the app has no such record). `search` returns a page of hits. The agent's search tool, the list route, and `ctx.resources.<name>.list()` all send their query to `search`.

```ts
import { defineProjectedResourceCollection, handler } from "@flow-state-dev/core";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import { z } from "zod";

const positions = defineProjectedResourceCollection({
  pattern: "positions/*",
  scope: "user",
  stateSchema: z.object({ ticker: z.string(), shares: z.number() }),

  async read({ key, ctx }) {
    return db.positions.findOne({ userId: ctx.userId, ticker: key });
  },

  async search({ query, ctx }) {
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
  },

  contentTemplate: parseResourceTemplate(
    `<system>{{ state.ticker }}: {{ state.shares }} shares</system>`
  ),
  client: { state: { read: true }, content: { read: true } },
});
```

`contentTemplate` renders each record into Markdown against `state`. A `client` config projects `clientData` the same way a `defineResourceCollection` collection does.

Register it under any accessor name, like any collection:

```ts
const desk = handler({
  name: "desk",
  resources: { portfolio: positions },
  execute: async (_input, ctx) => {
    const aapl = await ctx.resources.portfolio.get("AAPL");
    // aapl.state.shares — from the app, validated through stateSchema
  },
});
```

`ctx.resources.portfolio` is a `ProjectedResourceCollectionRef`: `get`, `getOptional`, and `list`. There is no `create`, `upsert`, `delete`, or `count`. Two reads of the same key in one request share one `read` call. The next request calls the hook again.

## What comes back

`get(key)` returns a `ProjectedResourceRef` — `path`, `scope`, `uri`, a synchronous `state`, plus `readContent()` / `readContentRaw()`. `state` is the hook's record after `stateSchema` validation.

| Call | Result |
| --- | --- |
| `get` and the app has the record | the ref |
| `get` and `read` returns `null` | throws (`not found`) |
| `getOptional` and `read` returns `null` | `undefined` |
| `read` returns a record that fails `stateSchema` | throws (`stateSchema`) |
| `get` with a key that does not match the pattern | throws (`does not match`); `read` is not called |
| `list` and a hit fails `stateSchema` | that hit is dropped and logged; the rest of the page is returned |
| org-scoped collection, session has no org | the read is refused (`organization`); `read` is not called |

The HTTP item-state route returns `200` with `null` when the app has no such record. A client `POST` / `PATCH` / `DELETE` against the collection returns `403` with an error matching `read-only projected collection`.

Definition-time failures:

- parameterized `[name]` patterns — wildcard only (`positions/*` or `positions/**`)
- scope other than `session` / `user` / `org`
- missing `read` or `search`
- `client.content.create` / `update` / `delete` — build-time error
- both `contentTemplate` and `contentTemplateRef`

## Searching and listing

`search` receives `{ search?, prefix?, filter?, limit?, cursor? }` and returns `{ hits, nextCursor? }`. Hits stay in the order you return them. Pass `nextCursor` back as `query.cursor` for the next page. A bare string to `list` is `{ search }`.

```ts
const page = await ctx.resources.portfolio.list({ search: "tech", limit: 20 });
// page.items — read-only refs; state and rendered content already resolved
// page.nextCursor — omit on the last page
```

- **In a block** — `list` as above.
- **The agent** — with `llmReadable: true`, `searchResources` calls `search` and can page with `nextCursor` when that collection is the only searchable source. `globResources` and `grepResourceContent` skip projected collections. An agent that already has a record's URI reads it with `readResourceContentTool`.
- **The UI** — `GET /sessions/:id/resources/:ref?limit=&cursor=` returns one page and the app's `nextCursor`. `useResourceCollectionList` accumulates pages and exposes `loadMore` / `hasMore`.

`/state` does not enumerate the app. A client-visible projected collection appears as `{ prefetched: [] }` with no `count`. The UI discovers instances through list or search, then fetches each by key.

## The trusted context

`read` and `search` receive a `ProjectedResourceContext` the framework derives from the request. Scope the query with these fields, not with caller input.

```ts
type ProjectedResourceContext = {
  scope: "session" | "user" | "org";
  scopeId: string;   // the resolved sessionId / userId / orgId
  userId: string;    // the server-derived owner
  orgId?: string;
  tenantId?: string; // trusted tenant coordinate
  flowKind: string;
  signal?: AbortSignal;
};
```

## Writes stay on the app

The resource surface does not write. The ref has no mutators, the agent CRUD tools skip the collection, and the client write routes are closed.

Change the data through the app's own handlers and store. The next `get` or `list` sees that write. A live screen stays current by re-running its list or state query. To run flow work after a write, dispatch an action that reads the collection. See [Inbound transports](../advanced/inbound-transports.md).

## Limits

- The framework does not cache or materialize a copy across requests.
- Wildcard patterns only. Encode a discriminator into a path segment; `[name]` patterns are rejected.
- No `count()`. The snapshot is `{ prefetched: [] }` with no `count`.
- Ranking, filtering, and paging are whatever `search` does. The framework does not re-rank.
- `searchResources` returns `nextCursor` only when one projected collection is the only searchable source. Mixed or multi-collection search is a single page with no cursor.
- `globResources` and `grepResourceContent` skip projected collections.

## Migration

Callers of `defineExternalResourceCollection` switch to `defineProjectedResourceCollection`. The `ExternalResource*` types become `ProjectedResource*`. `isExternalResourceCollection` becomes `isProjectedResourceCollection`. The brand is `projected: true`, not `external: true`.

## See also

- [Resource collections](./collections.md) — `defineResourceCollection`
- [Searching resources](./searching.md) — `searchResources`, glob, and grep
- [Client access](./client-access.md) — `client` config and React hooks
