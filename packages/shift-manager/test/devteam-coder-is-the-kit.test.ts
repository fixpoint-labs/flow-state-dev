/**
 * Shift Manager's coder is the harness kit's `coder` flow, and it routes and
 * keys runs as Shift Manager's own coding flow did, on the real Lab.
 *
 * Four rows a coordinator files for the coder, each in a conversation of its
 * own on a project, and what each must come to:
 *
 * - **No feature marker**: a question. It runs in the `answer` mode, keyed
 *   `<board>/<task>/answer`, and settles on its answer.
 * - **A feature marker naming its phase** (`{ issue, phase: "implement" }`,
 *   the shape the EM files): the `implement` mode, keyed `…/implement`, done
 *   on a commit.
 * - **A feature marker naming no phase**: `implement` too, keyed by the mode's
 *   own name.
 * - **A malformed marker** (a phase and no issue): refused inside the run, so
 *   the task ends `errored`, never runs as an answer, and keys no run.
 *
 * The keys are the ones Shift Manager's runs were always stored under, so a
 * run started before the move is found where it was (BP-030). And the coder is
 * the kit's: its session answers the kit's `harness` read with the harness the
 * run ran on, and the readiness view lists exactly the harnesses the coder
 * runs.
 *
 * The coordinator's judgment is scripted, one tool call per step; the coder's
 * harness is a stub that commits a file and answers.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessStub, taskIssueSegment } from "@flow-state-dev/harness-manager";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { LIST_TASKS_ACTION } from "../src/lib/conversation-tasks";
import { connect } from "../src/lib/connection";
import { readyHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { BASE_REF, createBareRemote, createScratchRepo } from "../teams/devteam/scratch-repo.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const OWNER = LAB_USERS.owner;
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const SANDBOX = { visibility: "shared", id: "sandbox" } as const;
const ANSWER = "The badge is in header.tsx.";

let opened: Lab | undefined;
let served: ServedLab | undefined;
afterEach(async () => {
  await served?.handle.close();
  served = undefined;
  await opened?.dispose();
  opened = undefined;
});

type ToolCall = { toolName: string; args: Record<string, unknown> };

/** The coordinator's judgment: a user's message keyed in `calls` is filed once, with that call; every other step stops. */
function filing(calls: Record<string, ToolCall>): ModelResolver {
  const filed = new Set<string>();
  let step = 0;
  const judgment: GeneratorModel = {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages?: unknown[] }) {
      step += 1;
      const seen = JSON.stringify(options.messages ?? []);
      const message = Object.keys(calls).find((text) => seen.includes(text) && !filed.has(text));
      if (message === undefined) return { text: "Filed.", finishReason: "stop" };
      filed.add(message);
      return { toolCalls: [{ toolCallId: `t${step}`, ...calls[message]! }], finishReason: "tool-calls" };
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

async function act(lab: Lab, flow: string, sessionId: string, actionName: string, input: unknown) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(flow) as FlowInstance,
    actionName,
    input,
    userId: OWNER.userId,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

/** File one task through a fresh conversation with the Shift Coordinator; return its stored row once it settles. */
async function fileAndSettle(lab: Lab, message: string): Promise<Record<string, any>> {
  const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", "coordinator/sessions", {
    body: { userId: OWNER.userId, sessionId, state: { workerId: "shift-coordinator" } },
  });
  expect(created.status).toBe(201);
  expect((await act(lab, "coordinator", sessionId, "respond", { message })).error).toBeUndefined();
  const listed = await eventually(async () => {
    const tasks = ((await act(lab, "coordinator", sessionId, LIST_TASKS_ACTION, {})).output?.tasks ?? []) as Array<Record<string, any>>;
    return ["completed", "errored", "cancelled", "failed"].includes(tasks[0]?.status) ? tasks[0] : undefined;
  }, "the task to settle", 30_000);
  return (Object.values(await lab.stored("user", "tasks/")) as Array<Record<string, any>>).find((task) => task.id === listed.id)!;
}

/** The mode segments a task's runs are stored under: the last segment of each run record key for its task. */
async function runSegmentsOf(lab: Lab, taskId: string): Promise<string[]> {
  const issue = taskIssueSegment(taskId);
  return Object.keys(await lab.stored("user", "runs/"))
    .map((key) => key.split("/"))
    .filter((parts) => parts.at(-2) === issue)
    .map((parts) => parts.at(-1)!);
}

describe("Shift Manager's coder is the harness kit's coder flow", () => {
  it("routes and keys each row as Shift Manager's own flow did, and runs on the kit", async () => {
    const stub = harnessStub({
      duringRun: (run) => {
        writeFileSync(join(run.cwd, "NOTE.md"), `a change ${Math.random()}\n`);
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "NOTE.md"], { cwd: run.cwd });
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "a change"], { cwd: run.cwd });
      },
      finalMessage: ANSWER,
    });
    const other = harnessStub({ finalMessage: "ran on codex" });
    const task = (goal: string, input: Record<string, unknown>): ToolCall => ({
      toolName: "createTask",
      args: { goal, assignee: "eng.coder", input: { ...input, project: STOREFRONT } },
    });
    const remote = createBareRemote("coder-is-the-kit", { seed: { "README.md": "storefront\n" } });
    opened = await openLab({
      modelResolver: filing({
        "where is the cart badge?": task("Which file renders the cart badge?", {}),
        "show a badge on the cart": task("Show a badge on the cart", { mode: "implement", issue: "FIX-7" }),
      }),
      stores: inMemoryStores(),
      harnesses: [readyHarness(stub.slot, "stub"), readyHarness(other.slot, "codex", "Codex")],
      defaultHarness: "stub",
      runTimeoutMs: 30_000,
      workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coder-is-the-kit-")), remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
      inventory: true,
      withoutJudge: true,
      projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url }],
    });
    const lab = opened;

    // A question: the answer mode, keyed as answer runs always were.
    const question = await fileAndSettle(lab, "where is the cart badge?");
    expect(question.status, JSON.stringify(question.lastError ?? null)).toBe("completed");
    expect(question.output?.answer).toBe(ANSWER);
    expect(await runSegmentsOf(lab, question.id)).toEqual(["answer"]);

    // Feature work, as the EM files it: the implement mode on its issue, keyed by the mode's name.
    const named = await fileAndSettle(lab, "show a badge on the cart");
    expect(named.status, JSON.stringify(named.lastError ?? null)).toBe("completed");
    expect(named.input).toMatchObject({ mode: "implement", issue: "FIX-7" });
    expect(await runSegmentsOf(lab, named.id)).toEqual(["implement"]);
    expect(other.runs).toHaveLength(0);

    // The coder is the kit's: the run's session reads the harness it ran on through the kit's own action.
    const ran = await act(lab, "coder", question.run.sessionId, "harness", {});
    expect(ran.error).toBeUndefined();
    expect(ran.output).toEqual({ harness: "stub" });

    // And the readiness view lists exactly the harnesses the coder runs.
    served = await serveLab(lab.state);
    const client = connect({ userId: OWNER.userId, baseUrl: served.baseUrl, bearerToken: OWNER.bearer });
    const entries = (await client.view(harnessReadinessViewRef("harnesses"), {})).value;
    expect(entries.map((entry) => entry.harness)).toEqual(["stub", "codex"]);
  }, 180_000);

  it("on a fixed repository, still answers a question in its project, as the fork's answer manager did", async () => {
    // The answer mode works in the `answers` host, which reads the task's project whatever the Lab's
    // workspace is; only a project with no repository can answer on a Lab with one fixed repository.
    const stub = harnessStub({ finalMessage: ANSWER });
    const dirs = createScratchRepo("coder-is-the-kit-fixed");
    opened = await openLab({
      modelResolver: filing({ "what is in the sandbox?": { toolName: "createTask", args: { goal: "What is in the sandbox?", assignee: "eng.coder", input: { project: SANDBOX } } } }),
      stores: inMemoryStores(),
      harnesses: [readyHarness(stub.slot)],
      runTimeoutMs: 30_000,
      workspace: { root: dirs.root, repo: dirs.sourceRepo, baseRef: BASE_REF },
      coderWorkerId: "eng.coder",
      inventory: true,
      withoutJudge: true,
      projects: [{ id: SANDBOX.id, title: "Sandbox" }],
    });
    const question = await fileAndSettle(opened, "what is in the sandbox?");
    expect(question.status, JSON.stringify(question.lastError ?? question.error ?? null)).toBe("completed");
    expect(question.output?.answer).toBe(ANSWER);
    expect(stub.runs).toHaveLength(1);
    expect(await runSegmentsOf(opened, question.id)).toEqual(["answer"]);
  }, 120_000);

  it("on a fixed repository, still files a question that names no project, as main did: the answer mode's project is its run's, not the filing's", async () => {
    const stub = harnessStub({ finalMessage: ANSWER });
    const dirs = createScratchRepo("coder-is-the-kit-fixed-no-project");
    opened = await openLab({
      modelResolver: filing({ "what is in the repo?": { toolName: "createTask", args: { goal: "What is in the repo?", assignee: "eng.coder" } } }),
      stores: inMemoryStores(),
      harnesses: [readyHarness(stub.slot)],
      runTimeoutMs: 30_000,
      workspace: { root: dirs.root, repo: dirs.sourceRepo, baseRef: BASE_REF },
      coderWorkerId: "eng.coder",
      inventory: true,
      withoutJudge: true,
    });
    // Filed, not refused at filing for want of a project (no `no_project`): its run then needs one, as the fork's did.
    const question = await fileAndSettle(opened, "what is in the repo?");
    expect(question.goal).toBe("What is in the repo?");
    expect(JSON.stringify(question.lastError ?? question.error ?? "")).not.toContain("no_project");
  }, 120_000);
});
