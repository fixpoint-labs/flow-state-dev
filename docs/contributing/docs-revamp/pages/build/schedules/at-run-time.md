---
title: Let users schedule work at run time
type: recipe
description: "Store a user's schedule as a row, and let the app's one clock fire whatever is due."
---

# Let users schedule work at run time

A schedule you write in code is the same for everyone and changes when you deploy. A schedule a user sets, such as "send me my ticket digest at 8", is different for each user and changes any time. You can't deploy for that, or add a cron entry per user.

So it is a row of data, saved like any other record a user owns, and the app has one clock that reads the rows. Each minute the clock fires the rows that are due. Adding a schedule is writing a row. Removing it is deleting the row.

This page builds that for the support desk: each user picks when their ticket digest arrives. Options and exact answers are in the [schedules reference](../../reference/schedules.md).

## 1. Store a schedule as data

A schedule collection holds one user's schedules, one row per key. A row has a `cron` expression, a `kind` that names what to run, and `enabled`. `kind` is a plain string because a row can't hold a block. The flow maps each kind to a block in step 2. The other row fields are in the [schedules reference](../../reference/schedules.md).

```ts title="src/flows/support/schedules.ts"
import { defineScheduleCollection } from "@flow-state-dev/scheduled";
import { scheduleIndex } from "../../lib/schedule-index";

export const schedules = defineScheduleCollection({
  pattern: "schedules/*",
  index: scheduleIndex,
});
```

`index` is the list of when each schedule next fires. The clock reads it to find what is due, and the collection keeps it up to date. The example keeps it in SQLite; Postgres and the index methods are in the [schedules reference](../../reference/schedules.md).

```ts title="src/lib/schedule-index.ts"
import Database from "better-sqlite3";
import { createSQLiteScheduleIndex } from "@flow-state-dev/store-sqlite";
import type { ScheduleIndex } from "@flow-state-dev/scheduled";

// Open the index on first use, after the stores have created its table.
let opened: ScheduleIndex | undefined;
const open = () => (opened ??= createSQLiteScheduleIndex(new Database("data/support.sqlite")));

export const scheduleIndex: ScheduleIndex = {
  upsert: (entry) => open().upsert(entry),
  claimDue: (now, limit) => open().claimDue(now, limit),
  remove: (id) => open().remove(id),
};
```

## 2. Let the clock run what is due

The block a schedule runs is an ordinary handler. It runs as the user who made the schedule, so `ctx.user` is that user.

```ts title="src/flows/support/blocks/send-ticket-digest.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const sendTicketDigest = handler({
  name: "send-ticket-digest",
  inputSchema: z.object({}).passthrough(),
  execute: async (_input, ctx) => {
    console.log(`digest for ${ctx.user?.identity.userId}`);
  },
});
```

Under `schedules`, `resolve` uses the kind-to-block map to turn a due row back into its block and the user it runs as. `index` is the same index from step 1. The clock fires only an index a flow names here, so a flow with `resolve` and no `index` never fires. The [flows reference](../../reference/flows.md) has both fields. `scheduleDigest` and `cancelDigest` are the actions from step 3.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import { createResourceCollectionScheduleResolver } from "@flow-state-dev/scheduled";
import { z } from "zod";
import { scheduleIndex } from "../../lib/schedule-index";
import { resolveUser } from "../../lib/session";
import { cancelDigest } from "./blocks/cancel-digest";
import { scheduleDigest } from "./blocks/schedule-digest";
import { sendTicketDigest } from "./blocks/send-ticket-digest";
import { schedules } from "./schedules";

const resolveScheduled = createBearerSecretPrincipalResolver({
  secret: process.env.CRON_SECRET!,
  principal: { userId: "system", orgId: "org_support" },
});

const support = defineFlow({
  kind: "support",
  actions: {
    scheduleDigest: { inputSchema: z.object({ cron: z.string() }), block: scheduleDigest },
    cancelDigest: { inputSchema: z.object({}), block: cancelDigest },
  },
  authentication: {
    resolvePrincipal: async (ctx) =>
      ctx.source === "scheduled"
        ? resolveScheduled(ctx)
        : resolveUser(ctx),
    requireUser: true,
  },
  schedules: {
    resolve: createResourceCollectionScheduleResolver({
      collection: schedules,
      blocks: { ticketDigest: sendTicketDigest },
    }),
    index: scheduleIndex,
  },
});

export default support();
```

`authentication` lets the clock in: it accepts calls bearing your `CRON_SECRET` as `system`, as in [Run on a schedule with Vercel Cron](./vercel-cron.md). The handler itself runs as the schedule's owner. `resolveUser` is your own auth, returning a verified `userId` and `orgId` ([Auth and tenancy](../../concepts/auth-and-tenancy.md)).

The clock needs no code of yours. With no `scheduler` option, `createFlowState` runs one in any process that serves the app. Each minute it fires every due schedule of every flow, static and dynamic. Across servers sharing a store, one process ticks and each scheduled time fires once. It does not run under `fsdev run`, so a schedule made in a one-off run fires once a server is up. The route the clock calls is always there, so the app is only its flows and stores:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: sqliteStores({ filename: "data/support.sqlite" }),
});
```

On Vercel nothing stays up between requests, so a Vercel Cron entry calls the route instead. See [Run on a schedule with Vercel Cron](./vercel-cron.md).

## 3. Let a flow add or remove one

A schedule is written with `ctx.resources.schedules`, from any block that declares `resources: { schedules }`.

```ts title="src/flows/support/blocks/schedule-digest.ts"
import { handler } from "@flow-state-dev/core";
import { parseNextFireAt } from "@flow-state-dev/scheduled";
import { z } from "zod";
import { schedules } from "../schedules";

export const scheduleDigest = handler({
  name: "schedule-digest",
  // Check the cron here: a bad one is saved and never fires.
  inputSchema: z.object({
    cron: z
      .string()
      .regex(/^\S+(\s+\S+){4}$/)
      .refine((cron) => parseNextFireAt(cron) !== null, "Not a valid cron"),
  }),
  resources: { schedules },
  execute: async (input, ctx) => {
    // replace: a second call changes the time instead of failing.
    await ctx.resources.schedules.create(
      "ticket-digest",
      { cron: input.cron, kind: "ticketDigest", enabled: true },
      { replace: true },
    );
    return { scheduled: input.cron };
  },
});
```

```ts title="src/flows/support/blocks/cancel-digest.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { schedules } from "../schedules";

export const cancelDigest = handler({
  name: "cancel-digest",
  inputSchema: z.object({}),
  resources: { schedules },
  execute: async (_input, ctx) => {
    await ctx.resources.schedules.delete("ticket-digest");
    return { cancelled: true };
  },
});
```

The key `ticket-digest` is per user. Two agents in one organization each get their own row, with no collision. A fire runs as the agent who made the schedule, in the organization it was made in, so `ctx.user` in `sendTicketDigest` is that agent. Only that user's runs read the row, through `ctx.resources.schedules`, and no client reads it by default. A digest for everyone takes one schedule per user.

Calling `scheduleDigest` again replaces the row and moves the next fire to the new time. `cancelDigest` deletes the row and its place in the index in one call, so the next minute does not fire it. A fire a tick claimed before the cancel goes out anyway. To pause instead, replace the row with `enabled: false`.

## 4. Check a run

Start the app's server with `CRON_SECRET` set, call `scheduleDigest` with `{ "cron": "* * * * *" }` as a user, and wait for the next minute. The handler logs `digest for` and the user's id. Find the run as in [Debug a run](../debug-a-run.md).

## When it stays silent

A schedule that never fires has one of two causes. Either the flow does not name `index` under `schedules`. Or the cron does not parse: the write returns normally, the row gets no index entry, and a warning is logged. Check it with `parseNextFireAt` before writing, as `scheduleDigest` does.

If the server is down when a schedule is due, it fires once when the server returns, for the latest time it missed. Earlier missed times are dropped. A fire that fails is dropped, not retried. A dynamic fire runs in the ticking process and is lost if that process crashes mid-run. For work that must survive that, use a static schedule.

Everything else about the clock is in the [schedules reference](../../reference/schedules.md).
