/**
 * A message the chief of staff routes to the coder, on the real Lab.
 *
 * The coordinator mints a routed task's id as `routed:<request>:<round>:<delegate>`,
 * and the coder runs a task that names no issue under its task id. That id
 * becomes a checkout path, a branch and a run record, none of which can carry
 * a colon or a dot, so every routed task the coder took failed at once. Here
 * the user's conversation works on a project, best fit hands their message to `eng.coder`, the coder's harness
 * answers, and the answer comes back in the conversation under the coder's
 * name; after it, a line in the finished run's session resumes the coding
 * session that run opened.
 *
 * Best fit's evaluation is scripted; the coder's harness is a stub.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessStub } from "../teams/devteam/harness-stub.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";

const COS = "chief-of-staff";
const CODER = "eng.coder";
const ASK = "Which file renders the cart badge?";
const ANSWER = "The badge is in header.tsx.";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** Best fit's evaluation: the coder, sure of it. The coder's judge, `done`. */
const route = {
  specificationVersion: "v4",
  provider: "test",
  modelId: "test/route",
  supportedQuestionTypes: ["choice", "score", "boolean"],
  async doEvaluate(call: { questions: Record<string, unknown> }) {
    const judging = "verdict" in call.questions;
    return {
      answers: judging
        ? { verdict: { type: "choice", choice: "done" }, why: { type: "choice", choice: "off-target" } }
        : { worker: { type: "choice", choice: CODER } },
      usage: { inputTokens: 1, outputTokens: 1 },
      warnings: [],
      providerMetadata: { typesafe: { confidence: judging ? { verdict: 0.95 } : { worker: 0.95 } } },
    };
  },
};

/** No block in this test should reach a model: best fit picks the coder with no turn of the coordinator's own. */
const models = Object.assign(
  (_id: string, block?: string): GeneratorModel => {
    throw new Error(`no model in this test (asked for ${block ?? "a block"})`);
  },
  { resolveId: (id: string) => id, resolveEvaluationModel: () => route },
) as unknown as ModelResolver;

async function act(lab: Lab, flow: string, sessionId: string, actionName: string, input: unknown) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(flow) as FlowInstance,
    actionName,
    input,
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

/** Polls `check` until it returns a value. */
async function eventually<T>(check: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> {
  for (const until = Date.now() + ms; ; ) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("a message a coordinator routes to the coder", () => {
  it("runs as a routed task, and the coder's answer comes back in the conversation", async () => {
    const stub = harnessStub({ finalMessage: ANSWER });
    const remote = createBareRemote("routed-to-coder", { seed: { "README.md": "storefront\n" } });
    opened = await openLab({
      modelResolver: models,
      stores: inMemoryStores(),
      harness: stub.slot,
      runTimeoutMs: 30_000,
      workspace: { root: mkdtempSync(join(tmpdir(), "devteam-routed-to-coder-")), remotes: { allow: ["file"] } },
      coderWorkerId: CODER,
      inventory: true,
      projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url }],
    });
    const lab = opened;
    const runtime = await lab.state.getRuntime();
    const conversation = `s-cos-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", "coordinator/sessions", {
      body: { userId: LAB_USER_ID, sessionId: conversation, state: { workerId: COS } },
    });
    expect(created.status).toBe(201);
    // The conversation works on a project, so the coder's answer run has a checkout to work in.
    expect((await act(lab, "coordinator", conversation, "setWorkProject", { project: STOREFRONT })).error).toBeUndefined();

    expect((await act(lab, "coordinator", conversation, "respond", { message: ASK })).error).toBeUndefined();

    const routed = await eventually(async () => {
      const row = (Object.values(await lab.stored("user", "tasks/")) as any[]).find((r) => r.sealed?.postId !== undefined);
      return ["completed", "failed", "errored", "cancelled"].includes(row?.status) ? row : undefined;
    }, "the routed task to end");
    // The id the harness couldn't carry as it was.
    expect(routed.id).toMatch(/^routed:.*:eng\.coder$/);
    expect(routed.assignee).toBe(CODER);
    expect(routed.status, JSON.stringify(routed.lastError ?? routed.error ?? null)).toBe("completed");
    expect(routed.output.answer).toBe(ANSWER);
    expect(stub.runs).toHaveLength(1);
    expect(stub.runs[0]!.prompt).toContain(ASK);

    // The answer comes back in the conversation, under the coder's name.
    await eventually(async () => {
      const items = (await runtime.stores.request.list({ sessionId: conversation, withItems: true })).flatMap(
        (request) => (request as unknown as { items?: any[] }).items ?? [],
      );
      return items.some((item) => item.type === "message" && item.agentName === CODER && JSON.stringify(item.content).includes(ANSWER))
        ? true
        : undefined;
    }, "the coder's answer in the conversation");

    // A line in the finished run's session resumes the coding session it opened:
    // the door reads the run record under the issue the manager keyed it by.
    const talk = await act(lab, "coder", routed.run.sessionId, "respond", { message: "And the footer?" });
    expect(talk.error).toBeUndefined();
    expect(stub.runs).toHaveLength(2);
    expect(stub.runs[1]!.resume).not.toBeNull();
    expect(stub.runs[1]!.cwd).toBe(stub.runs[0]!.cwd);
  }, 120_000);
});
