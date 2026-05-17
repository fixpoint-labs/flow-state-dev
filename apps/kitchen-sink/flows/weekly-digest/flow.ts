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
 * Creates a per-user dynamic schedule in the schedules collection. The
 * `defineScheduleCollection` hook mirrors it into the `ScheduleIndex`,
 * which the polling tick (`/api/cron/schedule-tick`) then fans out.
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
    const key = `digest-${Date.now()}`;
    await schedules.create(key, {
      cron: input.cron,
      action: input.action,
      enabled: true,
    });
    return { key };
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
  },
});

const flow = weeklyDigestFlow({ id: "default" });

export default flow;
