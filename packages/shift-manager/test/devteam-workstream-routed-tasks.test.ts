/**
 * A routed task that runs in a workstream's session, on the Lab as served
 * (FIX-2083). Alice's Storefront project coordinator hands a job to her
 * `feature` workstream as a routed task. The workstream session was not
 * opened for the conversation, so it finds the task's board through the
 * conversation the task came from.
 *
 * Steered with `updateTask`'s `message`:
 *
 * - led by the General Lead (the built-in `agent` flow) and steered while the
 *   lead's turn still runs, the lead's next model call carries the steer;
 * - led by the EM, which files the coder's task and ends its turn, and
 *   steered while the task waits on the coder's work, the EM gets the turn
 *   the steer is owed, with the steer, while the coder still runs, and the
 *   routed task still ends only after that work.
 *
 * Routed to from another conversation's board (her project coordinator
 * conversation deleted and opened again) while the first board's task is
 * open there, the second task waits, and starts once the first has ended
 * (one open task per session); both end.
 *
 * Routed to the EM, a custom flow, it shows the EM's model the conversation's
 * recent lines just before the message, as the built-in agent's turn does.
 *
 * Failed while its conversation is gone, its final failure goes to the Error
 * Reporter from the workstream's session.
 *
 * The models are scripted by block, as in `devteam-em-workstream.test.ts`.
 * The coder's harness is a stub that holds its run until the test lets it go.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GeneratorModel, HarnessBlock, ModelResolver } from "@flow-state-dev/core/types";
import { handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import { inMemoryStores } from "@flow-state-dev/engine";
import { runAction } from "../src/lib/action";
import type { Client } from "@flow-state-dev/client";
import { connect } from "../src/lib/connection";
import { readProject, type ProjectAddress } from "../src/lib/projects";
import { createLabReader, readerSessionId } from "../src/lib/reads";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { harnessStub } from "../teams/devteam/harness-stub.mts";
import { LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { commitAll, createBareRemote } from "../teams/devteam/scratch-repo.mts";
import { EM_TURN } from "../teams/devteam/workforce/flows/workers/em.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const STOREFRONT: ProjectAddress = { visibility: "shared", id: "storefront" };
const ALICE = LAB_USERS.owner;
const EM = "eng.em";
const GENERAL_LEAD = "general-lead";
const CODER = "eng.coder";
const STEER = "Keep the guest cart badge in the header too.";
const FIRST_ASK = "Add guest checkout.";
const SECOND_ASK = "Add a wishlist too.";

type ToolCall = { toolName: string; args: Record<string, unknown> };
type Row = Record<string, any>;

/** One tool call per step, then a closing line. */
function stepping(id: string, calls: ToolCall[], closing: string): GeneratorModel {
  let step = 0;
  return {
    modelId: id,
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      const call = calls[step];
      step += 1;
      if (call === undefined) return { text: closing, finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `${id}-${step}`, ...call }], finishReason: "tool-calls" };
    },
  };
}

/** What the EM's model was handed: each turn's first call. */
type EmSeen = { turns: string[] };

/** The EM: its first turn files the coder's task, unless `files` is false; every later one calls nothing. */
function emModel(seen: EmSeen, files = true): GeneratorModel {
  let queue: ToolCall[] = [];
  let step = 0;
  return {
    modelId: "test/em",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages: unknown[] }) {
      const text = JSON.stringify(options.messages).replaceAll("\\n", "\n");
      const last = options.messages.at(-1) as { role?: string } | undefined;
      if (last?.role !== "tool") {
        seen.turns.push(text);
        queue = files && seen.turns.length === 1 ? [{ toolName: "createTask", args: { goal: "Build the guest cart.", assignee: CODER } }] : [];
      }
      const call = queue.shift();
      step += 1;
      if (call === undefined) return { text: "Noted.", finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `em-${step}`, ...call }], finishReason: "tool-calls" };
    },
  };
}

/**
 * The General Lead, on the built-in `agent` flow: its first call reports
 * progress and holds until `hold` resolves; its next one answers.
 */
function leadModel(calls: string[], hold: () => Promise<void>): GeneratorModel {
  return {
    modelId: "test/lead",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages: unknown[] }) {
      calls.push(JSON.stringify(options.messages).replaceAll("\\n", "\n"));
      if (calls.length > 1) return { text: "The plan, with the badge.", finishReason: "stop" };
      await hold();
      return { toolCalls: [{ toolCallId: "lead-1", toolName: "reportProgress", args: { statusNote: "Halfway" } }], finishReason: "tool-calls" };
    },
  };
}

/** Jev, always `done`; best fit's route is never picked. */
const judge = {
  specificationVersion: "v4",
  provider: "test",
  modelId: "test/jev",
  supportedQuestionTypes: ["choice", "score", "boolean"],
  async doEvaluate(call: { questions: Record<string, unknown> }) {
    if (!("verdict" in call.questions)) throw new Error("no route in this test");
    return {
      answers: { verdict: { type: "choice", choice: "done" }, why: { type: "choice", choice: "off-target" } },
      usage: { inputTokens: 1, outputTokens: 1 },
      warnings: [],
      providerMetadata: { typesafe: { confidence: { verdict: 0.95 } } },
    };
  },
};

/** The lead's model: the EM's for its own turn, the General Lead's for the `agent` flow's. */
type Lead = { readonly id: string; readonly em?: GeneratorModel; readonly agent?: GeneratorModel };

/** The coordinators' judgment: each turn hands its message to the lead's workstream, then says so. */
function judgmentModel(lead: string): GeneratorModel {
  let call = 0;
  return {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages: unknown[] }) {
      const last = options.messages.at(-1) as { role?: string } | undefined;
      if (last?.role === "tool") return { text: "Handed on.", finishReason: "stop" };
      call += 1;
      return {
        toolCalls: [
          {
            toolCallId: `judgment-${call}`,
            toolName: "createTask",
            args: { goal: "Do what the message asks", assignee: lead, target: "shared/storefront/feature", session: "ongoing", resultTo: "conversation" },
          },
        ],
        finishReason: "tool-calls",
      };
    },
  };
}

function scripted(lead: Lead): ModelResolver {
  const judgment = judgmentModel(lead.id);
  const helper = stepping("test/helper", [], "On it.");
  const pick = (block?: string) =>
    block?.startsWith("coordinator-judgment")
      ? judgment
      : block === EM_TURN && lead.em !== undefined
        ? lead.em
        : block?.startsWith("agent-answer") && lead.agent !== undefined
          ? lead.agent
          : helper;
  return Object.assign(
    (_id: string, block?: string) => pick(block),
    { resolveId: (id: string) => id, resolveEvaluationModel: () => judge },
  ) as unknown as ModelResolver;
}

/** A gate: `wait` resolves once `open` is called. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, wait: () => opened };
}

/** The Error Reporter's harness: it never drafts, and stops when its run is cancelled. */
const reportHarness = (): HarnessBlock =>
  handler({
    name: "workstream-routed-report-harness",
    inputSchema: harnessRunInputSchema,
    outputSchema: harnessRunHandleSchema,
    execute: async (_input, ctx) => {
      await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new Error("cancelled");
    },
  }) as unknown as HarnessBlock;

let lab: Lab | undefined;
let served: ServedLab | undefined;
let root: string | undefined;
let release: (() => void)[] = [];

afterEach(async () => {
  for (const open of release) open();
  await served?.handle.close();
  await lab?.dispose();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  lab = undefined;
  served = undefined;
  root = undefined;
  release = [];
});

/**
 * The Lab with Alice's `feature` workstream led by `lead`, and her project
 * coordinator's message handed on to it. The coder's run holds until
 * `coderRuns` opens.
 */
async function handOn(lead: Lead, coderRuns: ReturnType<typeof gate>, options: { reporter?: boolean } = {}) {
  const remote = createBareRemote("em-workstream-steer", { seed: { "README.md": "storefront\n" } });
  const stub = harnessStub({
    finalMessage: "Done.",
    duringRun: async (run) => {
      await coderRuns.wait();
      writeFileSync(join(run.cwd, `${globalThis.crypto.randomUUID()}.md`), "work\n");
      commitAll(run.cwd, "the part");
    },
  });
  root = mkdtempSync(join(tmpdir(), "sm-em-workstream-steer-"));
  lab = await openLab({
    modelResolver: scripted(lead),
    stores: inMemoryStores(),
    harness: stub.slot,
    runTimeoutMs: 30_000,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    inventory: true,
    projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url, members: [LAB_USERS.member.userId] }],
    workstreams: [{ as: "member", input: { project: STOREFRONT, id: "feature", title: "Feature", lead: EM } }],
    ...(options.reporter === true ? { errorReporter: { harness: reportHarness, cwd: root } } : {}),
  });
  served = await serveLab(lab.state);
  const client: Client = connect({ userId: ALICE.userId, baseUrl: served.baseUrl, bearerToken: ALICE.bearer });
  await createLabReader(client).read();
  const reader = readerSessionId(ALICE.userId, "projects");
  await runAction(client, "projects", reader, "openWorkstream", { project: STOREFRONT, id: "feature", title: "Feature", lead: lead.id });
  const workstream = (await readProject(client, reader, STOREFRONT))!.entries.find((e) => e.owner === ALICE.userId && e.id === "feature")!
    .sessionId!;
  const pc = (await createWorkforceClient(client).ensureWorkerSession({ worker: "project-coordinator", projectId: STOREFRONT })).id;
  await runAction(client, "coordinator", pc, "respond", { message: FIRST_ASK });
  const rows = async () => Object.values(await lab!.stored("user", "tasks/")) as Row[];
  const routedRow = async (body?: string) =>
    (await rows()).find((r) => r.sealed?.postId !== undefined && (body === undefined || r.sealed.body === body));
  const coderRow = async () => (await rows()).find((r) => r.sealed?.postId === undefined);
  const steer = async (id: string) =>
    expect((await runAction(client, "coordinator", pc, "updateTask_tasks", { id, message: STEER })).output).toEqual({ ok: true });
  return { client, workstream, pc, routedRow, coderRow, steer };
}

describe("a steer on a routed task in a workstream's session", () => {
  it("reaches the lead's running turn before its next model call", async () => {
    const calls: string[] = [];
    const firstCall = gate();
    const atFirstCall = gate();
    const coderRuns = gate();
    release.push(firstCall.open, coderRuns.open);
    const agent = leadModel(calls, async () => {
      atFirstCall.open();
      await firstCall.wait();
    });
    const host = await handOn({ id: GENERAL_LEAD, agent }, coderRuns);
    await atFirstCall.wait();
    const routed = await eventually(async () => {
      const row = await host.routedRow();
      return row?.status === "in_progress" ? row : undefined;
    }, "the routed task running", 30_000);
    expect(routed.run?.sessionId).toBe(host.workstream);

    await host.steer(routed.id);
    firstCall.open();
    const done = await eventually(async () => {
      const row = await host.routedRow();
      return row?.status === "completed" ? row : undefined;
    }, "the routed task completed", 30_000);
    // Not in the call before it; in the next one, in the same turn, with no attempt used.
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toContain(STEER);
    expect(calls[1]).toContain(STEER);
    expect(done).toMatchObject({ attempts: 1, output: "The plan, with the badge." });
    expect(done.steers).toEqual([expect.objectContaining({ message: STEER, takenIn: expect.stringMatching(/^step:/) })]);
  }, 120_000);

  it("starts the EM's owed turn with the steer while its filed work runs, and the task still ends after that work", async () => {
    const seen: EmSeen = { turns: [] };
    const coderRuns = gate();
    release.push(coderRuns.open);
    const host = await handOn({ id: EM, em: emModel(seen) }, coderRuns);

    // The EM filed the coder's task and ended its turn: the routed task, in the workstream's session, waits on that work.
    const routed = await eventually(async () => {
      const [task, coder] = [await host.routedRow(), await host.coderRow()];
      return coder?.status === "in_progress" && task?.waitingOn === "filed" ? task : undefined;
    }, "the routed task waits on the coder's task", 60_000);
    expect(routed.run?.sessionId).toBe(host.workstream);
    expect(seen.turns).toHaveLength(1);

    await host.steer(routed.id);
    // The EM's owed turn runs with the steer, while the coder still runs.
    await eventually(async () => (seen.turns.some((turn) => turn.includes(STEER)) ? true : undefined), "the EM's turn with the steer", 30_000);
    expect((await host.coderRow())?.status).toBe("in_progress");
    expect((await host.routedRow())!.steers).toEqual([expect.objectContaining({ message: STEER, takenIn: expect.stringMatching(/^turn:/) })]);

    // The coder's work ends, and the routed task ends after it.
    coderRuns.open();
    const done = await eventually(async () => {
      const task = await host.routedRow();
      return task?.status === "completed" ? task : undefined;
    }, "the routed task completed", 60_000);
    const coder = (await host.coderRow())!;
    expect(coder.status).toBe("completed");
    expect(done.completedAt).toBeGreaterThanOrEqual(coder.completedAt);
  }, 120_000);
});

describe("a routed task to a workstream from another conversation's board", () => {
  it("waits while the first conversation's routed task is open there, then starts in the same session, and both end", async () => {
    const seen: EmSeen = { turns: [] };
    const coderRuns = gate();
    release.push(coderRuns.open);
    const host = await handOn({ id: EM, em: emModel(seen) }, coderRuns);
    const first = await eventually(async () => {
      const [task, coder] = [await host.routedRow(FIRST_ASK), await host.coderRow()];
      return coder?.status === "in_progress" && task?.waitingOn === "filed" ? task : undefined;
    }, "the first routed task waits on the coder's task", 60_000);

    // Alice's project coordinator conversation is one per project: deleted and opened again, it is a new
    // conversation with a board of its own, and the first one's task is still open in the workstream.
    const runtime = await lab!.state.getRuntime();
    await runtime.stores.session.delete(host.pc);
    const again = (await createWorkforceClient(host.client).ensureWorkerSession({ worker: "project-coordinator", projectId: STOREFRONT })).id;
    await runAction(host.client, "coordinator", again, "respond", { message: SECOND_ASK });
    const waiting = await eventually(async () => host.routedRow(SECOND_ASK), "the second routed task filed", 30_000);
    expect(waiting.targetSessionId).toBe(host.workstream);

    // While the first is open, the second doesn't start, however long it waits.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await host.routedRow(SECOND_ASK))?.status).toBe("pending");
    expect(seen.turns).toHaveLength(1);

    // The coder's work ends; the first task ends; then the second starts there and ends.
    coderRuns.open();
    const firstDone = await eventually(async () => {
      const task = await host.routedRow(FIRST_ASK);
      return task?.status === "completed" ? task : undefined;
    }, "the first routed task completed", 60_000);
    const secondDone = await eventually(async () => {
      const task = await host.routedRow(SECOND_ASK);
      return task?.status === "completed" ? task : undefined;
    }, "the second routed task completed", 60_000);
    expect(first.run?.sessionId).toBe(host.workstream);
    expect(secondDone.run?.sessionId).toBe(host.workstream);
    expect(secondDone.run.startedAt).toBeGreaterThanOrEqual(firstDone.completedAt);
  }, 180_000);
});

describe("a routed task in a workstream's session that fails once its conversation is gone", () => {
  it("is said in the workstream's session, and its final failure goes to the Error Reporter", async () => {
    const atCall = gate();
    const fail = gate();
    const coderRuns = gate();
    release.push(fail.open, coderRuns.open);
    const em: GeneratorModel = {
      modelId: "test/em",
      async generate() {
        throw new Error("the owned tool loop calls generateStep");
      },
      async generateStep() {
        atCall.open();
        await fail.wait();
        throw new Error("the EM's model is down");
      },
    };
    const host = await handOn({ id: EM, em }, coderRuns, { reporter: true });
    await atCall.wait();
    const routed = (await host.routedRow(FIRST_ASK))!;
    const runtime = await lab!.state.getRuntime();
    await runtime.stores.session.delete(host.pc);
    fail.open();

    await eventually(async () => {
      const task = await host.routedRow(FIRST_ASK);
      return task?.status === "errored" || task?.status === "failed" ? task : undefined;
    }, "the routed task failed", 30_000);
    const intake = await eventually(async () => {
      const requests = await runtime.stores.request.list({ withItems: false } as never);
      const taken = requests.filter((request) => request.actionName === "intake" && JSON.stringify(request).includes(routed.id));
      return taken.length > 0 ? taken : undefined;
    }, "the failure at the Error Reporter's intake", 30_000);
    expect(intake).toHaveLength(1);
    const said = (await runtime.stores.request.list({ sessionId: host.workstream, withItems: true }))
      .flatMap((request) => ((request as { items?: Array<Record<string, unknown>> }).items ?? []))
      .filter((item) => item.type === "message")
      .map((item) => JSON.stringify(item));
    expect(said.some((text) => text.includes("couldn't be told it errored"))).toBe(true);
  }, 120_000);
});

describe("a routed task to the DevTeam's EM", () => {
  it("shows the EM's model the conversation's recent lines just before the message", async () => {
    const seen: EmSeen = { turns: [] };
    const coderRuns = gate();
    release.push(coderRuns.open);
    const host = await handOn({ id: EM, em: emModel(seen, false) }, coderRuns);
    await eventually(async () => ((await host.routedRow(FIRST_ASK))?.status === "completed" ? true : undefined), "the first routed task completed", 30_000);
    await runAction(host.client, "coordinator", host.pc, "respond", { message: SECOND_ASK });
    await eventually(async () => ((await host.routedRow(SECOND_ASK))?.status === "completed" ? true : undefined), "the second routed task completed", 30_000);
    expect(seen.turns).toHaveLength(2);
    expect(seen.turns[1]).toContain("Recent lines in the conversation with project-coordinator before this message, oldest first:");
    expect(seen.turns[1]).toContain(FIRST_ASK);
  }, 120_000);
});
