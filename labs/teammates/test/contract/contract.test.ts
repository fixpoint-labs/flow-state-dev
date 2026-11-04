/**
 * The lab's contract matrix: five scenarios, each run against the test double
 * (`test/fake-lab.ts`) and against the real adapter over the lab's own host
 * (`host.mts`, in process, with only the model scripted and every coding run
 * on harness-manager's scripted coder). Both columns share every assertion,
 * so a package change that alters what the adapter hands the screen fails
 * here, and a fake that draws what the real adapter can't fails too. The
 * Claude Code-style lab runs the same five scenarios on its own adapter.
 *
 * A stop is a task's Cancel, or Stop on the worker's turn. Its main worker
 * takes a task's result as a turn of its own, after the one that filed it.
 *
 * A gap the real adapter will close is listed in `GAPS` with its issue: that
 * assertion runs as `it.fails`, so it stays green while the gap is there and
 * turns red the day the issue lands, and that PR removes the mark.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type SessionConnectionState } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { pluggable, scriptedModels, waitFor } from "../../../test-support/contract";
import { openTeammates } from "../../host.mts";
import { createLabAdapter, type BoardTask, type ConversationView, type LabAdapter, type Unsubscribe } from "../../src/adapter";
import { createFixtureLab } from "../fake-lab";

const CHIEF = "teammates.chief-of-staff";
const CODER = "teammates.cursor";

/** One column of the matrix: an adapter, and what a scenario does to the server behind it. */
interface Target {
  lab: LabAdapter;
  /** The next line's turn fails at its model call. */
  failNextTurn(): void;
  /** The host stops answering; `restore` brings it back. */
  lose(): void;
  restore(): void;
  /** The next abort is answered 409 and goes no further, as when an answer resumed the turn first. */
  refuseNextAbort(): void;
  /** The abort calls the adapter posted, by URL; the fake posts none, so it has none. */
  aborts?: string[];
  close(): Promise<void>;
}

/** The reason a failed turn's model call gives, which the conversation should show. */
const FAILURE = "The model provider is down.";
/** The question a task holds on; the fake's coding run asks the same one. */
const QUESTION = "Should I fix only line 1, or every typo?";
const ASK = {
  result: "Please fix the typo in the README.",
  failing: "What's on the plan for today?",
  question: "Please fix the typo, and ask me first which lines.",
  long: "Please fix every typo in the docs, one file at a time.",
  /** A turn that files two long tasks, then works on until it is stopped. */
  stopMe: "Look into both modules, then write up what you find.",
  /** A line sent after Stop: its turn works on until it is stopped. */
  meanwhile: "Meanwhile, draft the release note.",
  /** A turn that answers at once. */
  hello: "Hello there.",
};

/** The last user message of a step's messages: what this turn answers, not what an earlier one did. */
const lastAsk = (said: string) => said.slice(said.lastIndexOf('"role":"user"'));

/** The fake; `asks` makes its coding run ask {@link QUESTION} before it edits. */
function fakeTarget(asks: boolean): Target {
  // A coding run that committed waits for your review, as the real coders' runs do.
  const fake = createFixtureLab({ speed: 0.2, asks, review: true });
  return {
    lab: fake,
    failNextTurn: () => fake.failNextTurn(),
    lose: () => fake.setConnection("lapsed"),
    restore: () => fake.setConnection("live"),
    refuseNextAbort: () => fake.refuseNextStop(),
    close: async () => {},
  };
}

/** The workers' turns, by the worker a step is for. Only the model is scripted; every tool runs for real. */
function labScript(failing: { next: boolean }): ModelResolver {
  const worker = (said: string) => /You are ([\w ]+?),/.exec(said)?.[1];
  return scriptedModels(
    {
      "agent-answer": async ({ said, step, signal }) => {
        const who = worker(said);
        if (who === "researcher") {
          if (said.includes("Ask the user")) return step === 0 ? { call: { name: "holdTaskForUser", args: { question: QUESTION } } } : { text: "Fixed line 1." };
          // A long task: it runs until it is cancelled.
          await waitFor(30_000, signal);
          if (signal?.aborted) throw new DOMException("The task was cancelled.", "AbortError");
          return { text: "Every typo fixed." };
        }
        // Chief of Staff
        if (failing.next) {
          failing.next = false;
          throw new Error(FAILURE);
        }
        const asked = lastAsk(said);
        if (asked.includes(ASK.stopMe) && step < 2) {
          const module = step === 0 ? "A" : "B";
          return { call: { name: "createTask", args: { assignee: CODER, title: `Fix module ${module}`, goal: `Fix the typo in module ${module}.` } } };
        }
        if (asked.includes(ASK.stopMe) || asked.includes(ASK.meanwhile)) {
          await waitFor(30_000, signal);
          if (signal?.aborted) throw new DOMException("The turn was stopped.", "AbortError");
          return { text: "Written up." };
        }
        if (step > 0) return { text: "It runs in the background, and its card shows here." };
        if (said.includes(ASK.question)) return { call: { name: "createTask", args: { assignee: "teammates.researcher", title: "Fix the typo", goal: "Fix the typo in the README. Ask the user which lines first." } } };
        if (said.includes(ASK.long)) return { call: { name: "createTask", args: { assignee: "teammates.researcher", title: "Fix every typo", goal: "Fix every typo in the docs." } } };
        if (said.includes(ASK.result)) return { call: { name: "createTask", args: { assignee: CODER, title: "Fix the typo", goal: "Fix the typo in the README's first line." } } };
        return { text: "Noted." };
      },
      // Memory records each turn; it has nothing to keep from these.
      "memory/observe": () => ({ output: { items: [] } }),
    },
    () => ({ text: "ok" }),
  ) as ModelResolver;
}

async function realTarget(): Promise<Target> {
  const data = mkdtempSync(join(tmpdir(), "teammates-contract-"));
  const repo = join(data, "repo");
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  // A coding run refuses a repository that would commit its question files.
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  writeFileSync(join(repo, "README.md"), "Relay keps your team in sync.\n");
  execFileSync("git", ["-C", repo, "add", "-A"], { env: git });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: git });
  const failing = { next: false };
  const flowState = await openTeammates({
    store: join(data, "teammates.sqlite"),
    model: "test/scripted",
    userId: "you",
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 50,
    modelResolver: labScript(failing),
  });
  const inProcess = createInProcessFetch(flowState as never) as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  const aborts: string[] = [];
  const refuse = { next: false };
  // Every call goes to the host as it is; an abort is noted on the way. A refused one is the
  // abort route's 409 for a turn an answer resumed first (`already-resolved`): it never reaches the
  // host, so the turn runs on, and only the request record says so.
  const plug = pluggable(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (init?.method === "POST" && url.endsWith("/abort")) {
      aborts.push(url);
      if (refuse.next) {
        refuse.next = false;
        return new Response(JSON.stringify({ error: "Request was resumed before the stop reached it" }), { status: 409, headers: { "content-type": "application/json" } });
      }
    }
    return inProcess(input, init);
  });
  const lab = createLabAdapter(createClient({ userId: "you", baseUrl: "", fetcher: plug.fetcher as never }));
  return {
    lab,
    failNextTurn: () => (failing.next = true),
    lose: () => plug.pull(),
    restore: () => plug.restore(),
    refuseNextAbort: () => (refuse.next = true),
    aborts,
    close: async () => {
      plug.restore();
      await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

/** Assertions the real adapter can't meet yet, by column, with the issue that closes each. */
const GAPS: Record<string, { real?: string; fake?: string }> = {
  "shows why the turn failed": { real: "FIX-2550", fake: "FIX-2550" },
  // The fake holds a line sent mid-turn until the turn ends; the server starts its answer at once.
  "stops only the turns answering at the press: a line sent after it runs on": { fake: "FIX-2376" },
};

const stops: Unsubscribe[] = [];
let target: Target | undefined;
afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  await target?.close();
  target = undefined;
});

/** One watch, followed: its latest value, and a wait until a check holds for it. */
interface Followed<T> {
  latest(): T | undefined;
  until(check: (value: T) => boolean, ms?: number): Promise<T>;
}

function follow<T>(watch: (on: (value: T) => void) => Unsubscribe): Followed<T> {
  let last: T | undefined;
  const waiters = new Set<(value: T) => void>();
  stops.push(
    watch((value) => {
      last = value;
      for (const waiter of [...waiters]) waiter(value);
    }),
  );
  return {
    latest: () => last,
    until: (check, ms = 15_000) =>
      new Promise((resolve, reject) => {
        const waiter = (value: T) => {
          if (!check(value)) return;
          waiters.delete(waiter);
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`condition never held; last value: ${JSON.stringify(last)?.slice(0, 1500)}`));
        }, ms);
        waiters.add(waiter);
        if (last !== undefined) waiter(last);
      }),
  };
}

const conversation = (lab: LabAdapter, id: string) => follow<ConversationView>((on) => lab.watchConversation(id, on));
const tasks = (lab: LabAdapter, id: string) => follow<BoardTask[]>((on) => lab.watchTasks(id, on));
const connection = (lab: LabAdapter, id: string) => follow<SessionConnectionState>((on) => lab.watchConnection(id, on));

describe.each([
  ["fake", async (asks: boolean) => fakeTarget(asks)],
  ["real", async () => realTarget()],
] as const)("the %s adapter", (column, make) => {
  /** `it`, or `it.fails` when this column has a gap named for `name`. */
  const check = (name: string, run: () => Promise<void>) => {
    const gap = GAPS[name]?.[column];
    return gap === undefined ? it(name, run, 60_000) : it.fails(`${name} (gap: ${gap})`, run, 60_000);
  };
  /** Chief of Staff's conversation, on a fresh target. */
  const chief = async (asks = false) => {
    target = await make(asks);
    // The screen opens on the roster: the adapter learns the workers' names from it, and draws a line
    // from a worker it knows as that worker's.
    await target.lab.listWorkers();
    return { lab: target.lab, id: await target.lab.openConversation(CHIEF) };
  };

  describe("a result that lands mid-turn", () => {
    check("shows the task's result under the worker that ran it, once its review is accepted, and the row reads done", async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      const board = tasks(lab, id);
      await lab.send(id, ASK.result);
      const filed = await view.until((v) => v.entries.some((e) => e.kind === "task"));
      const card = filed.entries.find((e) => e.kind === "task") as { taskId: string; to: string };
      // A coding run that committed waits for your review, answerable once the adapter knows the run's flow.
      await board.until((r) => r.some((t) => t.id === card.taskId && t.waiting?.kind === "review" && t.waiting.unanswerable === null), 30_000);
      await lab.answerTask(id, card.taskId, { verdict: "accepted" });
      await view.until((v) => v.entries.some((e) => e.kind === "result" && e.taskId === card.taskId && e.from === card.to && e.failed !== true && e.text.length > 0));
      await board.until((r) => r.some((t) => t.id === card.taskId && t.status === "done"));
    });
  });

  describe("a failed turn", () => {
    /** A turn whose model call failed, ended. */
    const failed = async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      target!.failNextTurn();
      await lab.send(id, ASK.failing);
      await view.until((v) => v.entries.some((e) => e.kind === "user" && e.text === ASK.failing));
      await waitFor(1_500);
      return view.until((v) => !v.running);
    };
    const after = (view: ConversationView) => view.entries.slice(view.entries.findIndex((e) => e.kind === "user" && e.text === ASK.failing) + 1);
    check("stops running and shows no reply", async () => {
      const view = await failed();
      expect(after(view).filter((e) => e.kind === "assistant")).toEqual([]);
    });
    check("shows why the turn failed", async () => {
      const view = await failed();
      expect(JSON.stringify(after(view))).toContain(FAILURE);
    });
  });

  describe("a held question and its answer", () => {
    check("shows the task waiting on its question, and the answer clears it", async () => {
      const { lab, id } = await chief(true);
      const board = tasks(lab, id);
      await lab.send(id, ASK.question);
      const held = await board.until((r) => r.some((t) => t.waiting?.kind === "question" && t.waiting.unanswerable === null));
      const task = held.find((t) => t.waiting?.kind === "question")!;
      expect(task.waiting).toEqual({ kind: "question", prompt: QUESTION, unanswerable: null });
      expect(task.status).toBe("running");
      await lab.answerTask(id, task.id, { text: "Only line 1." });
      await board.until((r) => r.some((t) => t.id === task.id && t.waiting === undefined));
    });
  });

  describe("a stop", () => {
    check("cancels a running task, and it stays cancelled", async () => {
      const { lab, id } = await chief();
      const board = tasks(lab, id);
      await lab.send(id, ASK.long);
      const running = await board.until((r) => r.some((t) => t.status === "running"));
      const task = running.find((t) => t.status === "running")!;
      await lab.taskActions(id).cancel(task.id);
      await board.until((r) => r.some((t) => t.id === task.id && t.status === "cancelled"));
      await waitFor(1_500);
      expect(board.latest()!.find((t) => t.id === task.id)!.status).toBe("cancelled");
    });
  });

  describe("a turn stop", () => {
    /** Chief of Staff's conversation, answering a turn that filed two tasks and works on. */
    const answering = async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      await lab.send(id, ASK.stopMe);
      // Stop is on screen while the view reads the worker answering.
      await view.until((v) => v.running && v.entries.filter((e) => e.kind === "task").length === 2, 30_000);
      return { lab, id, view };
    };

    check("stops the answering turn, says stopping until it ended, then puts a stopped line after its last entry", async () => {
      const { lab, id, view } = await answering();
      const pressed = lab.interrupt(id);
      await view.until((v) => v.stopping);
      await pressed;
      const ended = await view.until((v) => !v.running && !v.stopping && v.entries.some((e) => e.kind === "stopped"));
      const stopped = ended.entries.filter((e) => e.kind === "stopped");
      expect(stopped).toHaveLength(1);
      // After the stopped turn's line and both its tasks, and last: nothing came after it.
      const at = ended.entries.indexOf(stopped[0]!);
      expect(ended.entries.findIndex((e) => e.kind === "user" && e.text === ASK.stopMe)).toBeLessThan(at);
      expect(ended.entries.slice(0, at).filter((e) => e.kind === "task")).toHaveLength(2);
      expect(at).toBe(ended.entries.length - 1);
      // One abort, for the answering turn: none for the board's own passes.
      if (target!.aborts !== undefined) expect(target!.aborts).toHaveLength(1);
    });

    check("counts the background work the stopped turn left running, from the session's runs", async () => {
      const { lab, id, view } = await answering();
      const board = tasks(lab, id);
      await lab.interrupt(id);
      await view.until((v) => !v.running && v.entries.some((e) => e.kind === "stopped"));
      const counted = await view.until((v) => v.backgroundRunning !== null && v.backgroundRunning > 0, 30_000);
      expect(counted.backgroundRunning).toBeLessThanOrEqual(2);
      if (target!.aborts !== undefined) {
        // Stop stops the turn only: both tasks it filed still run, until their own end.
        expect(counted.backgroundRunning).toBe(2);
        const rows = await board.until((r) => r.filter((t) => t.status === "running").length === 2);
        for (const row of rows) await lab.taskActions(id).cancel(row.id);
        await view.until((v) => v.backgroundRunning === 0, 30_000);
      }
    });

    check("stops only the turns answering at the press: a line sent after it runs on", async () => {
      const { lab, id, view } = await answering();
      const pressed = lab.interrupt(id);
      await lab.send(id, ASK.meanwhile);
      await pressed;
      // Stopping ends with the stopped turn, while the later line's turn still answers.
      const after = await view.until((v) => !v.stopping && v.running && v.entries.some((e) => e.kind === "stopped"), 30_000);
      expect(after.entries.filter((e) => e.kind === "stopped")).toHaveLength(1);
      const at = after.entries.findIndex((e) => e.kind === "stopped");
      expect(after.entries.findIndex((e) => e.kind === "user" && e.text === ASK.meanwhile)).toBeGreaterThan(at);
      if (target!.aborts !== undefined) expect(target!.aborts).toHaveLength(1);
      // Stopped too, so the host can close.
      await lab.interrupt(id);
      await view.until((v) => !v.running, 30_000);
    });

    check("stops a turn sent just before the press, though the view has not read it yet", async () => {
      const { lab, id, view } = await answering();
      await lab.send(id, ASK.meanwhile);
      // No wait for the view to read the second turn: Stop is pressed at once.
      await lab.interrupt(id);
      const after = await view.until((v) => !v.running && !v.stopping, 30_000);
      expect(after.entries.some((e) => e.kind === "stopped")).toBe(true);
      if (target!.aborts !== undefined) expect(target!.aborts).toHaveLength(2);
    });

    check("a stop the server refuses while the turn runs on clears stopping, says why, and draws no stopped line", async () => {
      const { lab, id, view } = await answering();
      target!.refuseNextAbort();
      await expect(lab.interrupt(id)).rejects.toThrow(/Press Stop again/);
      await waitFor(300);
      const after = view.latest()!;
      expect(after.running).toBe(true);
      expect(after.stopping).toBe(false);
      expect(after.entries.some((e) => e.kind === "stopped")).toBe(false);
      // Pressed again, it stops.
      await lab.interrupt(id);
      await view.until((v) => !v.running && v.entries.some((e) => e.kind === "stopped"), 30_000);
    });

    check("gives a turn that completed no stopped line", async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      await lab.send(id, ASK.hello);
      await view.until((v) => !v.running && v.entries.some((e) => e.kind === "assistant"), 30_000);
      // The view reads the requests on the turn's ending notice; in process that lands well inside a second.
      await waitFor(1_500);
      expect(view.latest()!.entries.some((e) => e.kind === "stopped")).toBe(false);
    });
  });

  describe("a lapsed connection", () => {
    check("says lapsed while the host is gone, and live once it is back", async () => {
      const { lab, id } = await chief();
      const state = connection(lab, id);
      await state.until((s) => s === "live");
      target!.lose();
      await state.until((s) => s === "lapsed");
      target!.restore();
      await state.until((s) => s === "live", 40_000);
    });
  });
});
