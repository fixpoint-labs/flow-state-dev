/**
 * The shift coordinator's memory (`teams/devteam/memory.mts`), on the real
 * Lab: the chief of staff's judgment turn carries the standard memory pack
 * (working memory, the rolling digest, `memory/recall`), the `agent` flow
 * carries none of it, and the turn is told whether anything is recorded.
 *
 * The round trip is the test that matters. With capture on, a fact the person
 * said reaches the next turn's prompt from working memory; with capture off,
 * the Lab's default, the same conversation leaves no trace there. Each prompt
 * is read without the person's own messages, so a fact found in it got there
 * from memory and not because the person just said it.
 *
 * The model is scripted by block: the judgment (`coordinator-judgment`)
 * answers with a fixed line and records what it was handed; memory's
 * observer (`memory/observe`) extracts the fact; every other block answers
 * with a fixed line.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, GeneratorModelCallOptions, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { CAPTURE_OFF, CAPTURE_ON } from "../teams/devteam/memory.mts";
import { createNotifyLog } from "../teams/devteam/notify.mts";

const COS = "chief-of-staff";
const FACT = "the release train leaves on thursdays";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** What each judgment step was handed. */
let handed: GeneratorModelCallOptions[] = [];

function fixed(id: string, result: () => Record<string, unknown>): GeneratorModel {
  return {
    modelId: id,
    async generate() {
      return result();
    },
    async generateStep() {
      return result();
    },
  };
}

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

const observer = fixed("test/observe", () => ({
  structuredOutput: {
    items: [{ subject: "user", content: FACT, importance: 0.9, durability: "session", category: "preference" }],
  },
  finishReason: "stop",
}));

const helper = fixed("test/helper", () => ({ text: "ok", finishReason: "stop" }));

const model = Object.assign(
  (_id: string, block?: string) =>
    block?.startsWith("coordinator-judgment") ? judgment : block === "memory/observe" ? observer : helper,
  { resolveId: (id: string) => id },
) as unknown as ModelResolver;

async function open(memoryCapture?: boolean): Promise<Lab> {
  const harness = selectHarness();
  opened = await openLab({
    modelResolver: model,
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-cos-memory-")), remotes: { allow: ["file"] } },
    coderSeatId: "eng.coder",
    mailboxes: { addresses: {}, log: createNotifyLog() },
    inventory: true,
    ...(memoryCapture === undefined ? {} : { memoryCapture }),
  });
  return opened;
}

async function conversation(lab: Lab): Promise<string> {
  const sessionId = `s-cos-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", `coordinator/sessions`, {
    body: { userId: LAB_USER_ID, sessionId, state: { workerId: COS } },
  });
  expect(created.status).toBe(201);
  return sessionId;
}

async function say(lab: Lab, sessionId: string, message: string): Promise<void> {
  const runtime = await lab.state.getRuntime();
  const result = (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get("coordinator") as FlowInstance,
    actionName: "run",
    input: { message },
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { error?: unknown };
  expect(result.error).toBeUndefined();
  // Capture runs as a side-chain after the answer: wait for it to settle.
  const deadline = Date.now() + 10_000;
  while ((await runtime.stores.request.list({})).some((r) => r.status === "in_progress")) {
    if (Date.now() > deadline) throw new Error("a request never finished");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The last judgment step's prompt, without the person's own messages. */
function lastPrompt(): string {
  const options = handed.at(-1);
  expect(options).toBeDefined();
  return JSON.stringify((options!.messages as Array<{ role?: string }>).filter((m) => m.role !== "user"));
}

function lastTools(): string[] {
  return (handed.at(-1)?.tools ?? []).map((tool) => tool.name);
}

describe("the shift coordinator's memory", () => {
  afterEach(() => {
    handed = [];
  });

  it("is composed into the coordinator flow, kept apart from the person's other flows, and not into agent", async () => {
    const lab = await open();
    const runtime = await lab.state.getRuntime();
    const coordinator = runtime.registry.get("coordinator") as FlowInstance;
    const agent = runtime.registry.get("agent") as FlowInstance;
    const MEMORY_KEYS = ["workingMemory", "episodicMemory", "semanticMemory", "digestMemory"];
    const memoryKeys = (flow: FlowInstance) => Object.keys(flow.resources ?? {}).filter((key) => MEMORY_KEYS.includes(key));
    expect(memoryKeys(coordinator).sort()).toEqual([...MEMORY_KEYS].sort());
    expect(memoryKeys(agent)).toEqual([]);
    expect(coordinator.isolateUserState).toBe(true);
    expect(agent.isolateUserState).toBe(false);
  });

  it("offers the chief of staff recall, and says capture is off by default", async () => {
    const lab = await open();
    await say(lab, await conversation(lab), "what do you remember about our releases?");
    // The tool's name as the provider sees it: `/` is not allowed there.
    expect(lastTools().some((name) => name.includes("recall"))).toBe(true);
    expect(lastPrompt()).toContain(CAPTURE_OFF);
    expect(lastPrompt()).not.toContain(CAPTURE_ON);
  });

  it("with capture on, reads back what the person said on the next turn, from working memory", async () => {
    const lab = await open(true);
    const id = await conversation(lab);
    await say(lab, id, `remember: ${FACT}`);
    // The first turn's prompt never had it: nothing was recorded yet.
    expect(lastPrompt()).not.toContain(FACT);
    expect(lastPrompt()).toContain(CAPTURE_ON);
    await say(lab, id, "when does the train leave?");
    expect(lastPrompt()).toContain(FACT);
  });

  it("with capture off, the same conversation leaves nothing in memory to read back", async () => {
    const lab = await open();
    const id = await conversation(lab);
    await say(lab, id, `remember: ${FACT}`);
    await say(lab, id, "when does the train leave?");
    // The person's earlier message is still in the conversation's history,
    // which is read now and is not memory: the prompt without the person's
    // messages carries no trace of it.
    expect(lastPrompt()).not.toContain(FACT);
  });
});
