/**
 * A coding worker's own instructions, its `WORKER.md` body, reach the harness
 * its task runs on (FIX-2495).
 *
 * In process: the lab's coder flow on a real flow state, a task filed for a
 * coding worker through the board, as Chief of Staff files one, and a
 * harness-manager stub in the harness's place, which keeps the prompt it was
 * handed. Two workers with different bodies, so a prompt that carries a fixed
 * line, or another worker's body, fails.
 *
 * Red state produced before this was trusted: with the brief built from the
 * task alone (the builder before this change), neither body is in the prompt.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { AGENT_FLOW, createWorkerInstallation, defineAgentWorkerFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { CODER_FLOW, coderFlow } from "../src/flows/coder";

const USER = "alice";
const ORG = "acme";
const BODIES = {
  "plain-coder": "You run coding tasks. Leave a haiku in the commit message.",
  "careful-coder": "You run coding tasks. Never touch the lockfile.",
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A git checkout holding one commit, as the lab's working folder. */
function workingFolder(): { workdir: string; runsRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), "teammates-worker-instructions-"));
  dirs.push(dir);
  const workdir = join(dir, "workdir");
  execFileSync("git", ["init", "-q", workdir]);
  writeFileSync(join(workdir, "README.md"), "hello\n");
  // A run's question file goes under `.fsdev/`, which the manager requires the checkout to ignore.
  writeFileSync(join(workdir, ".gitignore"), "**/.fsdev/\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", workdir, "-c", "user.email=t@example.test", "-c", "user.name=T", ...args]);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return { workdir, runsRoot: join(dir, "runs") };
}

async function openLab() {
  const { workdir, runsRoot } = workingFolder();
  const stub = harnessStub({ finalMessage: "Changed the README." });
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "lead", declared: { flow: AGENT_FLOW, delegates: "all" }, body: "You file coding tasks." },
      ...Object.entries(BODIES).map(([id, body]) => ({ id, declared: { flow: CODER_FLOW, harness: "stub" }, body })),
    ],
    workerFlows: () => flows as never,
  });
  flows = {
    [AGENT_FLOW]: { flow: defineAgentWorkerFlow({ installation, model: "test/unused" }) },
    [CODER_FLOW]: coderFlow({
      harnesses: { stub: stub.slot },
      defaultHarness: "stub",
      workspace: localWorkspaceHost({
        root: runsRoot,
        remotes: { allow: [] },
        localRepositories: [workdir],
        source: () => ({ kind: "repo", repo: workdir }),
      }),
      runTimeoutMs: 30_000,
    }),
  };
  const copies = hireWorkforce(installation) as Array<{ id: string }>;
  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    // The coder holds a committed run for your review, a wait only durable execution can hold.
    durable: true,
    // Nothing graded here reaches a model: the lead's turn on the task's result and the judge fail locally, off the network.
    modelResolver: Object.assign(
      () => {
        throw new Error("no model in this test");
      },
      {
        resolveId: (id: string) => id,
        resolveEvaluationModel: () => {
          throw new Error("no model in this test");
        },
      },
    ),
    resolvePrincipal: () => ({ userId: USER, orgId: ORG }),
  } as never);
  const router = (await state.getRouter()) as any;
  const created: Response = await router.POST(
    new Request(`http://localhost/api/flows/${AGENT_FLOW}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: USER, state: { workerId: "lead" } }),
    }),
    { params: { path: [AGENT_FLOW, "sessions"] } },
  );
  expect(created.status).toBe(201);
  const lead = ((await created.json()) as { session: { id: string } }).session.id;
  const runtime = await state.getRuntime();

  /** File a coding task for `assignee` from the lead's conversation, and return the prompt its run was handed. */
  const file = async (assignee: string): Promise<string> => {
    const before = stub.runs.length;
    const filed = (await runAction({
      flow: copies.find((copy) => copy.id === AGENT_FLOW)!,
      actionName: "createTask_tasks",
      input: { title: "Add a line to the README", goal: "Add a line that says hi to README.md, and commit it.", assignee },
      userId: USER,
      orgId: ORG,
      sessionId: lead,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: { ok?: boolean; error?: string }; error?: unknown };
    expect(filed.error).toBeUndefined();
    expect(filed.output?.ok, JSON.stringify(filed.output)).toBe(true);
    for (const until = Date.now() + 30_000; Date.now() < until; await new Promise((r) => setTimeout(r, 50))) {
      if (stub.runs.length > before) return stub.runs.at(-1)!.prompt;
    }
    // The row says why: a refused start is on its `error`.
    const rows = Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, "tasks/")).map((v) => v.state);
    throw new Error(`no run started for ${assignee}'s task: ${JSON.stringify(rows).slice(0, 1500)}`);
  };
  return { stub, file, dispose: () => state.dispose() };
}

describe("a coding worker's instructions", () => {
  it("lead the brief its harness is handed, and each worker's are its own", async () => {
    const lab = await openLab();
    try {
      for (const [worker, body] of Object.entries(BODIES)) {
        const prompt = await lab.file(worker);
        // The worker's instructions come before the task they frame.
        expect(prompt).toContain(body);
        expect(prompt.indexOf(body)).toBeLessThan(prompt.indexOf("Add a line that says hi to README.md"));
        for (const other of Object.values(BODIES).filter((b) => b !== body)) expect(prompt).not.toContain(other);
      }
      expect(lab.stub.runs).toHaveLength(2);
    } finally {
      await lab.dispose();
    }
  }, 60_000);
});
