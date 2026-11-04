/**
 * The lab's contract matrix: five scenarios, each run against the test double
 * (`test/fake-lab.ts`) and against the real adapter over the lab's own host
 * (`host.mts`, in process, with only the model scripted). Both columns share
 * every assertion, so a package change that alters what the adapter hands the
 * screen fails here, and a fake that draws what the real adapter can't fails
 * too. The Teammates lab runs the same five scenarios on its own adapter.
 *
 * A gap the real adapter will close is listed in `GAPS` with its issue: that
 * assertion runs as `it.fails`, so it stays green while the gap is there and
 * turns red the day the issue lands, and that PR removes the mark.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { pluggable, scriptedModels, waitFor } from "../../../test-support/contract";
import { openLab } from "../../host.mts";
import { createWiredLab, type LabAdapter, type TaskRow, type ThreadView, type Unsubscribe } from "../../src/adapter";
import type { ModeId } from "../../src/modes";
import { createFakeLab } from "../fake-lab";

/** One column of the matrix: an adapter, and what a scenario does to the server behind it. */
interface Target {
  lab: LabAdapter;
  /** A new session in `mode`, in a project you may work in. */
  open(mode: ModeId): Promise<string>;
  /** The next turn's model call fails. */
  failNextTurn(): void;
  /** The host stops answering; `restore` brings it back. */
  lose(): void;
  restore(): void;
  /** Lets the research the stop scenario holds finish. */
  releaseResearch(): void;
  /** The abort calls the adapter posted, by URL; the fake posts none, so it has none. */
  aborts?: string[];
  close(): Promise<void>;
}

/** The reason a failed turn's model call gives, which the thread should show. */
const FAILURE = "The model provider is down.";
/** The question a thread holds on. */
const QUESTION = "Which region matters, EU or US?";
const ASK = {
  midTurn: "Compare Acme and Globex for us.",
  long: "Write the long version of the notes.",
  failing: "Summarize the notes.",
  question: "Find where Vendor B hosts.",
  /** A turn that files two research tasks, then works on until it is stopped. */
  stopWithTasks: "Research both vendors, then draft the comparison.",
  /** A turn after a stopped one. */
  after: "Thanks, carry on later.",
};
/** A research task's goal carries this while the stop scenario holds it running. */
const HELD = "[held]";

/** The last user message of a step's messages: what this turn answers, not what an earlier one did. */
const lastAsk = (said: string) => said.slice(said.lastIndexOf('"role":"user"'));

function fakeTarget(): Target {
  const fake = createFakeLab({ speed: 0.1 });
  return {
    lab: fake,
    open: async (mode) => (await fake.openSession(mode, "project-vendor-notes")).id,
    failNextTurn: () => fake.failNextTurn(),
    lose: () => fake.setConnection("lapsed"),
    restore: () => fake.setConnection("live"),
    releaseResearch: () => {},
    close: async () => {},
  };
}

/** The workers' turns, by the worker a step is for. Only the model is scripted; every tool runs for real. */
function labScript(failing: { next: boolean }, held: Promise<void>): ModelResolver {
  let researched: () => void = () => {};
  const research = new Promise<void>((resolve) => (researched = resolve));
  const worker = (said: string) => /You are ([\w-]+)/.exec(said)?.[1];
  return scriptedModels(
    {
      "agent-answer": async ({ said, step, signal }) => {
        const who = worker(said);
        if (who === "researcher") {
          researched();
          if (said.includes(HELD)) await Promise.race([held, waitFor(30_000, signal)]);
          return { text: "Acme: $40 per user, 24-hour support." };
        }
        if (who === "thread") {
          if (step === 0) return { call: { name: "holdTaskForUser", args: { question: QUESTION } } };
          return { text: "Vendor B hosts in the EU." };
        }
        // desk.main
        if (failing.next) {
          failing.next = false;
          throw new Error(FAILURE);
        }
        if (lastAsk(said).includes(ASK.stopWithTasks)) {
          if (step < 2) {
            const vendor = step === 0 ? "Acme" : "Globex";
            return { call: { name: "createTask", args: { assignee: "desk.researcher", title: `Research ${vendor}`, goal: `${HELD} Find ${vendor}'s price.` } } };
          }
          await waitFor(30_000, signal);
          if (signal?.aborted) throw new DOMException("The turn was stopped.", "AbortError");
          return { text: "The comparison, finished." };
        }
        if (lastAsk(said).includes(ASK.long)) {
          await waitFor(30_000, signal);
          // A stopped model call ends with no text, as a provider's cut stream does.
          if (signal?.aborted) throw new DOMException("The turn was stopped.", "AbortError");
          return { text: "The long version, finished." };
        }
        if (said.includes(ASK.midTurn) && step === 0) return { call: { name: "createTask", args: { assignee: "desk.researcher", title: "Research Acme", goal: "Find Acme's price and support hours." } } };
        if (said.includes(ASK.midTurn) && step === 1) {
          // The turn is still running when the task settles, so the main worker takes the result into it.
          // It runs on past the client's 1.5 s read of the running turn: in process there is no
          // socket, so `client.subscribe` reads on its timer, and a shorter turn could end unseen.
          await research;
          await waitFor(3_000);
          return { text: "Outline written. Acme's research is in: section 1 now has its price." };
        }
        return { text: "Noted." };
      },
      "coordinator-judgment": ({ step }) =>
        step === 0 ? { call: { name: "createTask", args: { assignee: "desk.thread", title: "Vendor B regions", goal: "Find where Vendor B hosts. Ask the user which region matters." } } } : { text: "I've started a thread for it." },
    },
    () => ({ text: "ok" }),
  ) as ModelResolver;
}

async function realTarget(): Promise<Target> {
  const data = mkdtempSync(join(tmpdir(), "ccs-contract-"));
  const repo = join(data, "repo");
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "init"], { env: git });
  const failing = { next: false };
  let releaseResearch: () => void = () => {};
  const held = new Promise<void>((resolve) => (releaseResearch = resolve));
  const { flowState } = await openLab({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: [], modelResolver: labScript(failing, held) });
  const inProcess = createInProcessFetch(flowState as never) as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  const aborts: string[] = [];
  // Every call goes to the host as it is; an abort is noted on the way.
  const plug = pluggable(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (init?.method === "POST" && url.endsWith("/abort")) aborts.push(url);
    return inProcess(input, init);
  });
  const lab = createWiredLab(createClient({ userId: "u_lab", baseUrl: "", fetcher: plug.fetcher as never }));
  const project = await lab.createProject("vendor-notes", `file://${repo}`);
  return {
    lab,
    open: async (mode) => (await lab.openSession(mode, project.id)).id,
    failNextTurn: () => (failing.next = true),
    lose: () => plug.pull(),
    restore: () => plug.restore(),
    releaseResearch: () => releaseResearch(),
    aborts,
    close: async () => {
      releaseResearch();
      plug.restore();
      await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

/** Assertions the real adapter can't meet yet, by column, with the issue that closes each. */
const GAPS: Record<string, { real?: string; fake?: string }> = {
  "shows why the turn failed": { real: "FIX-2550", fake: "FIX-2550" },
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

const thread = (lab: LabAdapter, id: string) => follow<ThreadView>((on) => lab.watchThread(id, on));
const tasks = (lab: LabAdapter, id: string) => follow<TaskRow[]>((on) => lab.watchTasks(id, on));

describe.each([
  ["fake", async () => fakeTarget()],
  ["real", realTarget],
] as const)("the %s adapter", (column, make) => {
  /** `it`, or `it.fails` when this column has a gap named for `name`. */
  const check = (name: string, run: () => Promise<void>) => {
    const gap = GAPS[name]?.[column];
    return gap === undefined ? it(name, run, 30_000) : it.fails(`${name} (gap: ${gap})`, run, 30_000);
  };

  describe("a result that lands mid-turn", () => {
    check("shows the result while the turn runs, then the turn's own text after it", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      const board = tasks(lab, id);
      await lab.send(id, ASK.midTurn);
      // The result shows while the turn's working indicator is still on.
      const during = await view.until((v) => v.running && v.entries.some((e) => e.kind === "result" && e.duringTurn && e.status === "completed"));
      const result = during.entries.find((e) => e.kind === "result") as { id: string; taskId: string };
      // The same turn goes on to write about it.
      await view.until((v) => v.entries.slice(v.entries.findIndex((e) => e.id === result.id) + 1).some((e) => e.kind === "assistant"));
      await board.until((r) => r.some((t) => t.id === result.taskId && t.status === "completed"));
    });
  });

  describe("a failed turn", () => {
    /** A turn whose model call failed, ended. */
    const failed = async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      target.failNextTurn();
      await lab.send(id, ASK.failing);
      await view.until((v) => v.entries.some((e) => e.kind === "user"));
      await waitFor(1_500);
      return view.until((v) => !v.running);
    };
    check("stops running and shows no reply", async () => {
      const view = await failed();
      expect(view.entries.filter((e) => e.kind === "assistant")).toEqual([]);
    });
    check("shows why the turn failed", async () => {
      const view = await failed();
      expect(JSON.stringify(view.entries.filter((e) => e.kind !== "user"))).toContain(FAILURE);
    });
  });

  describe("a held question and its answer", () => {
    check("shows the thread waiting on its question, and the answer clears it", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("threads");
      const board = tasks(lab, id);
      await lab.send(id, ASK.question);
      const held = await board.until((r) => r.some((t) => t.waitingOn?.kind === "question"));
      const task = held.find((t) => t.waitingOn?.kind === "question")!;
      expect(task.waitingOn!.prompt).toBe(QUESTION);
      expect(["in_progress", "held"]).toContain(task.status);
      await lab.sayInThread(id, task.id, "EU");
      await board.until((r) => r.some((t) => t.id === task.id && t.waitingOn === undefined && t.status !== "held"));
    });
  });

  describe("a stop", () => {
    /** A session whose running turn was stopped, and how many replies it held then. */
    const stopped = async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      await lab.send(id, ASK.long);
      const running = await view.until((v) => v.running);
      const before = running.entries.filter((e) => e.kind === "assistant").length;
      await lab.interrupt(id);
      await view.until((v) => !v.running);
      await waitFor(1_500);
      return { view: view.latest()!, before };
    };
    check("ends the running turn, and nothing more of it is written", async () => {
      const { view, before } = await stopped();
      expect(view.running).toBe(false);
      expect(view.entries.filter((e) => e.kind === "assistant").length).toBe(before);
    });
    check("shows that the turn was stopped, after its last entry, and says stopping until it ended", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      await lab.send(id, ASK.long);
      const running = await view.until((v) => v.running);
      const turn = running.requestId;
      const pressed = lab.interrupt(id);
      await view.until((v) => v.stopping);
      await pressed;
      const ended = await view.until((v) => !v.running && !v.stopping && v.entries.some((e) => e.kind === "stopped"));
      const stopped = ended.entries.filter((e) => e.kind === "stopped");
      expect(stopped).toHaveLength(1);
      // After the stopped turn's own line, and last: nothing came after it.
      const at = ended.entries.indexOf(stopped[0]!);
      expect(ended.entries.findIndex((e) => e.kind === "user" && e.text === ASK.long)).toBeLessThan(at);
      expect(at).toBe(ended.entries.length - 1);
      if (target.aborts !== undefined) {
        // One abort, for the turn that ran; the line names that turn, from its record.
        expect(target.aborts).toEqual([expect.stringContaining(`/requests/${turn}/abort`)]);
        expect(stopped[0]!.requestId).toBe(turn);
        expect(ended.entries[at - 1]!.requestId).toBe(turn);
      }
    });

    check("counts the background work the stopped turn left running, from the session's runs", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      const board = tasks(lab, id);
      await lab.send(id, ASK.stopWithTasks);
      await board.until((r) => r.filter((t) => t.status === "in_progress").length === 2);
      await view.until((v) => v.running);
      await lab.interrupt(id);
      await view.until((v) => !v.running && v.entries.some((e) => e.kind === "stopped"));
      // The count is the work still running, whichever turn filed it: the board's running rows.
      const counted = await view.until((v) => v.backgroundRunning !== null && v.backgroundRunning > 0);
      expect(counted.backgroundRunning).toBeLessThanOrEqual(2);
      if (target.aborts !== undefined) {
        // Stop stops the turn only: both tasks it filed still run, until their own end.
        expect(counted.backgroundRunning).toBe(2);
        target.releaseResearch();
        await view.until((v) => v.backgroundRunning === 0, 20_000);
      }
    });

    check("keeps the stopped line after the stopped turn when a newer turn completes", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      await lab.send(id, ASK.long);
      const turn = (await view.until((v) => v.running)).requestId;
      await lab.interrupt(id);
      await view.until((v) => !v.running && v.entries.some((e) => e.kind === "stopped"));
      await lab.send(id, ASK.after);
      const later = await view.until((v) => !v.running && v.entries.at(-1)?.kind === "assistant" && v.entries.some((e) => e.kind === "user" && e.text === ASK.after));
      const stopped = later.entries.filter((e) => e.kind === "stopped");
      expect(stopped).toHaveLength(1);
      const at = later.entries.indexOf(stopped[0]!);
      expect(later.entries.findIndex((e) => e.kind === "user" && e.text === ASK.after)).toBeGreaterThan(at);
      if (target.aborts !== undefined) expect(later.entries[at - 1]!.requestId).toBe(turn);
    });
  });

  describe("a lapsed connection", () => {
    check("says lapsed while the host is gone, and live once it is back", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      await view.until((v) => v.connection === "live");
      target.lose();
      await view.until((v) => v.connection === "lapsed");
      target.restore();
      await view.until((v) => v.connection === "live", 40_000);
    });
  });
});
