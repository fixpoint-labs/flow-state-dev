/**
 * A coder hired on a named harness (FIX-2486), on the real Lab.
 *
 * Asked to "hire Cursor, a new engineer that runs on the Cursor harness", the
 * Shift Coordinator hires a worker on the one `coder` flow with
 * `settings: { harness: "cursor" }`. The hire must land, the user's roster
 * must say which harness the worker runs, and a task filed for it must run on
 * that harness, never the Lab's default coder. A harness the Lab doesn't run
 * is refused at hire, naming the ones it does.
 *
 * Each harness here is a stub that answers with its own name, so which one
 * ran a task is read off the task's answer and each stub's own run log. The
 * Shift Coordinator's judgment is scripted, one tool call per step.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessStub, type HarnessStub } from "@flow-state-dev/harness-manager";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { LIST_TASKS_ACTION } from "../src/lib/conversation-tasks";
import { connect } from "../src/lib/connection";
import { LAB_ORG_ID, LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const OWNER = LAB_USERS.owner;
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const BRIEF = { document: "teams/eng/feature-brief" };
/** The default coder's name, as the DevTeam profile starts it, and the harnesses a coder may name beside it. */
const DEFAULT = "stub";
const NAMED = ["claude-code", "codex", "cursor"] as const;

let opened: Lab | undefined;
let served: ServedLab | undefined;
afterEach(async () => {
  await served?.handle.close();
  served = undefined;
  await opened?.dispose();
  opened = undefined;
});

type ToolCall = { toolName: string; args: Record<string, unknown> };
/** Ends the turn it falls in, so the calls after it run in the next turn. */
const END_TURN = null;

/** The Shift Coordinator's judgment, one call per step; every tool output it was handed, in order. */
function scripted(calls: Array<ToolCall | typeof END_TURN>, outputs: unknown[]): ModelResolver {
  let step = 0;
  const judgment: GeneratorModel = {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages?: unknown[] }) {
      outputs.push(JSON.stringify(options.messages ?? []));
      const call = calls[step];
      step += 1;
      if (call === undefined || call === END_TURN) return { text: "Done.", finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `t${step}`, ...call }], finishReason: "tool-calls" };
    },
  };
  return Object.assign(
    (_id: string, block?: string) => {
      if (block?.startsWith("coordinator-judgment")) return judgment;
      throw new Error(`no model in this test (asked for ${block ?? "a block"})`);
    },
    {
      resolveId: (id: string) => id,
      // Best fit's route: no pick, so the Shift Coordinator's judgment takes each message.
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

/** A stub that answers with the harness it stands in for. */
const answering = (name: string) => harnessStub({ finalMessage: `ran on ${name}` });

/** A Lab whose default coder is `stubs.stub`, and which runs each other stub under its name. */
async function open(model: ModelResolver, stubs: Record<string, HarnessStub>) {
  const remote = createBareRemote("hire-harness", { seed: { "README.md": "storefront\n" } });
  opened = await openLab({
    modelResolver: model,
    stores: inMemoryStores(),
    harness: stubs[DEFAULT]!.slot,
    harnessName: DEFAULT,
    harnesses: Object.fromEntries(NAMED.map((name) => [name, { slot: stubs[name]!.slot }])),
    runTimeoutMs: 30_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-hire-harness-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
    withoutJudge: true,
    projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url }],
  });
  served = await serveLab(opened.state);
  const workforce = createWorkforceClient(connect({ userId: OWNER.userId, baseUrl: served.baseUrl, bearerToken: OWNER.bearer }));
  return { lab: opened, workforce };
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

/** A conversation with the Shift Coordinator, opened as the app opens one. */
async function conversation(lab: Lab): Promise<string> {
  const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", "coordinator/sessions", {
    body: { userId: OWNER.userId, sessionId, state: { workerId: "shift-coordinator" } },
  });
  expect(created.status).toBe(201);
  return sessionId;
}

/** Wait for the conversation's only task to settle, and return its stored row, output and all. */
async function settled(lab: Lab, sessionId: string): Promise<Record<string, any>> {
  const listed = await eventually(async () => {
    const tasks = ((await act(lab, sessionId, LIST_TASKS_ACTION, {})).output?.tasks ?? []) as Array<Record<string, any>>;
    return ["completed", "errored", "cancelled", "failed"].includes(tasks[0]?.status) ? tasks[0] : undefined;
  }, "the task to settle", 30_000);
  return (Object.values(await lab.stored("user", "tasks/")) as Array<Record<string, any>>).find((row) => row.id === listed.id)!;
}

describe("hiring a coder on a harness (FIX-2486)", () => {
  for (const name of NAMED) {
    it(`hires a worker on the coder flow with harness ${name}, shows it on the roster, and runs its task on ${name}`, async () => {
      const stubs = Object.fromEntries([DEFAULT, ...NAMED].map((n) => [n, answering(n)]));
      const outputs: unknown[] = [];
      const worker = `${name.replace("-", "")}-engineer`;
      const { lab, workforce } = await open(
        scripted(
          [
            // What "Hire Cursor, a new engineer that runs on the Cursor harness" comes to.
            { toolName: "hire", args: { id: worker, flow: "coder", description: `An engineer on ${name}.`, settings: { ...BRIEF, harness: name } } },
            { toolName: "addDelegate", args: { worker } },
            END_TURN,
            { toolName: "createTask", args: { goal: "Which file renders the cart badge?", assignee: worker, input: { project: STOREFRONT } } },
          ],
          outputs,
        ),
        stubs,
      );

      const id = await conversation(lab);
      expect((await act(lab, id, "respond", { message: `Hire ${name}, a new engineer that runs on the ${name} harness` })).error).toBeUndefined();

      // The hire landed on the coder flow, and the roster says which harness the worker runs.
      const entry = (await workforce.roster()).find((e) => e.id === worker);
      expect(entry, `the hire's tool output: ${outputs.at(-1)}`).toMatchObject({ flow: "coder", standard: false, settings: { harness: name } });

      // Its task runs on that harness, and on no other.
      expect((await act(lab, id, "respond", { message: `have ${worker} find the cart badge` })).error).toBeUndefined();
      const task = await settled(lab, id);
      expect(task.status, JSON.stringify(task.lastError ?? task.error ?? null)).toBe("completed");
      expect(task.assignee).toBe(worker);
      expect(task.output?.answer).toBe(`ran on ${name}`);
      expect(stubs[name]!.runs).toHaveLength(1);
      for (const other of [DEFAULT, ...NAMED].filter((n) => n !== name)) expect(stubs[other]!.runs, other).toHaveLength(0);
    }, 120_000);
  }

  it("runs a coder that names no harness on the Lab's default coder", async () => {
    const stubs = Object.fromEntries([DEFAULT, ...NAMED].map((n) => [n, answering(n)]));
    const { lab } = await open(
      scripted([{ toolName: "createTask", args: { goal: "Which file renders the cart badge?", assignee: "eng.coder", input: { project: STOREFRONT } } }], []),
      stubs,
    );
    const id = await conversation(lab);
    expect((await act(lab, id, "respond", { message: "have the coder find the cart badge" })).error).toBeUndefined();
    const task = await settled(lab, id);
    expect(task.status, JSON.stringify(task.lastError ?? task.error ?? null)).toBe("completed");
    expect(task.output?.answer).toBe(`ran on ${DEFAULT}`);
    for (const other of NAMED) expect(stubs[other]!.runs, other).toHaveLength(0);
  }, 120_000);

  it("refuses a harness the Lab doesn't run, naming the ones it does, and writes nothing", async () => {
    const stubs = Object.fromEntries([DEFAULT, ...NAMED].map((n) => [n, answering(n)]));
    const { workforce } = await open(scripted([], []), stubs);
    await expect(
      workforce.hire({ id: "windsurf", flow: "coder", settings: { ...BRIEF, harness: "windsurf" } }),
    ).rejects.toThrow(/harness "windsurf" is not one this Shift Manager runs; pick one of: stub, claude-code, codex, cursor/);
    expect((await workforce.roster()).some((e) => e.id === "windsurf")).toBe(false);
  }, 60_000);
});
