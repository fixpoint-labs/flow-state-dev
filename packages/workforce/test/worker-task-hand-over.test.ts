/**
 * A task names a worker, and the list hands it to that worker.
 *
 * The lookup on its own, over an installation, so each rule about who a name
 * reaches is one assertion: a standard worker, nobody, a user's own worker,
 * one whose flow takes no tasks.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  createWorkerInstallation,
  createWorkerLookup,
  defineAgentWorkerFlow,
  type WorkerInstallation
} from "../src/index";
import { workerConfigSchema } from "../src/worker-config";
import { workerDoor } from "./worker-door";

const ctx = {} as BlockContext;

/** A task list's id, as a host names it to the filing check. */
const LIST_ID = "ops.desk.work";

/** An app's own worker flow with no task entry, bound to `installation`. */
function deskClerk(installation: WorkerInstallation) {
  return defineFlow({
    kind: "desk-clerk",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      ...workerDoor,
      answer: {
        inputSchema: z.object({ note: z.string() }),
        block: handler({
          name: "desk-answer",
          inputSchema: z.object({ note: z.string() }),
          outputSchema: z.object({ note: z.string() }),
          execute: (input) => input
        })
      }
    }
  });
}

/** An installation with an auditor on `agent` and a clerk on `desk-clerk`. */
function deskInstallation() {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "eng.auditor", declared: {}, body: "You audit." },
      { id: "ops.clerk", declared: { flow: "desk-clerk" }, body: "You file." }
    ],
    workerFlows: () => flows as never
  });
  flows = { agent: defineAgentWorkerFlow({ installation }), "desk-clerk": deskClerk(installation) };
  return installation;
}

describe("which worker a name on a task means", () => {
  const lookup = createWorkerLookup({ installation: deskInstallation() });

  it("finds a standard worker by its id, on the flow it runs on", () => {
    expect(lookup.find("eng.auditor", ctx)).toEqual({ found: true, flowId: "agent" });
  });

  it("finds no worker for a name the files don't declare, a user's own worker's included", () => {
    expect(lookup.find("frontend", ctx)).toMatchObject({ found: false, reason: "not-found" });
  });

  it("refuses a worker whose flow takes no tasks, still saying which flow it runs on", () => {
    const answer = lookup.find("ops.clerk", ctx);
    expect(answer).toMatchObject({ found: false, reason: "takes-no-tasks", flowId: "desk-clerk" });
    expect(!answer.found && answer.message).toMatch(/"ops.clerk" takes no tasks: its flow "desk-clerk"/);
  });

  it("names the task's worker in the child session's starting state", async () => {
    expect(await lookup.state({ assignee: "eng.auditor", taskId: "t1", input: {} }, ctx)).toEqual({ workerId: "eng.auditor" });
  });

  it("lets a list's own seat names through the filing check without asking", () => {
    const check = lookup.filingCheck({ [LIST_ID]: ["coder"] });
    expect(check("coder", LIST_ID, ctx)).toBeUndefined();
    expect(check("coder", "other.list", ctx)).toMatch(/No worker is named "coder"/);
    expect(check("eng.auditor", LIST_ID, ctx)).toBeUndefined();
  });

  it("refuses a hand-over to a worker whose flow takes no tasks, and hands nobody's over to nothing", async () => {
    await expect(
      Promise.resolve().then(() => lookup.flowKind({ assignee: "ops.clerk", taskId: "t1", input: {} }, ctx))
    ).rejects.toThrow(/task "t1" could not be handed over: "ops.clerk" takes no tasks/);
    expect(await lookup.flowKind({ assignee: "nobody", taskId: "t2", input: {} }, ctx)).toBeUndefined();
  });
});
