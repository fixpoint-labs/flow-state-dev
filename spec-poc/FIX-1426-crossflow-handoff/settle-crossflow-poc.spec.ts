/**
 * THROWAWAY — settle-claim POC. Not part of the suite; delete after reading.
 *
 * Claim under test: a taskBoard worker can hand a claimed row off ACROSS
 * FLOWS — to a task entry on a *different* flow instance, addressed by a
 * dispatcher carrying `flowKind: "<instance id>"` — and the `harnessManager`
 * block mounted at that entry still builds and runs.
 *
 * Model-free: the harness slot is a scripted stub (`scriptedAgent`), never a
 * real coding agent, no network, no API key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { harnessManager, harnessTaskInputSchema } from "@flow-state-dev/harness-manager";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import { implementPhase } from "../src/implement";
import { scriptedAgent, sdkResult, seedRepo, USER_ID } from "./harness";

const TASK_ID = harnessTaskId("FIX-poc", "implement");

const BOARD_ID = "crossflow-poc-board";
const LEDGER_ID = "crossflow-poc-tasks";
const SEAT_KIND = "seat-1-poc"; // stands in for a hireWorkforce seat instance id
const SENDER_KIND = "coordinator-poc";
const ACTION = "run";
const ASSIGNEE = "harness";

function neverResolvesAModel(): never {
  throw new Error("this flow declares no generator actions; it never resolves a model.");
}

function ledger() {
  return defineTaskCollection({ id: LEDGER_ID, scope: "user", stateSchema: harnessTaskInputSchema });
}

/** The "Workforce seat" stand-in: its own board (same boardId/ledger as the
 * sender) gating a REAL harnessManager task entry — the shape
 * hand-off-cross-flow.test.ts documents as the only legitimate recipient. */
function buildSeatFlow(workspaceRoot: string, sourceRepo: string) {
  const tasks = ledger();
  const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
  const manager = harnessManager({
    boardCollectionId: LEDGER_ID,
    boardCollection: tasks,
    phase: implementPhase({ prExists: () => true }),
    workspace: { root: workspaceRoot, sourceRepo, baseRef: "main" },
    runTimeoutMs: 30_000,
    harness: ({ cwd, resume, onSession }) =>
      claudeCodeAgent({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
        cwd,
        resume,
        onSession,
        detached: true,
        recordWork: true,
        includePartialMessages: false,
      }),
  });

  const board = taskBoard({
    name: `${SEAT_KIND}-board`,
    boardId: BOARD_ID,
    collection: tasks,
    workers: {
      // Same-flow dispatcher: satisfies defineFlow's orphan-task-entry guard
      // ("no task board reachable from the flow hands off to it") and is what
      // binds this board's claim gate onto the `run` entry below.
      [ACTION]: dispatcher({ name: `${SEAT_KIND}-hand-off`, action: ACTION, session: "per-task" }),
    },
  });

  const flow = defineFlow({
    kind: SEAT_KIND,
    task: { actions: { [ACTION]: { block: manager } } },
    actions: { drain: { block: board.drain } },
  })({ id: SEAT_KIND });

  return { flow, seen };
}

/** The coordinator's board: one seat, handed off cross-flow via `flowKind`. */
function buildSenderFlow(flowKindToAddress: string) {
  const tasks = ledger();
  const board = taskBoard({
    name: `${SENDER_KIND}-board`,
    boardId: BOARD_ID,
    collection: tasks,
    workers: {
      [ASSIGNEE]: dispatcher({
        name: `${SENDER_KIND}-hand-off`,
        flowKind: flowKindToAddress,
        action: ACTION,
        session: "per-task",
      }),
    },
    initialTasks: [
      {
        id: TASK_ID,
        goal: "prove cross-flow hand-off reaches a real harnessManager",
        assignee: ASSIGNEE,
        input: { issue: "FIX-poc", phase: "implement" },
      },
    ],
  });

  return defineFlow({
    kind: SENDER_KIND,
    actions: { start: { block: board.drain } },
  })({ id: SENDER_KIND });
}

async function durableRow(stores: StoreRegistry, taskId: string): Promise<Task | undefined> {
  const row = await stores.resourceState.get("user", USER_ID, `${LEDGER_ID}/${taskId}`);
  return row?.state as Task | undefined;
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const dirs: string[] = [];
function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "crossflow-poc-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  const workspaceRoot = join(dir, "checkouts");
  execFileSync("mkdir", ["-p", sourceRepo]);
  seedRepo(sourceRepo);
  return { workspaceRoot, sourceRepo };
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("SETTLE-CLAIM: taskBoard cross-flow hand-off to a real harnessManager entry", () => {
  it("GREEN — reaches the seat's harnessManager entry and settles the originating row", async () => {
    const { workspaceRoot, sourceRepo } = tempWorkspace();
    const { flow: seatFlow, seen } = buildSeatFlow(workspaceRoot, sourceRepo);
    const senderFlowDef = buildSenderFlow(SEAT_KIND);

    const state = createFlowState({
      flows: { [SENDER_KIND]: senderFlowDef, [SEAT_KIND]: seatFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: Object.assign(neverResolvesAModel, {
        resolveId: neverResolvesAModel,
      }) as unknown as ModelResolver,
      dispatchDrainTimeoutMs: 60_000,
    } as never);

    try {
      const runtime: FlowStateRuntime = await state.getRuntime();
      const parent = await runAction({
        flow: senderFlowDef,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "s_sender_green",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });

      expect(parent.error).toBeUndefined();

      await until(async () => {
        const row = await durableRow(runtime.stores, TASK_ID);
        return row?.status === "completed" || row?.status === "errored";
      }, "the seat's harnessManager to settle the originating row");

      const settled = await durableRow(runtime.stores, TASK_ID);
      console.log("VERDICT-GREEN row.status =", settled?.status, "error =", (settled as any)?.error);
      console.log("VERDICT-GREEN scripted harness saw prompts:", seen.prompts.length, "cwds:", seen.cwds);

      expect(settled?.status).toBe("completed");
      expect(seen.prompts.length).toBeGreaterThan(0);

      const children = await runtime.stores.session.list({
        userId: USER_ID,
        parentage: { parentOf: "s_sender_green" },
      });
      expect(children).toHaveLength(1);
      expect(children[0]?.flowKind).toBe(SEAT_KIND);
      console.log("VERDICT-GREEN child session flowKind =", children[0]?.flowKind);
    } finally {
      await state.dispose();
    }
  });

  it("RED — flowKind naming a seat instance that does not exist is refused, not silently accepted", async () => {
    const senderFlowDef = buildSenderFlow("no-such-seat-instance");

    const state = createFlowState({
      flows: { [SENDER_KIND]: senderFlowDef },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: Object.assign(neverResolvesAModel, {
        resolveId: neverResolvesAModel,
      }) as unknown as ModelResolver,
      dispatchDrainTimeoutMs: 60_000,
    } as never);

    try {
      const runtime: FlowStateRuntime = await state.getRuntime();
      const parent = await runAction({
        flow: senderFlowDef,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "s_sender_red",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });

      expect(parent.error).toBeUndefined();

      await until(async () => {
        const row = await durableRow(runtime.stores, TASK_ID);
        return row?.status === "errored";
      }, "the row to fail against the unregistered flow");

      const failed = await durableRow(runtime.stores, TASK_ID);
      console.log("VERDICT-RED row.status =", failed?.status, "error =", (failed as any)?.error);
      expect(failed?.status).toBe("errored");
      expect((failed as any)?.error ?? "").toMatch(/flow-not-found|no-such-seat-instance/);
    } finally {
      await state.dispose();
    }
  });
});
