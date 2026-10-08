/**
 * A run's repository work held at each save point, and brought back on
 * another machine (FIX-1766).
 *
 * Driven end to end like `workspace-host.spec.ts`: a real flow, board and
 * hand-off, and real `localWorkspaceHost`s. Two host roots stand in for two
 * machines; they share one `file://` remote and one held-work folder, and the
 * manager's workspace is switched from one to the other between attempts.
 * Only the harness is a stub.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { defineCapability, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  fileHeldWorkStore,
  localWorkspaceHost,
  type HeldWorkStore,
  type PlaceRequest,
  type RunSourceAnswer,
  type WorkspaceHost,
} from "@flow-state-dev/workspace";
import { harnessManager, harnessTaskInputSchema, runOwnerDispatcher, type HarnessFeeds } from "../src";
import { answerQuestion, inboxCollection, listQuestions } from "../src/inbox";
import { harnessTaskId } from "../src/workspace";
import { seedRepo } from "./fixtures";

vi.setConfig({ testTimeout: 90_000 });

const BOARD_ID = "eng.feature.work";
const ORG_ID = "org_held";
const ALICE = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK_ID = harnessTaskId(ISSUE, PHASE);
const PREFIX = "worktree-overlay/org/org_held/project-1";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * What one attempt does in the directory it is handed.
 *
 * - `write` / `write-ask` / `write-throw` — writes `notes.md` (turn N), then finishes, asks, or the harness throws.
 * - `read` — records `notes.md` as it found it, then finishes.
 */
type Step = "write" | "write-ask" | "write-throw" | "read";

interface Seen {
  step: Step;
  notes: string | null;
  prompt: string;
}

function repository(dir: string): string {
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  seedRepo(repo);
  return pathToFileURL(repo).href;
}

function lab(options: { script: Step[]; maxAttempts?: number; held?: "on" | "off" }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-held-"));
  dirs.push(dir);
  const remote = repository(dir);
  const storeDir = join(dir, "held-work");
  const folder = fileHeldWorkStore({ dir: storeDir });
  // The store the hosts use: the folder, behind switches a test flips.
  const faults = { put: false, delete: false };
  const calls: string[] = [];
  let observe: ((call: string) => Promise<void>) | undefined;
  const store: HeldWorkStore = {
    put: async (key, bytes) => {
      await observe?.(`put ${key}`);
      calls.push(`put ${key}`);
      if (faults.put) throw new Error("the held-work store is unavailable");
      return folder.put(key, bytes);
    },
    get: (key) => folder.get(key),
    delete: async (key) => {
      await observe?.(`delete ${key}`);
      calls.push(`delete ${key}`);
      if (faults.delete) throw new Error("the held-work store refused the delete");
      return folder.delete(key);
    },
    list: (prefix) => folder.list(prefix),
  };
  const inboxCapability = defineCapability({ name: "held-inbox", resources: { inbox: inboxCollection } });
  const answer = (): RunSourceAnswer => ({ kind: "repo", repo: remote, baseRef: "main", heldPrefix: PREFIX });
  const machine = (name: string, heldWork: HeldWorkStore | null) =>
    localWorkspaceHost({
      root: join(dir, `machine-${name}`),
      remotes: { allow: ["file"] },
      source: answer,
      provisionTimeoutMs: 30_000,
      ...(heldWork !== null ? { heldWork } : {}),
    });
  const machines: Record<string, WorkspaceHost> = {
    A: machine("A", options.held === "off" ? null : store),
    B: machine("B", options.held === "off" ? null : store),
    "B-off": machine("B", null),
  };
  let current = machines.A!;
  const provisions: PlaceRequest[] = [];
  const placeStates: string[] = [];
  // The manager's one host, switched between machines between attempts.
  const workspace: WorkspaceHost = {
    get root() {
      return current.root;
    },
    source: answer,
    provisionTimeoutMs: 30_000,
    locate: (a, r) => current.locate(a, r),
    provision: async (a, r) => {
      provisions.push(r);
      placeStates.push(`${(await record()).place?.state}`);
      const progress = r.progress;
      const place = await current.provision(a, {
        ...r,
        ...(progress !== undefined
          ? {
              progress: async (reported: "lost" | "restoring") => {
                await progress(reported);
                placeStates.push(`${(await record()).place?.state}`);
              },
            }
          : {}),
      });
      return place;
    },
    save: (p) => current.save(p),
    hostId: () => current.hostId(),
    holds: (a) => current.holds(a),
    checkpoint: (p, r) => current.checkpoint(p, r),
    dropHeld: (p, k) => current.dropHeld(p, k),
    restore: (p) => current.restore(p),
    release: (p) => current.release(p),
  };

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const seen: Seen[] = [];
  let attempt = 0;
  const harness = (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "stub-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (input, ctx) => {
        const cwd = feeds.cwd(ctx as never);
        const step = options.script[seen.length] ?? "write";
        attempt += 1;
        const notesPath = join(cwd, "notes.md");
        seen.push({ step, notes: existsSync(notesPath) ? readFileSync(notesPath, "utf8") : null, prompt: input.prompt });
        if (step !== "read") writeFileSync(notesPath, `turn ${attempt}\n`);
        if (step === "write-ask") {
          const marker = /write it as the entire contents of this file:\n {2}(\S+)/.exec(input.prompt)?.[1];
          mkdirSync(dirname(marker!), { recursive: true });
          writeFileSync(marker!, "Which option?");
        }
        if (step === "write-throw") throw new Error("the harness crashed");
        return {
          source: "stub/test",
          status: "completed" as const,
          sessionId: `sess_${seen.length}`,
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
    phase: {
      phase: PHASE,
      buildPrompt: (run) =>
        [`Work on ${run.issue}, attempt ${run.attempt}.`, "To ask, write it as the entire contents of this file:", `  ${run.askMarkerPath}`].join("\n"),
      isDone: () => true,
    },
    workspace,
    runTimeoutMs: 30_000,
    ownership: { pollMs: 25 },
    harness,
  });
  const board = taskBoard({
    name: "held-board",
    boardId: "held-board",
    collection: ledger,
    concurrency: 1,
    onReview: "exit",
    dispatcher: runOwnerDispatcher(),
    workers: { coder: dispatcher({ name: "held-board-hand-off", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "held-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["held-board"];
      await tasks.addTask({
        id: TASK_ID,
        goal: "the feature",
        input: { issue: ISSUE, phase: PHASE },
        assignee: "coder",
        maxAttempts: options.maxAttempts ?? 1,
      });
      return { id: TASK_ID };
    },
  });
  // A person answers the run's open question, and the row goes back in the queue.
  const answerOpen = handler({
    name: "held-answer",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    uses: [board.capability, inboxCapability],
    execute: async (_input, ctx) => {
      const open = (await listQuestions(ctx as never, ISSUE, PHASE)).filter((q) => q.state.status === "open");
      for (const q of open) await answerQuestion(ctx as never, q.topic, "go ahead");
      const tasks = await getOrCreateTaskCollection({
        ctx: ctx as never,
        backing: "resource",
        collectionId: BOARD_ID,
        collection: resolveResourceCollection(ctx as never, BOARD_ID)!,
      });
      await tasks.unpark(TASK_ID, "go ahead");
      return {};
    },
  });
  const flow = defineFlow({
    kind: "held-flow",
    actions: { seed: { block: seed }, drain: { block: board.drain }, answer: { block: answerOpen } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "held-flow" } as never);
  const state = createFlowState({
    flows: { "held-flow": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 90_000,
  } as never);
  const runtime = async () =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();

  const act = async (action: string): Promise<void> => {
    const rt = await runtime();
    const result = await runAction({
      flow,
      actionName: action,
      input: {},
      userId: ALICE,
      orgId: ORG_ID,
      sessionId: `s_${ALICE}`,
      requestId: `req_${action}_${Math.random().toString(36).slice(2)}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never);
    const failed = (result as { items?: Array<{ type: string; status?: string; error?: { message: string } }> }).items?.find(
      (item) => item.type === "block_trace" && item.status === "failed",
    );
    if (action === "answer" && failed !== undefined) throw new Error(failed.error?.message);
  };

  const row = async (): Promise<Task | undefined> => {
    const rt = await runtime();
    return (await rt.stores.resourceState.get("org", ORG_ID, `${BOARD_ID}/${TASK_ID}`))?.state as Task | undefined;
  };

  const settled = async (status: Task["status"]): Promise<Task> => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const current = await row();
      if (current?.status === status) return current;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${status}; row is ${JSON.stringify(current)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const RECORD_SCOPE = `${ALICE}:~org:${ORG_ID}`;
  const recordEntry = async (): Promise<[string, Record<string, any>] | undefined> => {
    const rt = await runtime();
    const rows = await rt.stores.resourceState.getByPrefix("user", RECORD_SCOPE, "runs/");
    const [key, value] = Object.entries(rows)[0] ?? [];
    return key === undefined ? undefined : [key, (value as { state: Record<string, any> }).state];
  };
  const record = async (): Promise<Record<string, any>> => (await recordEntry())?.[1] ?? {};
  const rewriteRecord = async (patch: Record<string, unknown>): Promise<void> => {
    const [key, value] = (await recordEntry())!;
    const rt = await runtime();
    await rt.stores.resourceState.set("user", RECORD_SCOPE, key, { ...value, ...patch }, "any");
  };

  const questions = async (): Promise<string[]> => {
    const rt = await runtime();
    const rows = await rt.stores.resourceState.getByPrefix("user", RECORD_SCOPE, "inbox/");
    return Object.values(rows).map((r) => (r as { state: { question: string } }).state.question);
  };

  return {
    act,
    settled,
    record,
    rewriteRecord,
    questions,
    seen,
    calls,
    faults,
    provisions,
    placeStates,
    keys: () => folder.list(PREFIX),
    tamper: (key: string, bytes: Uint8Array) => folder.put(key, bytes),
    pack: (key: string) => folder.get(key),
    use: (name: keyof typeof machines | string) => {
      current = machines[name]!;
    },
    lose: (name: string) => rmSync(join(dir, `machine-${name}`), { recursive: true, force: true }),
    hostId: (name: string) => machines[name]!.hostId(),
    heldDir: (name: string) => {
      const places = join(dir, `machine-${name}`);
      const found: string[] = [];
      const walk = (path: string) => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          if (entry.name === "held" && entry.isDirectory()) found.push(join(path, entry.name));
          else if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "checkout") walk(join(path, entry.name));
        }
      };
      walk(places);
      return found[0];
    },
    observe: (fn: (call: string) => Promise<void>) => {
      observe = fn;
    },
  };
}

describe("holding off is today's run (BR-28)", () => {
  it("writes no place and no held work, and hands the host the call it always got", async () => {
    const run = lab({ script: ["write"], held: "off" });
    await run.act("seed");
    await run.act("drain");
    await run.settled("completed");

    const record = await run.record();
    expect(record.place).toBeNull();
    expect(record.held).toBeNull();
    expect(run.calls).toEqual([]);
    expect(run.provisions.every((r) => !("recorded" in r) && !("progress" in r))).toBe(true);
  });
});

describe("a run's work is held at every save point (BR-1, BR-6, Q1)", () => {
  it("at the end of a turn that completed, after which the record names the pack", async () => {
    const run = lab({ script: ["write"] });
    await run.act("seed");
    await run.act("drain");
    await run.settled("completed");

    const record = await run.record();
    const keys = await run.keys();
    expect(keys).toHaveLength(1);
    expect(record.held).toMatchObject({ attempt: 1, key: keys[0], error: null, parked: false });
    expect(record.place).toEqual({ host: run.hostId("A"), state: "ready" });
  });

  it("when the run parks on a question", async () => {
    const run = lab({ script: ["write-ask"] });
    await run.act("seed");
    await run.act("drain");
    await run.settled("parked");
    const keys = await run.keys();
    expect(keys).toHaveLength(1);
    expect((await run.record()).held?.key).toBe(keys[0]);
  });

  it("when the harness fails", async () => {
    const run = lab({ script: ["write-throw"] });
    await run.act("seed");
    await run.act("drain");
    await run.settled("errored");
    const keys = await run.keys();
    expect(keys).toHaveLength(1);
    expect((await run.record()).held?.key).toBe(keys[0]);
  });

  it("writes the pack, then switches the record, then drops only the key it replaced", async () => {
    const run = lab({ script: ["write-throw", "write"], maxAttempts: 2 });
    const seenAt: Record<string, string | null> = {};
    run.observe(async (call) => {
      seenAt[call] = (await run.record()).held?.key ?? null;
    });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    const first = (await run.record()).held.key as string;
    await run.act("drain");
    await run.settled("completed");
    const second = (await run.record()).held.key as string;

    expect(second).not.toBe(first);
    expect(await run.keys()).toEqual([second]);
    // At the second put the record still named the first pack; at the delete
    // it already named the second.
    expect(seenAt[`put ${second}`]).toBe(first);
    expect(seenAt[`delete ${first}`]).toBe(second);
    expect(run.calls.filter((c) => c.startsWith("delete"))).toEqual([`delete ${first}`]);
  });

  it("keeps the new hold when dropping the old pack fails, leaving an orphan", async () => {
    const run = lab({ script: ["write-throw", "write"], maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    run.faults.delete = true;
    await run.act("drain");
    await run.settled("completed");

    const record = await run.record();
    expect(record.held.error).toBeNull();
    expect(await run.keys()).toHaveLength(2);
    expect(await run.keys()).toContain(record.held.key);
  });

  it("does not complete on work held nowhere, and the retry holds it (BR-7, BR-8)", async () => {
    const run = lab({ script: ["write", "write"], maxAttempts: 2 });
    run.faults.put = true;
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    expect((await run.record()).held).toMatchObject({ error: expect.stringMatching(/unavailable/), key: null });
    expect(run.calls.filter((c) => c.startsWith("put")).length).toBeGreaterThanOrEqual(3);

    run.faults.put = false;
    await run.act("drain");
    await run.settled("completed");
    expect((await run.record()).held).toMatchObject({ error: null, attempt: 2 });
  });
});

describe("a run lost with its machine continues on another (BR-17, BR-18, BR-23, BR-25)", () => {
  it("rebuilds the checkout from the held work, with place.state lost, restoring, then ready on the new machine", async () => {
    const run = lab({ script: ["write-throw", "read"], maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    run.lose("A");
    run.use("B");
    run.placeStates.length = 0;
    await run.act("drain");
    await run.settled("completed");

    expect(run.seen[1]!.notes).toBe("turn 1\n");
    expect(run.seen[1]!.prompt).toMatch(/rebuilt on a new machine/);
    expect(await run.record()).toMatchObject({ place: { host: run.hostId("B"), state: "ready" } });
    // As the record read on entering provision, then after each report.
    expect(run.placeStates).toEqual(["provisioning", "lost", "restoring"]);
  });

  it("starts a fresh conversation on the new machine rather than resuming the old one", async () => {
    const run = lab({ script: ["write-throw", "read"], maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    run.lose("A");
    run.use("B");
    await run.act("drain");
    await run.settled("completed");
    expect((await run.record()).place.host).toBe(run.hostId("B"));
  });
});

describe("held work that cannot be used parks the run for its owner (BR-19, BR-20, BR-29, D2)", () => {
  async function heldThenLost(run: ReturnType<typeof lab>) {
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    run.lose("A");
  }

  it("a changed pack: row parked, place lost, the owner asked naming the field, no harness ran, the pack untouched", async () => {
    const run = lab({ script: ["write-throw"], maxAttempts: 3 });
    await heldThenLost(run);
    const key = (await run.record()).held.key as string;
    const bytes = (await run.pack(key))!;
    bytes[bytes.length - 30] ^= 0xff;
    await run.tamper(key, bytes);
    run.use("B");

    await run.act("drain").catch(() => undefined);
    await run.settled("parked");

    expect(run.seen).toHaveLength(1);
    const record = await run.record();
    expect(record.place.state).toBe("lost");
    expect(record.held).toMatchObject({ key, parked: true });
    expect(record.outcome).toBe("running");
    expect((await run.questions()).some((q) => q.includes("(pack)"))).toBe(true);
    expect(await run.pack(key)).toEqual(bytes);
  });

  it("a host with holding off parks the same way, naming disabled", async () => {
    const run = lab({ script: ["write-throw"], maxAttempts: 3 });
    await heldThenLost(run);
    run.use("B-off");

    await run.act("drain").catch(() => undefined);
    await run.settled("parked");

    expect(run.seen).toHaveLength(1);
    expect((await run.questions()).some((q) => q.includes("(disabled)"))).toBe(true);
    expect((await run.record()).held.parked).toBe(true);
  });

  it("after the answer, starts from the base with the held files in held/, and never drops the parked pack", async () => {
    const run = lab({ script: ["write-throw", "read", "write"], maxAttempts: 4 });
    await heldThenLost(run);
    const parked = (await run.record()).held.key as string;
    run.use("B-off");
    await run.act("drain").catch(() => undefined);
    await run.settled("parked");

    await run.act("answer");
    run.use("B");
    await run.act("drain");
    await run.settled("completed");

    expect(run.seen[1]!.notes).toBeNull();
    expect(run.seen[1]!.prompt).toMatch(/beside the checkout/);
    expect(readFileSync(join(run.heldDir("B")!, "notes.md"), "utf8")).toBe("turn 1\n");
    const record = await run.record();
    expect(record.held.key).not.toBe(parked);
    expect(await run.keys()).toContain(parked);
    expect(run.calls).not.toContain(`delete ${parked}`);
  });
});

describe("after an answer, held work that still cannot be read (BR-20)", () => {
  it("starts from the base with no held/, and the prompt says so", async () => {
    const run = lab({ script: ["write-throw", "read"], maxAttempts: 4 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    run.lose("A");
    run.use("B");
    await run.rewriteRecord({ held: { ...(await run.record()).held, head: "0".repeat(40) } });
    await run.act("drain").catch(() => undefined);
    await run.settled("parked");
    expect((await run.questions()).some((q) => q.includes("(head)"))).toBe(true);

    await run.act("answer");
    await run.act("drain");
    await run.settled("completed");
    expect(run.seen[1]!.notes).toBeNull();
    expect(run.seen[1]!.prompt).toMatch(/no copy of it beside the checkout/);
    expect(run.heldDir("B")).toBeUndefined();
  });
});

describe("the record's two roots (BR-24, BR-27)", () => {
  it("rejects held work recorded with no place as corrupt", async () => {
    const run = lab({ script: ["write-throw", "write"], maxAttempts: 2 });
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    await run.rewriteRecord({ place: null });

    await run.act("drain").catch(() => undefined);
    const row = await run.settled("errored");
    expect(JSON.stringify(row)).toMatch(/corrupt/);
    expect(run.seen).toHaveLength(1);
  });

  it("provisions a record from before held work as before, then holds it", async () => {
    const run = lab({ script: ["write-throw", "read"], maxAttempts: 2 });
    run.use("B-off");
    await run.act("seed");
    await run.act("drain");
    await run.settled("pending");
    expect((await run.record()).place).toBeNull();

    run.use("B");
    await run.act("drain");
    await run.settled("completed");
    expect(run.seen[1]!.notes).toBe("turn 1\n");
    expect(await run.record()).toMatchObject({ place: { state: "ready" }, held: { attempt: 2, error: null } });
  });
});

