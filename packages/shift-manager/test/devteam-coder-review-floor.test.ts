/**
 * The Lab's review is a floor a coder can raise and never lower, on the real Lab.
 *
 * With `reviewChanges` on, every coding run that commits waits for the user's
 * review in the Inbox before its task completes, as Shift Manager's own coding
 * flow held every manager to it. A coder hired with `settings: { review: false }`
 * (a hire needs no approval) must still wait: otherwise anyone who can hire
 * could settle a change no user saw. A coder hired with `review: true` waits
 * on a Lab with review off; with both off, nothing waits.
 *
 * The stub commits a file and answers; the coordinator's judgment is scripted.
 * Whether a task waits is read from its stored holds, as the Inbox reads them.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { connect } from "../src/lib/connection";
import { readyHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const OWNER = LAB_USERS.owner;
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const WORKER = "reviewless";
const MESSAGE = "have the new coder add a note";

let opened: Lab | undefined;
let served: ServedLab | undefined;
afterEach(async () => {
  await served?.handle.close();
  served = undefined;
  await opened?.dispose();
  opened = undefined;
});

/** The coordinator's judgment: the message is filed once, for the hired coder; every other step stops. */
function filing(): ModelResolver {
  let filed = false;
  const judgment: GeneratorModel = {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages?: unknown[] }) {
      if (filed || !JSON.stringify(options.messages ?? []).includes(MESSAGE)) return { text: "Filed.", finishReason: "stop" };
      filed = true;
      return {
        toolCalls: [{ toolCallId: "t1", toolName: "createTask", args: { goal: "Add a note to the storefront.", assignee: WORKER, input: { project: STOREFRONT } } }],
        finishReason: "tool-calls",
      };
    },
  };
  return Object.assign(
    (_id: string, block?: string) => {
      if (block?.startsWith("coordinator-judgment")) return judgment;
      throw new Error(`no model in this test (asked for ${block ?? "a block"})`);
    },
    {
      resolveId: (id: string) => id,
      resolveEvaluationModel: () => ({
        specificationVersion: "v4",
        provider: "test",
        modelId: "test/route",
        supportedQuestionTypes: ["choice", "score", "boolean"],
        async doEvaluate() {
          throw new Error("no route in this test");
        },
      }),
    },
  ) as unknown as ModelResolver;
}

async function act(lab: Lab, sessionId: string, actionName: string, input: unknown) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get("coordinator") as FlowInstance,
    actionName,
    input,
    userId: OWNER.userId,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

/** The task's open review, as the Inbox reads it: a hold of the run's own stop asking for a review. */
const reviewOf = (task: Record<string, any>) =>
  task.status === "in_progress" ? (task.holds ?? []).find((hold: any) => hold.source?.kind === "suspension" && hold.ask?.kind === "review") : undefined;

/**
 * Open a Lab with the Lab's review set as given, hire a coder with its own `review` setting, file one task
 * for it, and return the task once it waits on a review or has completed.
 */
async function run(labReview: boolean, workerReview: boolean | undefined) {
  const stub = harnessStub({
    duringRun: (call) => {
      writeFileSync(join(call.cwd, "NOTE.md"), `a change ${Math.random()}\n`);
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "NOTE.md"], { cwd: call.cwd });
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "a change"], { cwd: call.cwd });
    },
    finalMessage: "Added the note.",
  });
  const remote = createBareRemote("review-floor", { seed: { "README.md": "storefront\n" } });
  opened = await openLab({
    modelResolver: filing(),
    stores: inMemoryStores(),
    harnesses: [readyHarness(stub.slot)],
    runTimeoutMs: 30_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-review-floor-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
    withoutJudge: true,
    reviewChanges: labReview,
    projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url }],
  });
  const lab = opened;
  served = await serveLab(lab.state);
  const workforce = createWorkforceClient(connect({ userId: OWNER.userId, baseUrl: served.baseUrl, bearerToken: OWNER.bearer }));
  await workforce.hire({
    id: WORKER,
    flow: "coder",
    settings: { document: "teams/eng/feature-brief", ...(workerReview === undefined ? {} : { review: workerReview }) },
  });
  const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", "coordinator/sessions", { body: { userId: OWNER.userId, sessionId, state: { workerId: "shift-coordinator" } } });
  expect(created.status).toBe(201);
  expect((await act(lab, sessionId, "addDelegate", { worker: WORKER })).error).toBeUndefined();
  expect((await act(lab, sessionId, "respond", { message: MESSAGE })).error).toBeUndefined();
  const task = await eventually(async () => {
    const filed = (Object.values(await lab.stored("user", "tasks/")) as Array<Record<string, any>>).find((stored) => stored.filer?.sessionId === sessionId);
    return filed !== undefined && (reviewOf(filed) !== undefined || ["completed", "errored", "cancelled", "failed"].includes(filed.status)) ? filed : undefined;
  }, "the task to wait on a review or end", 30_000);
  return { task, runs: stub.runs.length };
}

describe("the Lab's review is a floor a coder can raise, not lower", () => {
  it("holds a committed run for the Inbox review when the Lab reviews and the coder was hired with review off", async () => {
    const { task, runs } = await run(true, false);
    expect(runs).toBe(1);
    expect(reviewOf(task), JSON.stringify({ status: task.status, holds: task.holds })).toBeDefined();
  }, 120_000);

  it("holds it when the Lab doesn't review and the coder was hired with review on", async () => {
    const { task } = await run(false, true);
    expect(reviewOf(task), JSON.stringify({ status: task.status, holds: task.holds })).toBeDefined();
  }, 120_000);

  it("completes it with no review when neither asks for one", async () => {
    const { task } = await run(false, undefined);
    expect(task.status, JSON.stringify(task.lastError ?? null)).toBe("completed");
    expect(reviewOf(task)).toBeUndefined();
  }, 120_000);
});
