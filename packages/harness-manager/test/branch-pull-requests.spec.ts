/**
 * The manager's turn-end check for the run's pull requests (FIX-2268).
 *
 * Driven end to end, in process, on the dotted-board host's shape: a real
 * task board, its same-flow dispatch and a real git checkout. The harness is a
 * fake that opens nothing a recorder could read, and `gh` is a stub on `PATH`
 * that knows two pull requests on the run's branch: one opened during the run,
 * and one merged long before it.
 *
 * What a reader of a coding task relies on: when the run ends, a pull request
 * on its branch is on the run session's record, stamped with the run's
 * request, whichever way the agent opened it, and one opened before the run is
 * not claimed as the run's. A run that failed is checked too.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { OBSERVED_PULL_REQUESTS, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, type Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessManager, harnessTaskInputSchema, type HarnessFeeds } from "../src";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";
import { heard } from "./heard";

const BOARD_ID = "branch-prs";
const ORG_ID = "org_branch_prs";
const ISSUE = "FIX-7";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

const dirs: string[] = [];
let ghLog: string;
const PATH = process.env.PATH;

beforeAll(() => {
  const bin = mkdtempSync(join(tmpdir(), "harness-manager-gh-"));
  dirs.push(bin);
  ghLog = join(bin, "calls.log");
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(ghLog)}, process.argv[3] + "\\n");
process.stdout.write(JSON.stringify([
  { number: 96, html_url: "https://github.com/acme/app/pull/96", title: "From the branch", state: "open", draft: false, merged_at: null, created_at: new Date().toISOString(), head: { ref: "b" } },
  { number: 12, html_url: "https://github.com/acme/app/pull/12", title: "An earlier run's", state: "closed", draft: false, merged_at: "2024-01-02T00:00:00Z", created_at: "2024-01-01T00:00:00Z", head: { ref: "b" } },
]));
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
});

afterAll(() => {
  process.env.PATH = PATH;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function host(outcome: "completed" | "throws") {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-branch-prs-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);
  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const runs: Array<{ session: string; request: string }> = [];
  const harness = (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "fake-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (_input, ctx) => {
        await feeds.cwd(ctx as never);
        runs.push({ session: ctx.session.identity.id, request: ctx.request.identity.id });
        await feeds.onSession("sess_fake", ctx as never);
        if (outcome === "throws") throw new Error("the agent crashed");
        return {
          source: "fake/test",
          status: outcome,
          sessionId: "sess_fake",
          url: null,
          dispatchedAt: Date.now(),
          outcome: "finished" as const,
          finalMessage: null,
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: { phase: PHASE, buildPrompt: () => "go", isDone: () => true },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness,
  });
  const board = taskBoard({
    name: "branch-prs-board",
    boardId: "branch-prs-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    workers: { coder: dispatcher({ name: "branch-prs-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "branch-prs-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["branch-prs-board"];
      await tasks.createTask({ id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", maxAttempts: 1 });
      return { id: TASK_ID };
    },
  });
  const flow = defineFlow({
    internal: { actions: { ...heard } },
    kind: "branch-prs-host",
    actions: { seed: { block: seed }, drain: { block: board.drain } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "branch-prs-host" } as never);
  const state = createFlowState({
    flows: { "branch-prs-host": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
  } as never);
  const runtime = () => (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();
  const act = async (action: string) => {
    const rt = await runtime();
    await runAction({ flow, actionName: action, input: {}, userId: "alice", orgId: ORG_ID, sessionId: "s_alice", stores: rt.stores, runtimeConfig: { ...rt.runtimeConfig } } as never);
  };
  const settled = async (): Promise<Task> => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const rt = await runtime();
      const row = (await rt.stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as Task | undefined;
      if (row !== undefined && row.status !== "in_progress" && row.status !== "pending") return row;
      if (Date.now() > deadline) throw new Error(`the row never settled (${row?.status})`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const pullRequests = async (session: string) => {
    const rt = await runtime();
    return rt.stores.resourceState.getByPrefix("session", session, `${OBSERVED_PULL_REQUESTS}/`) as Promise<Record<string, { state: Record<string, unknown> }>>;
  };
  return { act, settled, runs, pullRequests };
}

describe("the run's pull requests, checked on its branch when it ends", () => {
  it("puts a pull request on the run's branch on the run session's record, stamped with the run's request", async () => {
    const h = host("completed");
    await h.act("seed");
    await h.act("drain");
    await h.settled();
    const [run] = h.runs;
    const rows = await h.pullRequests(run!.session);
    expect(Object.keys(rows)).toEqual([`${OBSERVED_PULL_REQUESTS}/github.com/acme/app/96`]);
    expect(Object.values(rows)[0]!.state).toMatchObject({ source: "branch", requestId: run!.request, title: "From the branch" });
    expect(readFileSync(ghLog, "utf8")).toMatch(/head=\{owner\}:[^&]*FIX-7/i);
  });

  it("checks the branch of a run whose harness threw, too", async () => {
    const h = host("throws");
    await h.act("seed");
    await h.act("drain");
    await h.settled();
    const rows = await h.pullRequests(h.runs[0]!.session);
    expect(Object.keys(rows)).toEqual([`${OBSERVED_PULL_REQUESTS}/github.com/acme/app/96`]);
  });
});
