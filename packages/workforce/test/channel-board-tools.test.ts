/**
 * The model's door onto a channel board, and the two fences around it.
 *
 * The door is the **kind-installed capability**: a seat composes
 * `channelBoardTaskTools(board)` and holds the eight task tools over that
 * ledger. It cannot be a block in the seat's own `blocks/` folder, because a
 * channel board is an org-scoped resource and a seat-folder block declaring one
 * is refused by name at hire — which is what makes the capability the only
 * door rather than the recommended one.
 *
 * The sharpest case here is the freeze: a seat's board that hands off freezes
 * the ledger's assignee, and a write through the SAME id — the channel's side
 * of the fence — must then decline. Two `defineTaskCollection` calls sharing an
 * id would share rows and not that policy, so the negative control below uses a
 * board nobody froze and watches the same write succeed.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import {
  AGENT_KIND,
  channelBoard,
  channelBoardTaskTools,
  channelInstances,
  defineAgentWorkerFlow,
  hireWorkforce,
  openChannels,
  resolveChannelBoard,
  workerConfigSchema,
  type ChannelManifest
} from "../src/index";

const USER_ID = "u_tools";
const ORG_ID = "org_tools";

function record(id: string, boards: string[]): ChannelManifest {
  return { id, declared: { members: ["eng.em", "eng.coder"], boards }, body: "Charter." };
}

function sessionApi(stores: any) {
  return {
    createSession: async (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      orgId?: string;
      state?: Record<string, unknown>;
    }): Promise<unknown> => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          orgId: options.orgId,
          state: options.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: []
        },
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = await stores.session.get(sessionId);
      return {
        flowKind: String(found?.flowKind),
        flowId: found?.flowId,
        userId: String(found?.userId),
        orgId: found?.orgId,
        state: found?.state
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    }
  };
}

/**
 * One channel holding one board, and one seat whose model reaches the same
 * ledger through the capability.
 *
 * The seat's record declares `tools: []` — written out rather than omitted,
 * because that is the line an author reads as "this seat reaches nothing", and
 * a capability's controls are exempt from it by contract.
 */
async function lab(script: Array<Record<string, unknown>>) {
  const roster = [record("eng.feature", ["work"])];
  const [channel] = channelInstances(roster);
  const work = channelBoard("eng.feature", "work");

  const [seat] = hireWorkforce(
    [{ id: "eng.coder", declared: { flow: AGENT_KIND, tools: [] }, body: "Coder." }],
    { kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [channelBoardTaskTools(work)] }) } }
  );

  const state = createFlowState({
    flows: { [channel!.kind]: channel!, [seat!.id]: seat! },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": mockGenerator({ name: "agent-answer", script } as never) }
    })
  } as never);
  const runtime = await state.getRuntime();
  await openChannels(roster, {
    client: sessionApi(runtime.stores),
    userId: USER_ID,
    orgId: ORG_ID
  });

  const act = async (flow: unknown, sessionId: string, actionName: string, input: unknown) => {
    try {
      return (await runAction({
        flow,
        actionName,
        input,
        userId: USER_ID,
        orgId: ORG_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { output?: unknown; error?: unknown };
    } catch (error) {
      return { error };
    }
  };

  return {
    work,
    channel: (actionName: string, input: unknown) =>
      act(channel!, "eng.feature", actionName, input),
    seat: (message: string) => act(seat!, "s_eng_coder", "run", { message }),
    row: (taskId: string) =>
      runtime.stores.resourceState
        .get("org", ORG_ID, `eng.feature.work/${taskId}`)
        .then((found: { state?: unknown } | undefined) => found?.state as Record<string, unknown>),
    dispose: () => state.dispose()
  };
}

describe("one ledger, two doors", () => {
  it("settles through the model's tools the row the channel's own action wrote", async () => {
    const run = await lab([
      {
        toolCalls: [
          { toolCallId: "c1", toolName: "cancelTask", args: { taskId: "r1", reason: "not needed" } }
        ]
      },
      { text: "settled" }
    ]);
    try {
      const filed = await run.channel("fileTask", {
        board: "work",
        goal: "ship the reader",
        id: "r1",
        author: "eng.em"
      });
      expect(filed.error).toBeUndefined();
      expect((await run.row("r1"))!.status).toBe("pending");

      const answered = await run.seat("settle r1");
      expect(answered.error).toBeUndefined();

      // The same row, reached from the other side of the fence. A second
      // `TaskCollectionRef` over a second declaration would have written to a
      // different place and left this one pending.
      expect((await run.row("r1"))!.status).toBe("cancelled");
    } finally {
      await run.dispose();
    }
  });

  it("shows on the channel's board read a row the model filed, carrying no author", async () => {
    const run = await lab([
      { toolCalls: [{ toolCallId: "c1", toolName: "addTask", args: { goal: "from the model" } }] },
      { text: "filed" }
    ]);
    try {
      const answered = await run.seat("file some work");
      expect(answered.error).toBeUndefined();

      const read = await run.channel("readBoard", { board: "work" });
      const tasks = (read.output as { tasks: Array<{ goal: string; metadata?: unknown }> }).tasks;
      expect(tasks.map((task) => task.goal)).toEqual(["from the model"]);

      // `addTask` carries no author at ALL, so no roster check runs on this
      // path. Filing is not members-only, and pinning it here is what stops
      // that gap being rediscovered as a bug later.
      expect(tasks[0]!.metadata).toBeUndefined();
    } finally {
      await run.dispose();
    }
  });
});

describe("the seat's `tools:` fence", () => {
  it("leaves the board's eight controls in place on a seat declaring `tools: []`", async () => {
    // Both cases above already ran on a seat whose record says `tools: []`.
    // This one states the claim directly, on the hired seat, so a reader does
    // not have to infer it from a passing tool call.
    const [seat] = hireWorkforce(
      [{ id: "eng.fenced", declared: { flow: AGENT_KIND, tools: [] }, body: "Fenced." }],
      {
        kinds: {
          [AGENT_KIND]: defineAgentWorkerFlow({
            uses: [channelBoardTaskTools(channelBoard("eng.fenced-channel", "work"))]
          })
        }
      }
    );

    // The ledger reached the flow through the capability alone — nothing
    // declared it beside the `uses` entry.
    expect(Object.keys(seat!.resources ?? {})).toContain("eng.fenced-channel.work");
    expect(seat!.config.tools).toEqual([]);
  });
});

/**
 * The freeze, which is the whole reason one declaration object per id exists.
 */
describe("a handed-off board's assignee freeze", () => {
  /** A flow that resolves a channel board and tries to reassign one row. */
  function reassignerFor(channelId: string, boardName: string, withHandOff: boolean) {
    const board = channelBoard(channelId, boardName);
    const reassign = handler({
      name: `reassign-${boardName}-${withHandOff ? "frozen" : "free"}`,
      inputSchema: z.object({ taskId: z.string(), assignee: z.string() }),
      outputSchema: z.object({ outcome: z.string(), reason: z.string().optional() }),
      execute: async (input: { taskId: string; assignee: string }, ctx) => {
        const ledger = await resolveChannelBoard(ctx, board.id);
        const written = (await ledger!.setAssignee(input.taskId, input.assignee)) as {
          outcome: string;
          reason?: string;
        };
        return {
          outcome: written.outcome,
          ...(written.reason === undefined ? {} : { reason: written.reason })
        };
      }
    });
    const seed = handler({
      name: `seed-${boardName}-${withHandOff ? "frozen" : "free"}`,
      inputSchema: z.object({}),
      outputSchema: z.object({ taskId: z.string() }),
      execute: async (_input, ctx) => {
        const ledger = await resolveChannelBoard(ctx, board.id);
        const task = await ledger!.addTask({ id: "row", goal: "a row", assignee: "coder" });
        return { taskId: task.id };
      }
    });

    // Declaring dispatcher seats is what freezes the ledger: the child
    // session a handed-off row runs in is keyed off the assignee, so changing
    // it afterwards redirects nothing.
    const drain = withHandOff
      ? taskBoard({
          name: `${boardName}-board`,
          boardId: `${boardName}-board`,
          collection: board,
          workers: {
            coder: dispatcher<TaskWorkerInput>({
              name: `${boardName}-hand-off`,
              flowKind: "somewhere-else",
              action: "work",
              session: "per-task"
            })
          }
        })
      : undefined;

    return defineFlow({
      kind: `reassigner-${boardName}`,
      cardinality: "singleton",
      configSchema: workerConfigSchema(),
      resources: { [board.id]: board },
      actions: {
        seed: { block: seed },
        reassign: { block: reassign },
        ...(drain === undefined ? {} : { drain: { block: drain.drain } })
      }
    } as never);
  }

  async function reassignOn(channelId: string, boardName: string, withHandOff: boolean) {
    const flow = (reassignerFor(channelId, boardName, withHandOff) as unknown as () => unknown)();
    const state = createFlowState({
      flows: { [(flow as { kind: string }).kind]: flow },
      stores: { default: { primary: inMemoryStores() } }
    } as never);
    try {
      const runtime = await state.getRuntime();
      const call = (actionName: string, input: unknown) =>
        runAction({
          flow,
          actionName,
          input,
          userId: USER_ID,
          orgId: ORG_ID,
          sessionId: `s_${boardName}`,
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        } as never) as Promise<{ output?: unknown; error?: unknown }>;

      await call("seed", {});
      const written = await call("reassign", { taskId: "row", assignee: "reviewer" });
      const out = written.output as { outcome?: string; reason?: string } | undefined;
      return out?.outcome === undefined
        ? `error: ${String(written.error)}`
        : `${out.outcome}${out.reason === undefined ? "" : `:${out.reason}`}`;
    } finally {
      await state.dispose();
    }
  }

  it("declines a reassignment made through the channel's own id", async () => {
    // `declined:immutable-assignee` — the reason matters, because a decline
    // for any other reason would pass a bare `declined` assertion.
    expect(await reassignOn("eng.frozen", "frozen", true)).toBe(
      "declined:immutable-assignee"
    );
  });

  // The negative control. Same code path, same helper, a board nobody handed
  // off — so a `declined` above is the freeze crossing the fence rather than
  // this write being refused for some other reason.
  it("records the same reassignment on a board nobody handed off", async () => {
    expect(await reassignOn("eng.free", "free", false)).toBe("recorded");
  });
});

describe("a channel-board tool colocated in a seat's own folder", () => {
  it("is refused by name at hire, because the board is an org-scoped resource", () => {
    const work = channelBoard("eng.colocated", "work");
    const colocated = handler({
      name: "file-work",
      description: "Files a row.",
      uses: [defineCapability({ name: "colocated-board", resources: { [work.id]: work } })],
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true })
    }) as BlockDefinition;

    // The premise the refusal rests on, asserted so this cannot pass for the
    // wrong reason: the block really does declare the ledger.
    expect(colocated.declaredResources?.["eng.colocated.work"]).toBe(work);

    let message = "";
    try {
      hireWorkforce([{ id: "eng.colo", declared: { flow: AGENT_KIND }, body: "Colo." }], {
        kinds: { [AGENT_KIND]: defineAgentWorkerFlow() },
        seatBlocks: { "eng.colo": { "file-work": colocated } }
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('worker "eng.colo"');
    expect(message).toContain("file-work");
    expect(message).toContain("eng.colocated.work");
  });
});
