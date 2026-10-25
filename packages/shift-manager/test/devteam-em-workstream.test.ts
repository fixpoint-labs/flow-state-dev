/**
 * The DevTeam's EM files from a workstream it leads, on the Lab as served,
 * through Shift Manager's own code against the Lab's routes.
 *
 * Alice opens the `feature` workstream on Storefront herself, with the EM as
 * its lead. Her Storefront project coordinator hands a two-part job to it,
 * and the EM adds the coder's two tasks from that workstream session with
 * `addTask`, each naming its issue and its phase. The tasks run as coding
 * runs in checkouts of Storefront's repository; each one's end reaches the
 * workstream session once; and the EM updates the workstream entry, whose
 * report Alice's project screen reads.
 *
 * The run finds Storefront through the workstream session it was filed
 * from, with no claim row anywhere and a Storefront row an earlier version
 * wrote, still carrying a list the project no longer has.
 *
 * The models are scripted by block: the project coordinator's judgment
 * (`coordinator-judgment`) hands the message on as a routed task; the EM's
 * turn files on the turn the routed task starts and updates the entry on each
 * later one; Jev answers `done`.
 * The coder's harness is a stub that commits a file.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeUserSegment, type GeneratorModel, type ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { runAction } from "../src/lib/action";
import type { Client } from "@flow-state-dev/client";
import { connect } from "../src/lib/connection";
import { readEntryReport, readProject, type ProjectAddress } from "../src/lib/projects";
import { createLabReader, readerSessionId } from "../src/lib/reads";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { harnessStub } from "../teams/devteam/harness-stub.mts";
import { LAB_ORG_ID, LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { commitAll, createBareRemote } from "../teams/devteam/scratch-repo.mts";
import { EM_TURN } from "../teams/devteam/workforce/flows/workers/em.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const STOREFRONT: ProjectAddress = { visibility: "shared", id: "storefront" };
const ALICE = LAB_USERS.owner;
const EM = "eng.em";
const CODER = "eng.coder";
const ISSUES = ["guest-cart", "guest-checkout"] as const;
const REPORT = "Both parts of guest checkout are in.";

type ToolCall = { toolName: string; args: Record<string, unknown> };

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

/** The last message's text, as the model is handed it. */
function lastText(messages: unknown[]): string {
  return JSON.stringify(messages.at(-1) ?? null);
}

/**
 * The EM's turn. A turn that starts on the routed task files the coder's two
 * tasks; each later turn (a task's end heard) updates the workstream entry.
 * `turns` records what started each turn; `prompts`, everything each turn's
 * first call was handed.
 */
function emModel(turns: string[], prompts: string[]): GeneratorModel {
  let queue: ToolCall[] = [];
  let step = 0;
  return {
    modelId: "test/em",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages: unknown[] }) {
      const last = options.messages.at(-1) as { role?: string } | undefined;
      if (last?.role !== "tool") {
        // A new turn: what it is depends on whether it is the first.
        turns.push(lastText(options.messages));
        prompts.push(JSON.stringify(options.messages));
        queue =
          turns.length === 1
            ? ISSUES.map((issue) => ({
                toolName: "createTask",
                args: { goal: `Build ${issue}.`, assignee: CODER, input: { issue, phase: "implement" } },
              }))
            : [{ toolName: "updateWorkstream", args: { report: REPORT } }];
      }
      const call = queue.shift();
      step += 1;
      if (call === undefined) return { text: "Noted.", finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `em-${step}`, ...call }], finishReason: "tool-calls" };
    },
  };
}

/** Jev, always `done`; best fit's route is never picked, so the coordinator's own judgment takes a message. */
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

function scripted(emTurns: string[], emPrompts: string[] = []): ModelResolver {
  const judgment = stepping("test/judgment", [
    {
      toolName: "createTask",
      args: { goal: "Add guest checkout", assignee: EM, target: "shared/storefront/feature", session: "ongoing", resultTo: "conversation" },
    },
  ], "Handed on.");
  const em = emModel(emTurns, emPrompts);
  const helper = stepping("test/helper", [], "On it.");
  return Object.assign(
    (_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : block === EM_TURN ? em : helper),
    { resolveId: (id: string) => id, resolveEvaluationModel: () => judge },
  ) as unknown as ModelResolver;
}

let lab: Lab | undefined;
let served: ServedLab | undefined;
let root: string | undefined;

afterEach(async () => {
  await served?.handle.close();
  await lab?.dispose();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  lab = undefined;
  served = undefined;
  root = undefined;
});

describe("the EM files from the workstream it leads", () => {
  it("files the coder's tasks from Alice's `feature` session, hears each end there once, and updates the entry", async () => {
    const emTurns: string[] = [];
    const emPrompts: string[] = [];
    const remote = createBareRemote("em-workstream", { seed: { "README.md": "storefront\n" } });
    const stub = harnessStub({
      finalMessage: "Done.",
      duringRun: async (run) => {
        writeFileSync(join(run.cwd, `${globalThis.crypto.randomUUID()}.md`), "work\n");
        commitAll(run.cwd, "the part");
      },
    });
    root = mkdtempSync(join(tmpdir(), "sm-em-workstream-"));
    lab = await openLab({
      modelResolver: scripted(emTurns, emPrompts),
      stores: inMemoryStores(),
      harness: stub.slot,
      runTimeoutMs: 30_000,
      workspace: { root, remotes: { allow: ["file"] } },
      coderWorkerId: CODER,
      inventory: true,
      projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url, members: [LAB_USERS.member.userId] }],
      // As shipped: the seed's own `feature` is the other project member's, so Alice's coordinator can't hand to it.
      workstreams: [{ as: "member", input: { project: STOREFRONT, id: "feature", title: "Feature", lead: EM } }],
    });
    const runtime = await lab.state.getRuntime();
    const org = runtime.stores.resourceState;

    // A Storefront row an earlier version wrote, with a list the project no longer has, and a claim row: both from before.
    const row = await org.get("org", LAB_ORG_ID, "projects/storefront");
    expect(row).toBeDefined();
    await org.set("org", LAB_ORG_ID, "projects/storefront", { ...row!.state, workstreams: ["eng.feature"] }, row!.version);
    await org.set("org", LAB_ORG_ID, "workstream-claims/eng.feature", { project: "storefront" }, "any");
    // The claim rows are deleted: nothing reads them, so the run below still finds its project.
    for (const key of Object.keys(await org.getByPrefix("org", LAB_ORG_ID, "workstream-claims/"))) {
      const at = await org.get("org", LAB_ORG_ID, key);
      await org.delete("org", LAB_ORG_ID, key, at!.version);
    }
    expect(await org.getByPrefix("org", LAB_ORG_ID, "workstream-claims/")).toEqual({});

    served = await serveLab(lab.state);
    const client: Client = connect({ userId: ALICE.userId, baseUrl: served.baseUrl, bearerToken: ALICE.bearer });
    await createLabReader(client).read();
    const reader = readerSessionId(ALICE.userId, "projects");

    // Alice opens `feature` herself, with the EM as its lead, through the route the app opens one with.
    await runAction(client, "projects", reader, "openWorkstream", { project: STOREFRONT, id: "feature", title: "Feature", lead: EM });
    const hers = (await readProject(client, reader, STOREFRONT))!.entries.find((e) => e.owner === ALICE.userId && e.id === "feature")!;
    expect(hers).toMatchObject({ lead: EM });
    const workstream = hers.sessionId!;
    expect(workstream).toBeTruthy();

    // Her Storefront project coordinator hands the job to her `feature` workstream.
    const pc = (await createWorkforceClient(client).ensureWorkerSession({ worker: "project-coordinator", projectId: STOREFRONT })).id;
    await runAction(client, "coordinator", pc, "respond", { message: "Add guest checkout: first the guest cart, then the checkout." });

    // The EM filed one task per part, from the workstream session, on that session's board; each ran and completed.
    const settled = await eventually(async () => {
      // The routed task to the EM is a row on the project coordinator's board, its brief sealed on it; the coder's tasks are the rest.
      const rows = (Object.values(await lab!.stored("user", "tasks/")) as Array<Record<string, any>>).filter((r) => r.sealed?.postId === undefined);
      return rows.length === ISSUES.length && rows.every((r) => r.status === "completed") ? rows : undefined;
    }, "both tasks completed", 60_000);
    expect(settled.map((r) => r.input).sort((a, b) => a.issue.localeCompare(b.issue))).toEqual(
      ISSUES.map((issue) => ({ issue, phase: "implement" })),
    );
    expect(settled.every((r) => r.assignee === CODER)).toBe(true);
    // The EM was told its workstream's project before it filed, so it never has to guess one.
    expect(emPrompts[0]).toContain(JSON.stringify('the shared project "storefront"').slice(1, -1));
    // Every row is on the workstream session's board: none filed anywhere else.
    expect(Object.keys(await lab.stored("user", `tasks/${encodeUserSegment(`${workstream}~`)}`))).toHaveLength(ISSUES.length);
    // Each ran in a checkout of Storefront's repository, found through the workstream.
    expect(stub.runs).toHaveLength(ISSUES.length);

    // Each task's end reached the workstream session once: one EM turn per task, after the filing turn.
    await eventually(async () => (emTurns.length === 1 + ISSUES.length ? true : undefined), "each end heard", 30_000);
    for (const task of settled) {
      expect(emTurns.slice(1).filter((turn) => turn.includes(task.id as string)), `${task.id} heard`).toHaveLength(1);
    }

    // The EM updated her entry, and her project screen reads the report.
    const entry = (await readProject(client, reader, STOREFRONT))!.entries.find((e) => e.owner === ALICE.userId && e.id === "feature")!;
    expect(await readEntryReport(client, reader, STOREFRONT, entry)).toBe(REPORT);

    // Every session the job made is Alice's: her workstream session, and each task's session under it.
    const sessions = await runtime.stores.session.list({ orgId: LAB_ORG_ID, parentage: "all" });
    const tasks = sessions.filter((s) => s.parentSessionId === workstream);
    expect(tasks.length).toBeGreaterThanOrEqual(ISSUES.length);
    expect([workstream, ...tasks.map((s) => s.id)].every((id) => sessions.find((s) => s.id === id)?.userId === ALICE.userId)).toBe(true);
    // No claim row came back.
    expect(await org.getByPrefix("org", LAB_ORG_ID, "workstream-claims/")).toEqual({});

    // The routed task that handed the job to the EM ends once the work it filed has ended (FIX-2083, rule 6),
    // so the EM's answer lands in her project coordinator conversation and the workstream session is free
    // for her next ask.
    const routed = await eventually(async () => {
      const rows = (Object.values(await lab!.stored("user", "tasks/")) as Array<Record<string, any>>).filter((r) => r.sealed?.postId !== undefined);
      return rows.length === 1 && rows[0]!.status === "completed" ? rows[0]! : undefined;
    }, "the routed task completed", 30_000);
    expect(routed.targetSessionId).toBe(workstream);
    const emLines = async () =>
      (await runtime.stores.request.list({ sessionId: pc, withItems: true }))
        .flatMap((r) => ((r as { items?: any[] }).items ?? []))
        .filter((item) => item.type === "message" && item.agentName === EM);
    await eventually(async () => ((await emLines()).length > 0 ? true : undefined), "the EM's answer in her conversation", 10_000);
    expect(await emLines()).toHaveLength(1);
  }, 120_000);
});
