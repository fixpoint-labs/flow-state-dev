/**
 * A worker flow's roles, checked at hire.
 *
 * A worker flow declares what it does beside taking a user's message on
 * `respond`: `contributor` (takes tasks on `work`), `manager` (runs its
 * delegation board on `dispatch` and hears its tasks end on `onTaskSettled`),
 * and `coordinator` (a manager's entries plus its routing ones). The hire
 * refuses a declared role whose entries are missing, are not the role's
 * factory's, or refuse the input their caller sends; and a piece of a role's
 * factory on a flow that doesn't declare the role. Every refusal names the
 * flow, the role, the entry and the fix, before any worker runs, because
 * found mid-task the same fault strands a task whose ending never arrives.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { taskSettledInputSchema } from "@flow-state-dev/orchestration";
import { taskLedgers } from "@flow-state-dev/orchestration/task-board";
import { taskDispatchInputSchema } from "@flow-state-dev/core/types";
import { workerConfigSchema } from "../src/worker-config";
import { workerFlowProblems } from "../src/worker-flow-contract";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import { defineSessionBoard } from "../src/conversation-board/session-board";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { hireWorkforce } from "../src/workers/register";
import { checkWorkerFlows } from "../src/hire";
import { workerFlow } from "../src/workers/worker-flow";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { ROLE_PROBES } from "../src/worker-roles";
import { routeOnSchema } from "../src/coordinator/coordinator-rounds";
import { workstreamDelegateChangeSchema } from "../src/projects/project-coordinator";

import { hearsMessages } from "./conversation-board-harness";
import { workerMessagesResources } from "../src/messages/message-log";

const message = z.object({ message: z.string() });
const turn = handler({ name: "roles-turn", inputSchema: message, outputSchema: z.object({}), execute: () => ({}) });
const respond = { inputSchema: message, block: turn, userMessage: (i: { message: string }) => i.message };

/** A worker flow on `installation`: the door, plus whatever `over` adds. */
function flowOn(installation: WorkerInstallation | undefined, flowName: string, over: Record<string, unknown> = {}) {
  return defineFlow({
    kind: flowName,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    ...(installation === undefined
      ? {}
      : {
          session: installation.session(),
          resources: { ...installation.resources, ...workerMessagesResources },
          internal: { actions: hearsMessages(installation, flowName) }
        }),
    actions: { respond },
    ...over
  } as never) as never;
}

/** A flow carrying the manager kit, built with the kit's own session and resources. */
function managerFlow(installation: WorkerInstallation, flowName: string, pick: (entries: Record<string, unknown>) => Record<string, unknown>, actions = true) {
  const board = defineSessionBoard({ installation, flowKind: flowName });
  return defineFlow({
    kind: flowName,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: { respond, ...(actions ? board.actions : {}) },
    internal: { actions: pick(board.entries(turn)) }
  } as never) as never;
}

const workEntry = () => workerTaskEntry({ name: "roles-work", turn });

describe("a declared role missing its entry", () => {
  it("refuses a contributor with no `work`, naming the role, the entry and `workerTaskEntry`", () => {
    const problems = workerFlowProblems("taker", flowOn(undefined, "taker"), ["contributor"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('worker flow "taker"');
    expect(problems[0]).toContain('"contributor"');
    expect(problems[0]).toContain('"work"');
    expect(problems[0]).toContain("workerTaskEntry");
  });

  it("refuses a contributor whose `work` isn't `workerTaskEntry`'s: gated by another board, its tasks would fail at the claim gate", () => {
    const otherDoor = taskLedgers({ name: "feature-board", resolve: async () => undefined as never });
    const flow = flowOn(undefined, "gated", { task: { actions: { work: { block: turn, from: otherDoor } } } });
    const problems = workerFlowProblems("gated", flow, ["contributor"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"work"');
    expect(problems[0]).toContain("workerTaskEntry");
  });

  // A probe reads the entry's input schema, the one its caller's dispatch is
  // checked against. (A task entry's is the gate's, which `defineFlow` sets
  // to the task envelope, so the case shows on an internal entry.)
  it("refuses a manager whose `onTaskSettled` refuses the notice its board sends", () => {
    const installation = createWorkerInstallation();
    const flow = managerFlow(installation, "deaf", (entries) => ({
      ...entries,
      onTaskSettled: { ...(entries.onTaskSettled as object), inputSchema: z.object({ only: z.string() }).strict() }
    }));
    const problems = workerFlowProblems("deaf", flow, ["manager"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"onTaskSettled"');
    expect(problems[0]).toContain("refuses");
  });

  it("refuses a manager whose `dispatch` is its own rather than the board's", () => {
    const installation = createWorkerInstallation();
    const flow = managerFlow(installation, "own-pass", (entries) => ({
      ...entries,
      dispatch: { inputSchema: z.object({}).strict(), block: turn }
    }));
    const problems = workerFlowProblems("own-pass", flow, ["manager"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"manager"');
    expect(problems[0]).toContain('"dispatch"');
    expect(problems[0]).toContain("defineSessionBoard");
  });

  it("refuses a role it doesn't know, naming the roles there are", () => {
    const problems = workerFlowProblems("odd", flowOn(undefined, "odd"), ["reviewer" as never]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"reviewer"');
    expect(problems[0]).toContain('"contributor"');
  });
});

describe("a piece of a role's factory on a flow that doesn't declare the role", () => {
  it("refuses a `workerTaskEntry` on a flow that doesn't declare `contributor`", () => {
    const flow = flowOn(undefined, "quiet-taker", { task: { actions: { work: workEntry() } } });
    const problems = workerFlowProblems("quiet-taker", flow, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"contributor"');
    expect(problems[0]).toContain('"work"');
    expect(problems[0]).toContain("roles");
  });

  it("refuses the manager kit spread with its `onTaskSettled` but neither `dispatch` nor `roles`", () => {
    const installation = createWorkerInstallation();
    const flow = managerFlow(installation, "half-kit", (entries) => ({ onTaskSettled: entries.onTaskSettled }), false);
    const problems = workerFlowProblems("half-kit", flow, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"manager"');
    expect(problems[0]).toContain('"onTaskSettled"');
  });

  it("reads a flow's own unmarked `work` or `dispatch` as its own action, never a role's", () => {
    const flow = flowOn(undefined, "own-names", {
      internal: { actions: { dispatch: { inputSchema: z.object({}).strict(), block: turn } } }
    });
    expect(workerFlowProblems("own-names", flow, [])).toEqual([]);
  });
});

describe("a flow wired from the roles' factories", () => {
  it("has no problems as contributor and manager", () => {
    const installation = createWorkerInstallation();
    const board = defineSessionBoard({ installation, flowKind: "desk" });
    const flow = defineFlow({
      kind: "desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      resources: { ...installation.resources, ...board.resources },
      actions: { respond, ...board.actions },
      internal: { actions: board.entries(turn) },
      task: { actions: { work: workEntry() } }
    } as never) as never;
    expect(workerFlowProblems("desk", flow, ["contributor", "manager"])).toEqual([]);
  });

  it("is true of the built-in agent on an installation, which declares its own roles", () => {
    const installation = createWorkerInstallation();
    expect(workerFlowProblems("agent", defineAgentWorkerFlow({ installation }) as never)).toEqual([]);
  });
});

describe("every hire path reads the roles a flow is registered with", () => {
  const refusalOf = (run: () => unknown): string => {
    try {
      run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "";
  };

  it("refuses a `workerFlow(build)` builder's piece undeclared, and hires it declared with `{ roles }`", () => {
    const build = (installation: WorkerInstallation) => flowOn(installation, "clerk", { task: { actions: { work: workEntry() } } });
    const undeclared = createWorkerInstallation({ workerFlows: { clerk: workerFlow(build) } });
    const refused = refusalOf(() => hireWorkforce(undeclared));
    expect(refused).toContain('worker flow "clerk"');
    expect(refused).toContain('"contributor"');
    const declared = createWorkerInstallation({ workerFlows: { clerk: workerFlow(build, { roles: ["contributor"] }) } });
    expect(refusalOf(() => hireWorkforce(declared))).toBe("");
  });

  // A builder that names no roles leaves them to the flow it builds: the
  // built-in agent, built on the installation, declares its own.
  it("hires a `workerFlow(build)` builder of the built-in agent with no `roles`, on the agent's own", () => {
    const installation = createWorkerInstallation({
      workerFlows: { agent: workerFlow((on) => defineAgentWorkerFlow({ installation: on })) }
    });
    expect(refusalOf(() => hireWorkforce(installation))).toBe("");
    expect(installation.workerFlows().agent!.roles).toEqual(["contributor", "manager"]);
  });

  // A flow's verdict is kept for the life of its definition; two
  // registrations of it with different roles must not share one.
  it("judges one flow under two registrations by each one's roles", () => {
    const flow = flowOn(undefined, "clerk", { task: { actions: { work: workEntry() } } });
    expect(refusalOf(() => checkWorkerFlows({ clerk: { flow, standardOnly: false, roles: ["contributor"] } }))).toBe("");
    expect(refusalOf(() => checkWorkerFlows({ clerk: { flow, standardOnly: false, roles: [] } }))).toContain('"contributor"');
  });
});

describe("the coordinator role", () => {
  const coordinatorOn = (installation: WorkerInstallation) =>
    defineCoordinatorFlow({ installation, routeModel: "roles-test/route" }) as unknown as {
      internal: { actions: Record<string, unknown> };
    };
  const COORDINATOR_ENTRIES = ["routeOn", "roundDeadline", "changeWorkstreamDelegate"];

  it("is true of the built-in coordinator, which declares all three roles itself", () => {
    const installation = createWorkerInstallation();
    expect(workerFlowProblems("coordinator", coordinatorOn(installation) as never)).toEqual([]);
  });

  it("refuses a flow declaring `coordinator` without its three entries, naming each and `defineCoordinatorFlow`", () => {
    const installation = createWorkerInstallation();
    const flow = managerFlow(installation, "self-styled", (entries) => entries);
    const problems = workerFlowProblems("self-styled", flow, ["coordinator"]);
    expect(problems).toHaveLength(1);
    for (const entry of COORDINATOR_ENTRIES) expect(problems[0]).toContain(`"${entry}"`);
    expect(problems[0]).toContain("defineCoordinatorFlow");
  });

  it("refuses the coordinator's entries on a flow that doesn't declare `coordinator`", () => {
    const installation = createWorkerInstallation();
    const { internal } = coordinatorOn(installation);
    const borrowed = Object.fromEntries(COORDINATOR_ENTRIES.map((entry) => [entry, internal.actions[entry]]));
    const flow = managerFlow(installation, "borrower", (entries) => ({ ...entries, ...borrowed }));
    const problems = workerFlowProblems("borrower", flow, ["manager"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"coordinator"');
    for (const entry of COORDINATOR_ENTRIES) expect(problems[0]).toContain(`"${entry}"`);
  });
});

describe("the probe inputs", () => {
  // Each probe is what the entry's real caller sends; a probe its source
  // schema refuses would refuse every flow, or pass a broken one. The pass
  // and the deadline take inline schemas, so they are read off the entries
  // the factories build.
  it("parse against the schemas their callers send", () => {
    const installation = createWorkerInstallation();
    const entries = defineSessionBoard({ installation, flowKind: "probe" }).entries(turn) as Record<string, { inputSchema: z.ZodTypeAny }>;
    const coordinator = defineCoordinatorFlow({ installation, routeModel: "roles-test/route" }) as unknown as {
      internal: { actions: Record<string, { inputSchema: z.ZodTypeAny }> };
    };
    expect(taskDispatchInputSchema.safeParse(ROLE_PROBES.work).success).toBe(true);
    expect(taskSettledInputSchema.safeParse(ROLE_PROBES.onTaskSettled).success).toBe(true);
    expect(entries.dispatch!.inputSchema.safeParse(ROLE_PROBES.dispatch).success).toBe(true);
    expect(entries.onTaskSettled!.inputSchema.safeParse(ROLE_PROBES.onTaskSettled).success).toBe(true);
    expect(routeOnSchema.safeParse(ROLE_PROBES.routeOn).success).toBe(true);
    expect(coordinator.internal.actions.roundDeadline!.inputSchema.safeParse(ROLE_PROBES.roundDeadline).success).toBe(true);
    expect(workstreamDelegateChangeSchema.safeParse(ROLE_PROBES.changeWorkstreamDelegate).success).toBe(true);
  });
});
