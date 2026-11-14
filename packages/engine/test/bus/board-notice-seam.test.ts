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
import { NOTICE_MAX_IDS, publishBoardChange } from "@flow-state-dev/core/internal";
import { createInMemoryBus, type ChangeNotice } from "../../src/host";
import { runAction } from "../../src";
import { createInMemoryStores } from "../../src/host";

const inputSchema = z.object({ filer: z.string(), board: z.string(), tasks: z.array(z.string()).default(["t1"]) });

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
            // Every task's change in one turn, as a board settling several rows writes them.
            for (const taskId of input.tasks) {
              published.push(publishBoardChange(ctx, { sessionId: input.filer, board: input.board, taskId }));
            }
            return {};
          }
        })
      }
    }
  })();
}

async function settle(options: { tenantId?: string; filer: string; board: string; tasks?: string[] }) {
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
    input: { filer: options.filer, board: options.board, ...(options.tasks !== undefined ? { tasks: options.tasks } : {}) },
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
        origin: { requestId },
        ids: ["t1"]
      }
    ]);
  });

  // FIX-2625: the notice names the tasks that changed, so a board view
  // answers for those rows; one turn's changes go out as one notice.
  it("names every task one turn changed, in one notice", async () => {
    const { narrowed } = await settle({ filer: "conversation", board: "tasks", tasks: ["t1", "t2", "t1", "t3"] });
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]!.ids).toEqual(["t1", "t2", "t3"]);
  });

  it("names no task past the cap: the notice then means read everything", async () => {
    const tasks = Array.from({ length: NOTICE_MAX_IDS + 1 }, (_, i) => `t${i}`);
    const { narrowed } = await settle({ filer: "conversation", board: "tasks", tasks });
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]!.kind).toBe("board");
    expect(narrowed[0]!.ids).toBeUndefined();
  });

  it("names the tasks up to the cap itself", async () => {
    const tasks = Array.from({ length: NOTICE_MAX_IDS }, (_, i) => `t${i}`);
    const { narrowed } = await settle({ filer: "conversation", board: "tasks", tasks });
    expect(narrowed[0]!.ids).toHaveLength(NOTICE_MAX_IDS);
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
    expect(publishBoardChange({}, { sessionId: "conversation", board: "tasks", taskId: "t1" })).toBe(false);
  });
});
