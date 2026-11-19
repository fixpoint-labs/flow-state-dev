/**
 * The DevTeam's workers answer "what was reported, and was it filed?" from
 * the Error Reporter's history, with core's general resource tools, on the
 * real Lab: the Shift Coordinator's judgment and error-reporter's own turn
 * each search `error-history` and read a record, with no message to another
 * worker and no read of the task board.
 *
 * The models are scripted by block: a turn makes the tool calls a test names,
 * one per step, and records what each tool handed back. The reporter drafts
 * with a stub, so a failure reaches Inbox without a model.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/harness";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { workerSessionId } from "../teams/devteam/ask.mts";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";

const SHIFT_COORDINATOR = "shift-coordinator";
const REPORTER = "error-reporter";
const TITLE = "Checkout total ignores the discount";

let lab: Lab | undefined;
let root: string | undefined;
afterEach(async () => {
  await lab?.dispose();
  lab = undefined;
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

type ToolCall = { toolName: string; args: Record<string, unknown> };
/** A call, or one made from what the step was handed (a uri an earlier search returned). */
type Step = ToolCall | ((handed: string) => ToolCall);

/** A model that makes `calls`, one per step, recording the messages each step was handed; then it answers. */
function stepping(id: string, calls: Step[], seen: string[]): GeneratorModel {
  let step = 0;
  return {
    modelId: id,
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages?: unknown }) {
      const handed = JSON.stringify(options.messages ?? []);
      seen.push(handed);
      const next = calls[step];
      step += 1;
      if (next === undefined) return { text: "Answered.", finishReason: "stop" };
      const call = typeof next === "function" ? next(handed) : next;
      return { toolCalls: [{ toolCallId: `${id}-${step}`, ...call }], finishReason: "tool-calls" };
    },
  } as unknown as GeneratorModel;
}

/** The reporter's draft, without a model: the title a search finds. */
const draftingStub = (): HarnessBlock =>
  handler({
    name: "error-history-drafting-stub",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async () => ({
      source: "test/stub",
      status: "completed",
      sessionId: null,
      url: null,
      dispatchedAt: Date.now(),
      outcome: "finished",
      finalMessage: "```json\n" + JSON.stringify({ title: TITLE, summary: "It ignores it." }) + "\n```",
      usage: null,
      cost: null,
    }),
  }) as unknown as HarnessBlock;

/** A Lab with the Error Reporter on, whose judgment and reporter turns make `calls`. */
async function open(calls: Step[], seen: string[]): Promise<Lab> {
  const harness = selectHarness();
  root = mkdtempSync(join(tmpdir(), "devteam-error-history-"));
  const helper = stepping("test/helper", [], []);
  const model = Object.assign(
    (_id: string, block?: string) =>
      block?.startsWith("coordinator-judgment") || block === "error-reporter-answer" ? stepping("test/turn", calls, seen) : helper,
    {
      resolveId: (id: string) => id,
      // Best fit sends every message to the Shift Coordinator's own turn.
      resolveEvaluationModel: () => ({
        specificationVersion: "v4",
        provider: "test",
        modelId: "test/route",
        supportedQuestionTypes: ["choice", "score", "boolean"],
        async doEvaluate() {
          return { answers: { worker: { type: "choice", choice: SHIFT_COORDINATOR } }, usage: { inputTokens: 1, outputTokens: 1 }, warnings: [] };
        },
      }),
    },
  ) as unknown as ModelResolver;
  lab = await openLab({
    modelResolver: model,
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
    errorReporter: { harness: draftingStub, cwd: root },
  });
  // A failure that stayed failed: it reaches Inbox as a drafted report.
  lab.errorReporter!.capture({ final: true, error: { message: "checkout total is wrong" }, requestId: "req_checkout_1", flowKind: "agent", actionName: "respond", userId: LAB_USER_ID, orgId: LAB_ORG_ID });
  await lab.errorReporter!.idle();
  return lab;
}

async function act(lab: Lab, flow: string, sessionId: string, message: string) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(flow) as FlowInstance,
    actionName: "respond",
    input: { message },
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: unknown; error?: unknown };
}

const SEARCH: ToolCall = { toolName: "searchResources", args: { query: "error report filed", prefix: null } };
const HIT = /org\/error-history\/\d{4}-\d{2}-\d{2}\/checkout-total-ignores[a-z0-9-]*/;
/** Read the record the search found, by the uri it returned. */
const READ = (handed: string): ToolCall => ({ toolName: "readResourceContent", args: { uri: HIT.exec(handed)?.[0] ?? "none" } });

describe("asked what was reported", () => {
  it("the Shift Coordinator searches the error history itself and reads the report", async () => {
    const seen: string[] = [];
    const opened = await open([SEARCH, READ], seen);
    const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
    const created = await opened.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId, state: { workerId: SHIFT_COORDINATOR } } });
    expect(created.status).toBe(201);
    const turn = await act(opened, "coordinator", sessionId, "what has been reported today?");
    expect(turn.error, JSON.stringify(turn.error)).toBeUndefined();
    // The search's result, then the read's, as the model's next steps were handed them.
    expect(seen.at(-2) ?? "").toMatch(HIT);
    const read = seen.at(-1) ?? "";
    expect(read).toContain(`# ${TITLE}`);
    expect(read).toContain("waiting in Inbox");
    expect(read).toContain("req_checkout_1");
  });

  it("error-reporter searches its own history in its conversation", async () => {
    const seen: string[] = [];
    const opened = await open([SEARCH], seen);
    const turn = await act(opened, REPORTER, workerSessionId(REPORTER), "did you report the checkout failure?");
    expect(turn.error, JSON.stringify(turn.error)).toBeUndefined();
    expect(seen.at(-1) ?? "").toMatch(HIT);
  });
});
