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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { pluggable, scriptedModels, waitFor } from "../../../test-support/contract";
import { openLab } from "../../host.mts";
import { createWiredLab, type LabAdapter, type LabTask, type ThreadView, type Unsubscribe } from "../../src/adapter";
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
  close(): Promise<void>;
}

/** The reason a failed turn's model call gives, which the thread should show. */
const FAILURE = "The model provider is down.";
/** The question a thread holds on. */
const QUESTION = "Which region matters, EU or US?";
const ASK = { midTurn: "Compare Acme and Globex for us.", long: "Write the long version of the notes.", failing: "Summarize the notes.", question: "Find where Vendor B hosts." };

function fakeTarget(): Target {
  const fake = createFakeLab({ speed: 0.1 });
  return {
    lab: fake,
    open: async (mode) => (await fake.openSession(mode, "project-vendor-notes")).id,
    failNextTurn: () => fake.failNextTurn(FAILURE),
    lose: () => fake.setConnection("lapsed"),
    restore: () => fake.setConnection("live"),
    close: async () => {},
  };
}

/** The workers' turns, by the worker a step is for. Only the model is scripted; every tool runs for real. */
function labScript(failing: { next: boolean }): ModelResolver {
  let researched: () => void = () => {};
  const research = new Promise<void>((resolve) => (researched = resolve));
  const worker = (said: string) => /You are ([\w-]+)/.exec(said)?.[1];
  return scriptedModels(
    {
      "agent-answer": async ({ said, step, signal }) => {
        const who = worker(said);
        if (who === "researcher") {
          researched();
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
        if (said.includes(ASK.long)) {
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
      // Each session is titled after its turn; the title is not what these rows check.
      "auto-title:generate": () => ({ output: { title: "Vendor notes" } }),
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
  // A project is refused when its repository would commit a run's question files.
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", repo, "add", "-A"], { env: git });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: git });
  const failing = { next: false };
  const { flowState } = await openLab({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: [], modelResolver: labScript(failing) });
  const plug = pluggable(createInProcessFetch(flowState as never) as never);
  const lab = createWiredLab(createClient({ userId: "u_lab", baseUrl: "", fetcher: plug.fetcher as never }));
  const project = await lab.createProject("vendor-notes", `file://${repo}`);
  return {
    lab,
    open: async (mode) => (await lab.openSession(mode, project.id)).id,
    failNextTurn: () => (failing.next = true),
    lose: () => plug.pull(),
    restore: () => plug.restore(),
    close: async () => {
      plug.restore();
      await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

/** Assertions the real adapter can't meet yet, by column, with the issue that closes each. */
const GAPS: Record<string, { real?: string; fake?: string }> = {
  "shows that the turn was stopped": { real: "FIX-2375" },
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
const tasks = (lab: LabAdapter, id: string) => follow<LabTask[]>((on) => lab.watchTasks(id, on));

describe.each([
  ["fake", async () => fakeTarget()],
  ["real", realTarget],
] as const)("the %s adapter", (column, make) => {
  /** `it`, or `it.fails` when this column has a gap named for `name`. */
  const check = (name: string, run: () => Promise<void>) => {
    const gap = GAPS[name]?.[column];
    return gap === undefined ? it(name, run, 60_000) : it.fails(`${name} (gap: ${gap})`, run, 60_000);
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
      const held = await board.until((r) => r.some((t) => t.openHold?.kind === "question"));
      const task = held.find((t) => t.openHold?.kind === "question")!;
      expect(task.openHold!.prompt).toBe(QUESTION);
      expect(["in_progress", "held"]).toContain(task.status);
      await lab.sayInThread(id, task.id, "EU");
      await board.until((r) => r.some((t) => t.id === task.id && t.openHold === undefined && t.status !== "held"));
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
    check("shows that the turn was stopped", async () => {
      const { view } = await stopped();
      expect(view.entries.some((e) => e.kind === "interrupted")).toBe(true);
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
