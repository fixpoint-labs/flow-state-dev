---
title: Serve data your app already owns
type: recipe
description: A read-only view of data the app already owns. Each read asks the app again.
---

# Serve data your app already owns

The support desk already has an orders table in its own database. A projected collection lets flows and screens read those orders without Flow State keeping a copy. You supply two functions, `read` and `search`. Every read calls one of them, and the answer is whatever your app returns at that moment.

Reach for it when the app is the source of truth. When Flow State should own the rows, use a [resource collection](../concepts/resources.md) instead.

## 1. Declare the collection

`defineProjectedResourceCollection` takes a wildcard `pattern`, a `scope`, a `stateSchema` for one record, and the two functions. `read` returns one record by key, or `null` when the app has none. `search` returns a page of hits and a `nextCursor` while more remain.

`db` is the support app's own data layer, not part of the framework.

```ts title="src/flows/support/resources/orders.ts"
import { defineProjectedResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { db } from "../../../lib/db";

export const orders = defineProjectedResourceCollection({
  pattern: "orders/*",
  scope: "user",
  stateSchema: z.object({
    id: z.string(),
    status: z.string(),
    total: z.number(),
  }),

  async read({ key, ctx }) {
    if (!ctx.orgId) return null;
    return db.orders.findOne({ userId: ctx.userId, orgId: ctx.orgId, id: key });
  },

  async search({ query, ctx }) {
    if (!ctx.orgId) return { hits: [] };
    const { rows, nextCursor } = await db.orders.find({
      userId: ctx.userId,
      orgId: ctx.orgId,
      text: query.search,
      after: query.cursor,
      limit: query.limit ?? 20,
    });
    return {
      hits: rows.map((row) => ({ key: row.id, state: row })),
      nextCursor, // leave undefined on the last page
    };
  },

  client: { state: { read: true }, expose: ["status", "total"] },
});
```

Both functions receive `ctx`, which the framework fills in from the request. Put `ctx.userId` and `ctx.orgId` in every query. The framework does not filter what your app returns, so a query without them can show a user another organization's orders. A browser reading from a session with no organization gets `ctx.orgId` as `undefined`, so the example returns nothing in that case. A block read always has an organization.

The patterns are wildcard only: `orders/*` for one path segment, `orders/**` for nested ones. `client` opens the collection to the browser, and `expose` limits which fields it sees. Without `client`, only blocks can read it.

The full field list, the rest of `ctx` and the definitions the framework refuses are in [Resources reference](../reference/resources.md#projected-collections).

## 2. Read one order in a block

Declare the collection under `resources` on a block. The key of that map is the name it has on `ctx.resources`.

```ts title="src/flows/support/blocks/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { orders } from "../resources/orders";

export const lookUpOrder = handler({
  name: "look-up-order",
  inputSchema: z.object({ orderId: z.string() }),
  resources: { orders },
  execute: async ({ orderId }, ctx) => {
    const order = await ctx.resources.orders.getOptional(orderId);
    return order ? order.state.status : "no such order";
  },
});
```

`get(key)` throws when `read` returns `null`. `getOptional(key)` returns `undefined`. Either one returns a read-only record whose `state` has been checked against `stateSchema`. A record that fails the check throws. Within one request a key is read once, and the next request asks your app again.

There is no `create`, `upsert`, `delete` or `count`. Change orders through your app's own code. The next read sees the change.

## 3. Search and page

`list` sends its query to `search`, and a bare string means `{ search }`.

```ts title="src/flows/support/blocks/find-orders.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { orders } from "../resources/orders";

export const findOrders = handler({
  name: "find-orders",
  inputSchema: z.object({ text: z.string(), cursor: z.string().optional() }),
  resources: { orders },
  execute: async ({ text, cursor }, ctx) => {
    const page = await ctx.resources.orders.list({ search: text, limit: 20, cursor });
    return {
      statuses: page.items.map((item) => item.state.status),
      nextCursor: page.nextCursor,
    };
  },
});
```

Hits come back in the order `search` returns them. Ranking and filtering are whatever your app does. A hit that fails `stateSchema` is dropped from the page, and the rest is returned.

A model can search the same collection through `searchResources` when the collection sets `llmReadable: true`; see [Search a collection](./search-a-collection.md).

## 4. Show it on a page

`useResourceCollectionList` asks for one page at a time and appends the next on `loadMore`. The second argument, `"orders"`, is the collection's name: the same key you gave it under `resources`.

```tsx title="src/app/orders-panel.tsx"
"use client";

import { useSession, useResourceCollectionList } from "@flow-state-dev/react";
import type { ClientDataOf } from "@flow-state-dev/core";
import type { orders } from "../flows/support/resources/orders";

export function OrdersPanel({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const { items, hasMore, loadMore, isLoading } =
    useResourceCollectionList<ClientDataOf<typeof orders>>(session, "orders", { limit: 20 });

  return (
    <div>
      <ul>
        {items.map((item) => (
          <li key={item.topic}>
            {item.topic}: {item.clientData?.status}
          </li>
        ))}
      </ul>
      {hasMore && (
        <button onClick={loadMore} disabled={isLoading}>
          Load more
        </button>
      )}
    </div>
  );
}
```

`items` is empty until the first page arrives. If the app needs a total, count it in your own code.

A screen shows what your app returned when it asked. Nothing tells Flow State when your data changes, so re-rendering with the same query shows the earlier answer. Remounting the component or changing `limit` asks your app again.

Browser writes to the collection are refused with `403`.

## Next

- [Resources](../concepts/resources.md): what a collection is, and how scopes decide who sees what.
- [Search a collection](./search-a-collection.md): the model's search over a collection.
- [Resources reference](../reference/resources.md#projected-collections): fields, failures, routes and limits for projected collections.
