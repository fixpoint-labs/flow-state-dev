// FIX-2878.
/**
 * What a coding task takes, checked at filing: the mode it runs in and the run
 * settings the server writes on it.
 *
 * Why it matters: a model writes a task's input, and text it reads can name a
 * coder or the work to do. So the filer picks the mode, inside the set the app
 * registered and its required input, and never the harness: whatever it sends
 * there is dropped, and the server writes the filing run's settings, or the
 * kit's default outside any run, on whatever worker the model chose. A worker's
 * `lock:` refuses a task that differs on a locked field by name, and an old
 * feature marker is refused on any write, never translated into another mode.
 *
 * Graded on the stored row and the filing tool's refusal, through the router a
 * client files with; the decide-once rule and the legacy read on the hooks they
 * run in.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { Harness } from "../src/harness";
import type { CompletionRunContext, PromptRunContext } from "../src/manager";
import { scriptedHarness } from "../src/scripted-harness";
import { seedRepo } from "./fixtures";
import { harnesses } from "../src/kit";
import { resolveCoderModes } from "../src/kit/coder-modes";
import { codingTaskInput, noteRunSettings, storedCodingInput } from "../src/kit/coding-task-input";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const worker = (name: string, extra: string) => `---\nname: ${name}\ndescription: ${name}.\n${extra}---\nYou are ${name}.`;

/**
 * Lead files; Solo has one delegate, which a filing naming no worker goes to. `coder` is a
 * role-specific coder whose own harness is not the default; two workers carry a lock.
 */
function team(): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-coding-task-input-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "teams/core/workers/lead/WORKER.md": worker("Lead", "delegates:\n  - core.coder\n  - core.explainer\n  - core.planner\n"),
    "teams/core/workers/solo/WORKER.md": worker("Solo", "delegates:\n  - core.coder\n"),
    "teams/core/workers/coder/WORKER.md": worker("Coder", "flow: coder\nharness: cursor\n"),
    "teams/core/workers/explainer/WORKER.md": worker("Explainer", "flow: coder\nlock:\n  mode: answer\n"),
    "teams/core/workers/planner/WORKER.md": worker("Planner", "flow: coder\nharness: cursor\nlock:\n  harness: cursor\n"),
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const harness = (id: string): Harness => ({ id, label: id, agent: scriptedHarness({ stepEveryMs: 1 }).slot, readiness: async () => ({ ready: true }), pass: [] });
const workspace = localWorkspaceHost({ root: join(tmpdir(), "fsd-coding-task-input-runs"), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });
const brief = (text: string) => (_run: PromptRunContext) => text;
const finished = (run: CompletionRunContext) => run.stopReport === "finished";
/** Shift Manager's two modes: `implement` needs its issue, and `answer` is the default. */
const shiftManager = {
  modes: {
    implement: { instructions: brief("implement"), doneWhen: finished, requires: ["issue" as const] },
    answer: { instructions: brief("answer"), doneWhen: finished },
  },
  defaultMode: "answer",
};

type Filed = { ok: true; taskId: string } | { ok: false; error: string };

async function boot(defaultMode = "answer", runsIn: typeof workspace = workspace, filer = "core.lead") {
  const state = createFlowState({
    kits: [harnesses({ workspace: runsIn, defaultHarness: "codex", judge: false, ...shiftManager, defaultMode }), workforce({ directory: team() })],
    fill: { [harnesses.slots.harnesses]: [harness("codex"), harness("cursor")] },
    stores: { default: { primary: inMemoryStores() } },
  });
  states.push(state);
  await state.ready();
  const router = await state.getRouter();
  const stores = (await state.getRuntime()).stores;
  const post = async (path: string[], body: unknown) => {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: { path } },
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  const created = await post(["agent", "sessions"], { userId: "alice", state: { workerId: filer } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const conversation = created.body.session.id as string;
  /** Run one of the conversation's task tools, and answer what it returned. */
  const tool = async (action: string, input: Record<string, unknown>): Promise<Filed> => {
    const sent = await post(["agent", conversation, "actions", action], { userId: "alice", input });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    for (let n = 0; n < 300 && (await stores.request.get(sent.body.request.id))?.status === "in_progress"; n++) await new Promise((r) => setTimeout(r, 10));
    return (await stores.request.get(sent.body.request.id))?.result?.output as Filed;
  };
  /** File a held task, so nothing runs: only what the filing stored is graded. Each its own work, so none is refused as already open. */
  let filings = 0;
  const file = (assignee: string, input?: Record<string, unknown>) =>
    tool("createTask_tasks", { goal: `Skip archived rows in export ${(filings += 1)}`, assignee, held: true, ...(input === undefined ? {} : { input }) });
  const userKey = `alice:~org:${DEFAULT_ORG_ID}`;
  const stored = async (taskId: string) => {
    const entries = await stores.resourceState.getByPrefix("user", userKey, "tasks/");
    return Object.values(entries).map((entry) => entry.state as { id: string; status: string; assignee?: string; input?: Record<string, unknown> }).find((task) => task.id === taskId)!;
  };
  /** Write a task as an older build stored it. */
  const restore = async (taskId: string, shape: (task: Record<string, any>) => Record<string, unknown>) => {
    const entries = await stores.resourceState.getByPrefix("user", userKey, "tasks/");
    const [key, record] = Object.entries(entries).find(([, entry]) => (entry.state as { id?: string }).id === taskId)!;
    await stores.resourceState.set("user", userKey, key, shape(record.state as Record<string, any>) as never, "any");
  };
  /** The mode segment of each run record the task's run wrote. */
  const runModes = async (taskId: string) =>
    Object.entries(await stores.resourceState.getByPrefix("user", userKey, "runs/"))
      .filter(([key]) => key.includes(taskId.replace(/_/g, "-")) || key.includes(taskId))
      .map(([key, record]) => ({ mode: key.split("/").at(-1), branch: (record.state as { branch?: string }).branch }));
  return { file, tool, stored, restore, runModes };
}

const filedId = (filed: Filed): string => {
  expect(filed, JSON.stringify(filed)).toMatchObject({ ok: true });
  return (filed as { taskId: string }).taskId;
};
const refusal = (filed: Filed): string => {
  expect(filed, JSON.stringify(filed)).toMatchObject({ ok: false });
  return (filed as { error: string }).error;
};

describe("a coding task's mode, at filing", () => {
  it("writes the app's default mode on a task that names none, and keeps one it names", async () => {
    const app = await boot();
    expect((await app.stored(filedId(await app.file("core.coder")))).input).toMatchObject({ mode: "answer" });
    const named = await app.stored(filedId(await app.file("core.coder", { mode: "implement", issue: "FIX-2165" })));
    expect(named.input).toMatchObject({ mode: "implement", issue: "FIX-2165" });
  });

  it("refuses a mode the app doesn't register, an inherited key included, naming the modes it has", async () => {
    const app = await boot();
    for (const mode of ["review", "constructor", "toString"]) {
      const error = refusal(await app.file("core.coder", { mode }));
      expect(error).toMatch(new RegExp(`^mode_unknown: this app has no mode "${mode}"\\. Its modes are "implement" and "answer"\\.`));
      expect(error).toContain("Nothing was filed.");
    }
  });

  it("refuses implement with no issue, naming the field and the mode that needs none, and never files it as an answer", async () => {
    const app = await boot();
    const error = refusal(await app.file("core.coder", { mode: "implement" }));
    expect(error).toContain('mode_needs_input: mode "implement" needs "issue", and this task has none. Name it, or file it in mode "answer".');
  });

  it("checks the mode's required input on the resolved mode: with an implement default, a task naming no mode needs its issue", async () => {
    const app = await boot("implement");
    expect(refusal(await app.file("core.coder"))).toContain('mode "implement" needs "issue"');
    expect((await app.stored(filedId(await app.file("core.coder", { issue: "FIX-2165" })))).input).toMatchObject({ mode: "implement" });
  });

  it("refuses an issue that isn't a tracker issue, saying what one is", async () => {
    const app = await boot();
    expect(refusal(await app.file("core.coder", { issue: "Typo in first line" }))).toMatch(/^issue_malformed: issue "Typo in first line" isn't a tracker issue\. An issue is a tracker key such as ENG-142/);
  });

  it("drops a filer's done check and workspace: the run uses its mode's", async () => {
    const app = await boot();
    const filed = await app.stored(filedId(await app.file("core.coder", { mode: "implement", issue: "FIX-2165", doneWhen: "always", workspace: { host: "/" } })));
    expect(filed.input).not.toHaveProperty("doneWhen");
    expect(filed.input).not.toHaveProperty("workspace");
  });
});

describe("a worker locked to a mode", () => {
  it("refuses a task that asks it for another, at filing, naming the worker, its mode and the one asked for", async () => {
    const app = await boot();
    expect(refusal(await app.file("core.explainer", { mode: "implement", issue: "FIX-2165" }))).toBe(
      'mode_locked: worker "core.explainer" always runs with mode answer; this task asked for implement. ' +
        "File it to a worker that isn't locked, or ask the user. Nothing was filed.",
    );
    expect((await app.stored(filedId(await app.file("core.explainer")))).input).toMatchObject({ mode: "answer" });
  });

  it("compares the lock with the resolved mode: an implement default refuses a task naming none", async () => {
    const app = await boot("implement");
    expect(refusal(await app.file("core.explainer", { issue: "FIX-2165" }))).toMatch(/^mode_locked: .*this task asked for implement\./);
  });
});

describe("the run settings a coding task carries", () => {
  it("writes the kit's default on a filing from outside any coding run, on the worker the model chose", async () => {
    const app = await boot();
    // core.coder's own harness is cursor; the filing still lands on it, carrying the server's default.
    const filed = await app.stored(filedId(await app.file("core.coder")));
    expect(filed.input).toMatchObject({ harness: "codex" });
  });

  it("drops a filer's harness, model and plan, and writes the server's", async () => {
    const app = await boot();
    const filed = await app.stored(filedId(await app.file("core.coder", { harness: "cursor", model: "gpt-6-luna", plan: true })));
    expect(filed.input).toMatchObject({ harness: "codex" });
    expect(filed.input).not.toHaveProperty("model");
    expect(filed.input).not.toHaveProperty("plan");
  });

  it("refuses a filing a worker's harness lock doesn't take, naming both, and never swaps it to fit", async () => {
    const app = await boot();
    expect(refusal(await app.file("core.planner"))).toBe(
      'harness_locked: worker "core.planner" always runs with harness cursor; this task asked for codex. ' +
        "File it to a worker that isn't locked, or ask the user. Nothing was filed.",
    );
  });
});

describe("every write that files or moves a coding task", () => {
  it("fills the sole delegate's filing, which names no worker, as it fills a named one", async () => {
    const app = await boot("answer", workspace, "core.solo");
    const filed = await app.stored(filedId(await app.tool("createTask_tasks", { goal: "Skip archived rows", held: true })));
    expect(filed).toMatchObject({ assignee: "core.coder", input: { mode: "answer", harness: "codex" } });
  });

  it("keeps the server's settings on an edit, whatever the filer sends there", async () => {
    const app = await boot();
    const taskId = filedId(await app.file("core.coder"));
    expect(await app.tool("updateTask_tasks", { id: taskId, input: { mode: "implement", issue: "FIX-2165", harness: "cursor" } })).toMatchObject({ ok: true });
    expect((await app.stored(taskId)).input).toMatchObject({ mode: "implement", issue: "FIX-2165", harness: "codex" });
  });

  it("checks a move onto another coder against that worker's lock, and leaves the task where it was", async () => {
    const app = await boot();
    const taskId = filedId(await app.file("core.coder", { mode: "implement", issue: "FIX-2165" }));
    expect(refusal(await app.tool("updateTask_tasks", { id: taskId, assignee: "core.planner" }))).toMatch(/^harness_locked: worker "core.planner" always runs with harness cursor; this task asked for codex\./);
    expect(refusal(await app.tool("updateTask_tasks", { id: taskId, assignee: "core.explainer" }))).toMatch(/^mode_locked: worker "core.explainer" always runs with mode answer; this task asked for implement\./);
    expect(await app.stored(taskId)).toMatchObject({ assignee: "core.coder", input: { harness: "codex" } });
  });
});

describe("the old feature marker", () => {
  it("is refused on a filing and on an update, by name, and the task keeps its mode", async () => {
    const app = await boot();
    expect(refusal(await app.file("core.coder", { harnessFeature: { issue: "FIX-2165" } }))).toBe(
      'legacy_marker: harnessFeature is no longer accepted; file mode: "implement" with issue instead. Nothing was filed.',
    );
    expect(refusal(await app.file("core.explainer", { mode: "answer", harnessFeature: { issue: "FIX-2165" } }))).toMatch(/^legacy_marker: /);
    const taskId = filedId(await app.file("core.coder"));
    expect(refusal(await app.tool("updateTask_tasks", { id: taskId, input: { harnessFeature: { issue: "FIX-2165" } } }))).toMatch(/^legacy_marker: /);
    expect((await app.stored(taskId)).input).toMatchObject({ mode: "answer" });
  });
});

describe("an update before the first claim", () => {
  it("re-checks a changed mode as a filing does", async () => {
    const app = await boot();
    const taskId = filedId(await app.file("core.explainer"));
    expect(refusal(await app.tool("updateTask_tasks", { id: taskId, input: { mode: "review" } }))).toMatch(/^mode_unknown: /);
    expect(refusal(await app.tool("updateTask_tasks", { id: taskId, input: { mode: "implement" } }))).toMatch(/^mode_needs_input: /);
    expect(refusal(await app.tool("updateTask_tasks", { id: taskId, input: { mode: "implement", issue: "FIX-2165" } }))).toMatch(/^mode_locked: /);
    expect((await app.stored(taskId)).input).toMatchObject({ mode: "answer" });
  });
});

describe("the filler", () => {
  const resolved = resolveCoderModes(shiftManager, { name: "default", instructions: brief("kit"), doneWhen: { check: () => true } }, "coder");
  const declaration = codingTaskInput({ modes: resolved, defaultHarness: "codex", harnesses: ["codex", "cursor"] });
  /** A filing request's context: its session, and a runOnce that records by key as a durable request does. */
  const filing = (session: object, recorded: Map<string, unknown>): BlockContext =>
    ({
      session,
      _blockIdentity: { blockInstanceId: "req_1:agent/tool[createTask][1%3Acall_1]:1" },
      runOnce: async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
        if (!recorded.has(key)) recorded.set(key, await fn());
        return recorded.get(key) as T;
      },
    }) as unknown as BlockContext;
  const fill = (ctx: BlockContext, at: "filing" | "claim" = "filing") =>
    declaration.fill!({ ctx, at, assignee: "core.coder", worker: { id: "core.coder", config: { harness: "cursor" } }, flow: "coder" });

  it("writes the filing coding run's settings, whatever the worker's own harness says", async () => {
    const session = {};
    noteRunSettings(session, { harness: "cursor" });
    expect(await fill(filing(session, new Map()))).toEqual({ harness: "cursor" });
  });

  it("decides once per call: a replay stores what the first attempt filled, though the request's run changed since", async () => {
    const session = {};
    const recorded = new Map<string, unknown>();
    expect(await fill(filing(session, recorded))).toEqual({ harness: "codex" });
    noteRunSettings(session, { harness: "cursor" });
    expect(await fill(filing(session, recorded))).toEqual({ harness: "codex" });
    // Another call decides for itself.
    expect(await fill(filing(session, new Map()))).toEqual({ harness: "cursor" });
  });

  it("fills nothing at a claim, so a value the filler never wrote stays absent", async () => {
    const session = {};
    noteRunSettings(session, { harness: "cursor" });
    expect(await fill(filing(session, new Map()), "claim")).toEqual({});
  });
});

describe("a task stored before this change", () => {
  const sm = resolveCoderModes(shiftManager, { name: "default", instructions: brief("kit"), doneWhen: { check: () => true } }, "coder");
  const kit = resolveCoderModes({}, { name: "default", formerName: "code", instructions: brief("kit"), doneWhen: { check: () => true } }, "coder");
  const refused = (input: Record<string, unknown>, resolved = sm) => {
    try {
      storedCodingInput(input, resolved);
    } catch (error) {
      return `${(error as { code?: string }).code}: ${(error as Error).message}`;
    }
    return "read";
  };

  it("reads an old feature marker as the mode its old phase maps to, on its issue", () => {
    const project = { repo: "acme/app" };
    expect(storedCodingInput({ harnessFeature: { issue: "FIX-2165" }, project }, sm)).toEqual({ mode: "implement", issue: "FIX-2165", project });
    expect(storedCodingInput({ harnessFeature: { issue: "FIX-2165", phase: "implement" } }, sm)).toEqual({ mode: "implement", issue: "FIX-2165" });
    // The kit's old phase was `code`: such a row, or one with no phase, runs as `default`.
    expect(storedCodingInput({ harnessFeature: { issue: "FIX-2165", phase: "code" } }, kit)).toEqual({ mode: "default", issue: "FIX-2165" });
    expect(storedCodingInput({ harnessFeature: { issue: "FIX-2165" } }, kit)).toEqual({ mode: "default", issue: "FIX-2165" });
    // A row with no marker reads as stored.
    expect(storedCodingInput({ description: "Why?" }, sm)).toEqual({ description: "Why?" });
  });

  it("refuses a marker whose phase no registered mode keeps, one with no valid issue, and one beside a mode, never converting it", () => {
    expect(refused({ harnessFeature: { issue: "FIX-2165", phase: "review" } })).toBe('legacy_marker: legacy task names phase "review", which no registered mode keeps. Nothing ran.');
    expect(refused({ harnessFeature: { phase: "implement" } })).toMatch(/^legacy_marker: legacy task names harnessFeature with no valid issue\./);
    expect(refused({ harnessFeature: { issue: "FIX-2165" }, mode: "answer" })).toMatch(/^legacy_marker: legacy task names both harnessFeature and mode "answer"/);
    expect(refused({ harnessFeature: { issue: "FIX-2165", phase: "code" } })).toMatch(/which no registered mode keeps/);
  });
});

describe("a row stored before this change, at its claim", () => {
  it("runs a feature marker as implement on its issue, the mode the claim read it in, and keys its run so", async () => {
    const root = mkdtempSync(join(tmpdir(), "fsd-coding-task-input-claim-"));
    dirs.push(root);
    const repo = join(root, "repo");
    mkdirSync(repo);
    seedRepo(repo);
    const app = await boot("answer", localWorkspaceHost({ root: join(root, "runs"), remotes: { allow: ["file"] }, source: () => ({ kind: "repo", repo: `file://${repo}` }) }));
    const taskId = filedId(await app.file("core.coder"));
    // The shape an older build stored: the marker in the filer's input, and no stamp from the filing check.
    await app.restore(taskId, (task) => {
      const { inputFilledFor: _stamp, ...metadata } = task.metadata ?? {};
      return { ...task, input: { harnessFeature: { issue: "FIX-2165" } }, metadata };
    });
    expect(await app.tool("updateTask_tasks", { id: taskId, status: "pending" })).toMatchObject({ ok: true });
    let task = await app.stored(taskId);
    for (let n = 0; n < 500 && !["completed", "errored", "failed", "cancelled"].includes(task.status); n++) {
      await new Promise((r) => setTimeout(r, 20));
      task = await app.stored(taskId);
    }
    expect(task.status, JSON.stringify(task)).toBe("completed");
    const runs = await app.runModes(taskId);
    expect(runs.map((run) => run.mode)).toEqual(["implement"]);
    expect(runs[0]!.branch).toContain("fix-2165");
  });
});

describe("a lock set after a task was filed", () => {
  it("refuses the task at claim, by name, and nothing runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "fsd-coding-task-input-lock-"));
    dirs.push(root);
    const repo = join(root, "repo");
    mkdirSync(repo);
    seedRepo(repo);
    const app = await boot("answer", localWorkspaceHost({ root: join(root, "runs"), remotes: { allow: ["file"] }, source: () => ({ kind: "repo", repo: `file://${repo}` }) }));
    const taskId = filedId(await app.file("core.explainer"));
    // Filed while its worker took implement: the stored task, stamp and all, as that filing wrote it.
    await app.restore(taskId, (task) => ({ ...task, input: { ...task.input, mode: "implement", issue: "FIX-2165" } }));
    expect(await app.tool("updateTask_tasks", { id: taskId, status: "pending" })).toMatchObject({ ok: true });
    let task = await app.stored(taskId) as { status: string; error?: string };
    for (let n = 0; n < 500 && !["completed", "errored", "failed", "cancelled"].includes(task.status); n++) {
      await new Promise((r) => setTimeout(r, 20));
      task = await app.stored(taskId) as { status: string; error?: string };
    }
    expect(task.status).not.toBe("completed");
    expect(task.error).toContain('mode_locked: worker "core.explainer" always runs with mode answer; this task asked for implement.');
    expect(task.error).toContain("Nothing ran.");
    expect(await app.runModes(taskId)).toEqual([]);
  });
});

describe("a field a model wrote on a row stored before this change", () => {
  /** A row filed to core.coder, rewritten as an older build stored it (`input`, and no stamp), released, and run to its end. */
  async function runUnstamped(input: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), "fsd-coding-task-input-old-"));
    dirs.push(root);
    const repo = join(root, "repo");
    mkdirSync(repo);
    seedRepo(repo);
    const app = await boot("answer", localWorkspaceHost({ root: join(root, "runs"), remotes: { allow: ["file"] }, source: () => ({ kind: "repo", repo: `file://${repo}` }) }));
    const taskId = filedId(await app.file("core.coder"));
    await app.restore(taskId, (task) => {
      const { inputFilledFor: _stamp, ...metadata } = task.metadata ?? {};
      return { ...task, input, metadata };
    });
    expect(await app.tool("updateTask_tasks", { id: taskId, status: "pending" })).toMatchObject({ ok: true });
    let task = await app.stored(taskId) as { status: string; error?: string };
    for (let n = 0; n < 500 && !["completed", "errored", "failed", "cancelled"].includes(task.status); n++) {
      await new Promise((r) => setTimeout(r, 20));
      task = await app.stored(taskId) as { status: string; error?: string };
    }
    return { task, runs: await app.runModes(taskId) };
  }

  it("never chooses its mode: a plain implement runs the default mode, on no issue", async () => {
    const { task, runs } = await runUnstamped({ mode: "implement", issue: "FIX-123" });
    expect(task.status, JSON.stringify(task)).toBe("completed");
    expect(runs.map((run) => run.mode)).toEqual(["answer"]);
    expect(runs[0]!.branch).not.toContain("fix-123");
  });

  it("runs a plain mode the app doesn't have in the default mode, not as an error", async () => {
    const { task, runs } = await runUnstamped({ mode: "bogus" });
    expect(task.status, JSON.stringify(task)).toBe("completed");
    expect(runs.map((run) => run.mode)).toEqual(["answer"]);
  });

  it("reads an issue that isn't a string as none, so its claim never fails on it", async () => {
    for (const issue of [null, { id: 7 }]) {
      const { task, runs } = await runUnstamped({ issue, description: "Why?" });
      expect(task.status, `${JSON.stringify(issue)}: ${JSON.stringify(task)}`).toBe("completed");
      expect(runs.map((run) => run.mode)).toEqual(["answer"]);
    }
  });
});
