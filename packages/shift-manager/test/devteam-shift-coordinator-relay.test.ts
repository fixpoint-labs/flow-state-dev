// FIX-2792.
/**
 * The Shift Coordinator doesn't restate a worker's message, on the real Lab.
 *
 * A message another worker sends the Shift Coordinator is drawn in its
 * conversation whole, under that worker's name, right above the Shift
 * Coordinator's answer. Restated, the user reads the same table twice. The
 * rule that stops it lives in the Shift Coordinator's `WORKER.md`, so this
 * checks that it reaches the turn's prompt: an edit that drops or moves it
 * out of the file the Lab loads fails here.
 *
 * The judgment model (`coordinator-judgment`) is scripted: it answers with a
 * fixed line and records what it was handed. Best fit's question
 * (`coordinator-route-ask`) goes unanswered, and any other block asking for a
 * model fails the test.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, GeneratorModelCallOptions, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { promptWithoutUser } from "./helpers/prompt";

let opened: Lab | undefined;
const handed: GeneratorModelCallOptions[] = [];
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
  handed.length = 0;
});

const judgment: GeneratorModel = {
  modelId: "test/judgment",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options) {
    handed.push(options);
    return { text: "Noted.", finishReason: "stop" };
  },
};

/** A resolver that answers the judgment turn alone. */
const model = Object.assign(
  (id: string, block?: string) => {
    if (block?.startsWith("coordinator-judgment")) return judgment;
    // Best fit's question goes unanswered, so the message reaches the judgment turn.
    if (block === "coordinator-route-ask") throw new Error("no route model in this test");
    throw new Error(`no model in this test: ${block ?? id} asked for one`);
  },
  { resolveId: (id: string) => id },
) as unknown as ModelResolver;

describe("the Shift Coordinator after a worker's message", () => {
  it("has the rule against restating a message that is already on the user's screen in its prompt", async () => {
    const harness = selectHarness();
    opened = await openLab({
      modelResolver: model,
      stores: inMemoryStores(),
      harnesses: [harness.value],
      runTimeoutMs: harness.runTimeoutMs,
      workspace: { root: mkdtempSync(join(tmpdir(), "devteam-shift-coordinator-relay-")), remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
      inventory: true,
    });
    const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
    const created = await opened.door("POST", "coordinator/sessions", {
      body: { userId: LAB_USER_ID, sessionId, state: { workerId: "shift-coordinator" } },
    });
    expect(created.status).toBe(201);
    const runtime = await opened.state.getRuntime();
    const result = (await runAction({
      orgId: LAB_ORG_ID,
      flow: runtime.registry.get("coordinator") as FlowInstance,
      actionName: "respond",
      input: { message: "what did error-reporter find?" },
      userId: LAB_USER_ID,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { error?: unknown };
    expect(result.error).toBeUndefined();

    // The prompt without the user's own message: the rule came from the worker's file.
    const prompt = promptWithoutUser(handed.at(-1));
    expect(prompt).toContain("A message another worker sends you (a line that starts `From <worker id>:`)");
    expect(prompt).toContain("never restate it");
    expect(prompt).toContain("what happens next");
  });
});
