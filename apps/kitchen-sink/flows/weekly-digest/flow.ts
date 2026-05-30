/**
 * weekly-digest flow
 *
 * Reference wiring for `@flow-state-dev/scheduled` + `ScheduleIndex` in
 * the kitchen-sink app. One static schedule (Monday 09:00) and one
 * resolver-backed dynamic schedule path so a user-invokable
 * `scheduleDigest` action can write per-user rows that the polling tick
 * picks up.
 *
 * Auth: the scheduled-dispatch endpoint authenticates via `CRON_SECRET`.
 * HTTP traffic (DevTool, API clients) falls through to the framework's
 * body-userId resolver — same model as the chat-agent flow.
 */
import {
  defineFlow,
  handler,
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core";
import {
  createResourceCollectionScheduleResolver,
  defineScheduleCollection,
} from "@flow-state-dev/scheduled";
import {
  createBearerSecretPrincipalResolver,
  defaultBodyUserIdPrincipalResolver,
} from "@flow-state-dev/server";
import { z } from "zod";
import { scheduleIndex } from "@/lib/schedule-index";

const schedulesCollection = defineScheduleCollection({
  pattern: "schedules/*",
  index: scheduleIndex,
});

const sendWeeklySummary = handler({
  name: "send-weekly-summary",
  inputSchema: z.object({}).passthrough(),
  execute: async (_input, ctx) => {
    const userId = ctx.user?.identity.userId ?? "<none>";
    // eslint-disable-next-line no-console
    console.log(`[weekly-digest] sendWeeklySummary fired for user=${userId}`);
  },
});

const scheduleDigestInputSchema = z.object({
  cron: z.string().min(1),
  action: z.string().min(1).default("sendWeeklySummary"),
});

/**
 * Idempotently install the per-user digest schedule. Subsequent calls
 * with a different cron/action update the same row, so a user can only
 * have one active digest at a time. The `defineScheduleCollection` hook
 * mirrors create/update into the `ScheduleIndex`, which the polling
 * tick (`/api/cron/schedule-tick`) fans out.
 */
const scheduleDigest = handler({
  name: "schedule-digest",
  inputSchema: scheduleDigestInputSchema,
  execute: async (input, ctx) => {
    if (!ctx.user) {
      throw new Error("scheduleDigest requires a user scope");
    }
    // Cast through `ctx.resources`'s loose typing — the collection
    // branding doesn't carry into the flat registry lookup.
    const schedules = ctx.resources.schedules as unknown as ResourceCollectionRef<{
      cron: string;
      action: string;
      enabled: boolean;
    }>;
    const key = "digest";
    const nextState = { cron: input.cron, action: input.action, enabled: true };
    const existing = await schedules.getOptional(key);
    if (existing !== undefined) {
      await existing.setState(nextState);
    } else {
      await schedules.create(key, nextState);
    }
    return { key };
  },
});

/**
 * Delete every schedule the calling user owns. The
 * `defineScheduleCollection` delete hook removes each row from the
 * `ScheduleIndex`, so the polling tick stops firing them on the next
 * beat. Returns the count of removed schedules.
 */
const clearSchedules = handler({
  name: "clear-schedules",
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.object({ cleared: z.number() }),
  execute: async (_input, ctx) => {
    if (!ctx.user) {
      throw new Error("clearSchedules requires a user scope");
    }
    const schedules = ctx.resources.schedules as unknown as ResourceCollectionRef<{
      cron: string;
      action: string;
      enabled: boolean;
    }>;
    const prefix = "schedules/";
    const refs = await schedules.list();
    await Promise.all(
      refs.map((ref) =>
        schedules.delete(
          ref.path.startsWith(prefix) ? ref.path.slice(prefix.length) : ref.path,
        ),
      ),
    );
    return { cleared: refs.length };
  },
});

const weeklyDigestFlow = defineFlow({
  kind: "weekly-digest",
  requireUser: true,

  authentication: {
    resolvePrincipal: async (ctx) => {
      if (ctx.source === "scheduled") {
        const resolver = createBearerSecretPrincipalResolver({
          secret: process.env.CRON_SECRET ?? "",
          principal: { userId: "system" },
        });
        return resolver(ctx);
      }
      return defaultBodyUserIdPrincipalResolver(ctx);
    },
    requireUser: true,
  },

  resources: { schedules: schedulesCollection },

  schedules: {
    static: {
      "monday-summary": {
        cron: "0 9 * * 1",
        action: "sendWeeklySummary",
        description: "Weekly digest, Mondays 09:00 UTC",
      },
    },
    resolve: createResourceCollectionScheduleResolver({
      collection: schedulesCollection,
    }),
  },

  actions: {
    sendWeeklySummary: {
      block: sendWeeklySummary,
    },
    scheduleDigest: {
      block: scheduleDigest,
    },
    clearSchedules: {
      block: clearSchedules,
    },
  },
});

const flow = weeklyDigestFlow({ id: "default" });

export default flow;
