/**
 * The host the `sessions › it every request names its session` goal drives:
 * one `createFlowState` over a SQLite file, with the webhook and MCP adapters
 * mounted beside the router's own HTTP and scheduled endpoints, and two flows.
 *
 *   desk   An HTTP action, two MCP tools (one with a session directive, one
 *          without), an internal entry, a parking action, and three webhook
 *          bindings (one naming its session, one not, one that parks). Its
 *          callers are named by the `x-user` / `x-org` headers.
 *   clock  Two static schedules, `per-fire` (the default) and `per-schedule`,
 *          fired with a bearer secret as the scheduler.
 *
 * Every run that holds waits on {@link holds} until the goal lets it go, so the
 * goal reads each request record while its run is still going.
 */
import { z } from "zod";
import { defineFlow, defineWebhookBinding, handler, type ScheduleConfig } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createBearerSecretPrincipalResolver,
  createFlowState,
  createWebhookTransportAdapter,
  type FlowState
} from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { silentLogger } from "../../lib/index.mts";

export const ORG = "acme";
export const SCHEDULER = "scheduler";
export const CRON_SECRET = "goal-cron-secret";
export const HOURLY = "0 * * * *";

/** Runs that hold wait here until the goal releases them. */
export const holds = {
  waiting: Promise.resolve() as Promise<void>,
  release: () => {},
  /** Make every later held run wait until `release`. */
  hold(): void {
    this.waiting = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
};

const hold = handler({
  name: "hold",
  inputSchema: z.object({}).passthrough(),
  execute: async () => {
    await holds.waiting;
    return { held: true };
  }
});

const park = handler({
  name: "park",
  inputSchema: z.object({}).passthrough(),
  execute: async (_input, ctx) => {
    const answer = await ctx.suspend!({ reason: "user_approval", message: "Go ahead?" });
    return { answer };
  }
});

const event = (payload: unknown) => payload as { type: string; id: string; conversation?: string };

function deskFlow(): FlowInstance {
  return defineFlow({
    kind: "desk",
    mcp: { enabled: true },
    actions: {
      ask: { inputSchema: z.object({}).passthrough(), block: hold, mcp: { enabled: false } },
      approve: { inputSchema: z.object({}).passthrough(), block: park, mcp: { enabled: false } },
      lookup: { inputSchema: z.object({}).passthrough(), block: hold, description: "Look something up.", mcp: { name: "lookup" } },
      threaded: {
        inputSchema: z.object({ conversation: z.string() }).passthrough(),
        block: hold,
        description: "Look something up in a conversation.",
        mcp: { name: "threaded", session: { fromInput: "conversation" } }
      }
    },
    internal: { actions: { sweep: { inputSchema: z.object({}).passthrough(), block: hold } } },
    webhooks: {
      acme: {
        on: {
          named: defineWebhookBinding({ block: hold, input: () => ({}), sessionId: (e) => event(e.payload).conversation }),
          bare: defineWebhookBinding({ block: hold, input: () => ({}) }),
          parks: defineWebhookBinding({ block: park, input: () => ({}) })
        }
      }
    }
  })({ id: "desk" }) as unknown as FlowInstance;
}

function clockFlow(): FlowInstance {
  const schedule = (extra: Partial<ScheduleConfig>): ScheduleConfig => ({ cron: HOURLY, block: hold, onOverlap: "allow", ...extra });
  return defineFlow({
    kind: "clock",
    authentication: {
      resolvePrincipal: createBearerSecretPrincipalResolver({ secret: CRON_SECRET, principal: { userId: SCHEDULER, orgId: ORG } }),
      requireUser: true
    },
    schedules: { static: { fire: schedule({}), poll: schedule({ session: "per-schedule" }) } },
    actions: {}
  })({ id: "clock" }) as unknown as FlowInstance;
}

/** The host over the SQLite file at `filename`. */
export function goalApp(filename: string): FlowState {
  return createFlowState({
    flows: [deskFlow(), clockFlow()],
    stores: sqliteStores({ filename }),
    adapters: [
      createWebhookTransportAdapter({
        providers: {
          acme: {
            verify: () => true,
            eventType: (payload) => event(payload).type,
            deliveryId: (payload) => event(payload).id
          }
        }
      }),
      createMcpTransportAdapter()
    ],
    // The caller is whoever the headers name; a delivery with none is the system.
    resolvePrincipal: async ({ request }) => ({
      userId: request?.headers.get("x-user") ?? "system",
      orgId: request?.headers.get("x-org") ?? ORG
    }),
    staleSweepIntervalMs: 0,
    logger: silentLogger
  } as Parameters<typeof createFlowState>[0]);
}
