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
import { DEFAULT_ORG_ID, defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { NOTICE_MAX_IDS, publishBoardChange, publishBoardInsert } from "@flow-state-dev/core/internal";
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

// FIX-2625: Codex's P2 and Cursor's security review on #5232. A row filed from
// a session no open view named reaches every view of the board through an
// insert notice on the board's own scope topic, never on a filer's session.
describe("publishBoardInsert · a new row, on the board's scope topic", () => {
  const ledgerSchema = z.object({}).passthrough();
  const ledgers = {
    sessionDesk: defineResourceCollection({ scope: "session", pattern: "s-desk/**", stateSchema: ledgerSchema }),
    userDesk: defineResourceCollection({ scope: "user", pattern: "u-desk/**", stateSchema: ledgerSchema }),
    orgDesk: defineResourceCollection({ scope: "org", pattern: "o-desk/**", stateSchema: ledgerSchema })
  };
  const insertInput = z.object({ ledger: z.enum(["sessionDesk", "userDesk", "orgDesk", "none"]) });

  async function insert(ledger: z.infer<typeof insertInput>["ledger"]) {
    const bus = createInMemoryBus();
    const heard: ChangeNotice[] = [];
    bus.subscribe({ scope: "session", id: "task-session", tenantId: "" }, (n) => heard.push(n));
    bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (n) => heard.push(n));
    bus.subscribe({ scope: "org", id: DEFAULT_ORG_ID, tenantId: "" }, (n) => heard.push(n));
    const published: boolean[] = [];
    const flow = defineFlow({
      kind: "board-inserts",
      resources: ledgers,
      actions: {
        file: {
          inputSchema: insertInput,
          block: handler({
            name: "file",
            inputSchema: insertInput,
            outputSchema: z.object({}),
            resources: ledgers,
            execute: (input, ctx) => {
              // A handle the context never handed out names no board: nothing goes out.
              const which: z.infer<typeof insertInput>["ledger"] = input.ledger;
              const handle = which === "none" ? {} : ctx.resources[which];
              published.push(publishBoardInsert(ctx, { board: "desk", taskId: "t1", ledger: handle }));
              return {};
            }
          })
        }
      }
    })();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "file",
      input: { ledger },
      userId: "alice",
      sessionId: "task-session",
      stores: { ...createInMemoryStores(), bus },
      runtimeConfig: {}
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { boards: heard.filter((n) => n.kind === "board"), published, requestId: result.requestId };
  }

  it("an org ledger's goes on the org topic, narrowed to the board, naming the task every member lists", async () => {
    const { boards, published, requestId } = await insert("orgDesk");
    expect(published).toEqual([true]);
    expect(boards).toEqual([
      { topic: { scope: "org", id: DEFAULT_ORG_ID, tenantId: "", resource: "desk" }, kind: "board", origin: { requestId }, ids: ["t1"] }
    ]);
  });

  it("a user ledger's goes on the user topic naming no task: the user topic spans the user's orgs", async () => {
    const { boards, requestId } = await insert("userDesk");
    expect(boards).toEqual([{ topic: { scope: "user", id: "alice", tenantId: "", resource: "desk" }, kind: "board", origin: { requestId } }]);
  });

  it("a session ledger's goes on the running session's topic, naming the task", async () => {
    const { boards, requestId } = await insert("sessionDesk");
    expect(boards).toEqual([
      { topic: { scope: "session", id: "task-session", tenantId: "", resource: "desk" }, kind: "board", origin: { requestId }, ids: ["t1"] }
    ]);
  });

  it("publishes nothing for a ledger the context didn't hand out", async () => {
    const { boards } = await insert("none");
    expect(boards).toEqual([]);
  });

  it("publishes nothing from a context with no seam", () => {
    expect(publishBoardInsert({}, { board: "desk", taskId: "t1", ledger: {} })).toBe(false);
  });
});

// FIX-2750: a row added to a partitioned ledger names its partition, raw on
// the bus; the push edge keys it. Rows added in one turn fold to one notice,
// which names a partition only when every row was added to it.
describe("publishBoardInsert · a partitioned ledger's row", () => {
  const userDesk = defineResourceCollection({ scope: "user", pattern: "u-desk/**", stateSchema: z.object({}).passthrough() });
  const fileInput = z.object({ partitions: z.array(z.string()) });

  async function file(partitions: string[]) {
    const bus = createInMemoryBus();
    const heard: ChangeNotice[] = [];
    bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (n) => heard.push(n));
    const flow = defineFlow({
      kind: "board-partitions",
      resources: { userDesk },
      actions: {
        file: {
          inputSchema: fileInput,
          block: handler({
            name: "file",
            inputSchema: fileInput,
            outputSchema: z.object({}),
            resources: { userDesk },
            execute: (input, ctx) => {
              input.partitions.forEach((partition: string, i: number) =>
                publishBoardInsert(ctx, { board: "desk", taskId: `t${i}`, ledger: ctx.resources.userDesk, partition })
              );
              return {};
            }
          })
        }
      }
    })();
    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "file",
      input: { partitions },
      userId: "alice",
      sessionId: "task-session",
      stores: { ...createInMemoryStores(), bus },
      runtimeConfig: {}
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return heard.filter((n) => n.kind === "board");
  }

  it("names the partition its row was added to", async () => {
    expect((await file(["conv-a"])).map((n) => n.partition)).toEqual(["conv-a"]);
  });

  it("keeps the partition when every row folded into the notice was added to it", async () => {
    expect((await file(["conv-a", "conv-a"])).map((n) => n.partition)).toEqual(["conv-a"]);
  });

  it("names none when the rows folded into the notice were added to two partitions, so every board reads", async () => {
    const notices = await file(["conv-a", "conv-b"]);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.partition).toBeUndefined();
  });
});
