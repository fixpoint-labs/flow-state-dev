/**
 * The board-notice seam (FIX-2429): a task board's change reaches the bus of
 * the run that made it, on the filing session's topic, narrowed to the board.
 *
 * Orchestration names the session and the board; the engine fills the tenant
 * from the running request, stamps the request as `origin`, and publishes on
 * that run's `stores.bus`. A view of another tenant or another board hears
 * nothing.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { publishBoardChange } from "@flow-state-dev/core/internal";
import { createInMemoryBus, type ChangeNotice } from "../../src/host";
import { createInMemoryStores, runAction } from "../../src";

const inputSchema = z.object({ filer: z.string(), board: z.string() });

function boardFlow(published: boolean[]) {
  return defineFlow({
    kind: "board-notices",
    actions: {
      settle: {
        inputSchema,
        block: handler({
          name: "settle",
          inputSchema,
          outputSchema: z.object({}),
          execute: (input, ctx) => {
            published.push(publishBoardChange(ctx, { sessionId: input.filer, board: input.board }));
            return {};
          }
        })
      }
    }
  })();
}

async function settle(options: { tenantId?: string; filer: string; board: string }) {
  const bus = createInMemoryBus();
  const tenantId = options.tenantId ?? "";
  const narrowed: ChangeNotice[] = [];
  bus.subscribe({ scope: "session", id: "conversation", tenantId, resource: "tasks" }, (n) => narrowed.push(n));
  const whole: ChangeNotice[] = [];
  bus.subscribe({ scope: "session", id: "conversation", tenantId }, (n) => whole.push(n));
  const otherTenant: ChangeNotice[] = [];
  bus.subscribe({ scope: "session", id: "conversation", tenantId: "other" }, (n) => otherTenant.push(n));
  const published: boolean[] = [];
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: boardFlow(published),
    actionName: "settle",
    input: { filer: options.filer, board: options.board },
    userId: "alice",
    sessionId: "task-session",
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    stores: { ...createInMemoryStores(), bus },
    runtimeConfig: {}
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { narrowed, whole, otherTenant, published, requestId: result.requestId };
}

describe("publishBoardChange · the engine's seam", () => {
  it("publishes a board notice on the filer's session, narrowed to the board, with the request as origin", async () => {
    const { narrowed, published, requestId } = await settle({ filer: "conversation", board: "tasks" });
    expect(published).toEqual([true]);
    expect(narrowed).toEqual([
      {
        topic: { scope: "session", id: "conversation", tenantId: "", resource: "tasks" },
        kind: "board",
        origin: { requestId }
      }
    ]);
  });

  it("fills the tenant from the running request, so another tenant's view never hears it", async () => {
    const { narrowed, otherTenant } = await settle({ tenantId: "acme", filer: "conversation", board: "tasks" });
    expect(narrowed.map((n) => n.topic.tenantId)).toEqual(["acme"]);
    expect(otherTenant).toEqual([]);
  });

  it("reaches only that board's narrowed view", async () => {
    const { narrowed, whole } = await settle({ filer: "conversation", board: "plan" });
    expect(narrowed).toEqual([]);
    expect(whole.filter((n) => n.kind === "board").map((n) => n.topic.resource)).toEqual(["plan"]);
  });

  it("publishes nothing from a context with no seam", () => {
    expect(publishBoardChange({}, { sessionId: "conversation", board: "tasks" })).toBe(false);
  });
});
