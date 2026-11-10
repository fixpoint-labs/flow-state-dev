/**
 * The lab's contract matrix: six scenarios, each run against the test double
 * (`test/fake-lab.ts`) and against the real adapter over the lab's own host
 * (`host.mts`, in process, with only the model scripted). Both columns share
 * every assertion, so a package change that alters what the adapter hands the
 * screen fails here, and a fake that draws what the real adapter can't fails
 * too. The Teammates lab runs the same scenarios on its own adapter.
 *
 * A gap the real adapter will close is listed in `GAPS` with its issue: that
 * assertion runs as `it.fails`, so it stays green while the gap is there and
 * turns red the day the issue lands, and that PR removes the mark.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { pluggable, scriptedModels, waitFor } from "../../../test-support/contract";
import { openLab } from "../../host.mts";
import { createWiredLab, type LabAdapter, type LabTask, type ThreadEntry, type ThreadView, type Unsubscribe } from "../../src/adapter";
import { Entry } from "../../src/components/Entry";
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
  /** The next abort is answered 409 and goes no further, as when an answer resumed the turn first. */
  refuseNextAbort(): void;
  /** Lets the research the stop scenario holds finish. */
  releaseResearch(): void;
  /** The abort calls the adapter posted, by URL; the fake posts none, so it has none. */
  aborts?: string[];
  /** How many of the session's turns the server holds `in_progress` now, from its request rows; the fake has none. */
  turnsRunning?(sessionId: string): Promise<number>;
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
  /** Lines sent while a turn runs: each one's turn works on until it is stopped. */
  beside: ["Meanwhile, add a risks section.", "Meanwhile, list the open questions."],
  /** A line sent as a turn ends. */
  next: "Add a risks section.",
  /** A line sent with a screenshot. */
  shot: "What does this screenshot show?",
};

/** What the main session says when its model was handed the line's image: only a turn that got it can say it. */
const SAW_IMAGE = "I see the screenshot.";

/** A tiny PNG, as the composer would upload it. */
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
/** A research task's goal carries this while the stop scenario holds it running. */
const HELD = "[held]";

/** The last user message of a step's messages: what this turn answers, not what an earlier one did. */
const lastUserLine = (said: string) => said.slice(said.lastIndexOf('"role":"user"'));

function fakeTarget(): Target {
  const fake = createFakeLab({ speed: 0.1 });
  return {
    lab: fake,
    open: async (mode) => (await fake.openSession(mode, "project-vendor-notes")).id,
    failNextTurn: () => fake.failNextTurn(FAILURE),
    lose: () => fake.setConnection("lapsed"),
    restore: () => fake.setConnection("live"),
    releaseResearch: () => {},
    refuseNextAbort: () => fake.refuseNextStop(),
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
        // The line's image, as the model is handed it: a file part of its type.
        if (lastUserLine(said).includes(ASK.shot)) return { text: lastUserLine(said).includes("image/png") ? SAW_IMAGE : "I see no image." };
        if (lastUserLine(said).includes(ASK.stopWithTasks)) {
          if (step < 2) {
            const vendor = step === 0 ? "Acme" : "Globex";
            return { call: { name: "createTask", args: { assignee: "desk.researcher", title: `Research ${vendor}`, goal: `${HELD} Find ${vendor}'s price.` } } };
          }
          await waitFor(30_000, signal);
          if (signal?.aborted) throw new DOMException("The turn was stopped.", "AbortError");
          return { text: "The comparison, finished." };
        }
        if (lastUserLine(said).includes(ASK.long) || lastUserLine(said).includes("Meanwhile,")) {
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
  let releaseResearch: () => void = () => {};
  const held = new Promise<void>((resolve) => (releaseResearch = resolve));
  const { flowState } = await openLab({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: [], modelResolver: labScript(failing, held) });
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
  const client = createClient({ userId: "u_lab", baseUrl: "", fetcher: plug.fetcher as never });
  const lab = createWiredLab(client, { fetcher: plug.fetcher as never });
  const project = await lab.createProject("vendor-notes", `file://${repo}`);
  return {
    lab,
    open: async (mode) => (await lab.openSession(mode, project.id)).id,
    failNextTurn: () => (failing.next = true),
    lose: () => plug.pull(),
    restore: () => plug.restore(),
    releaseResearch: () => releaseResearch(),
    refuseNextAbort: () => (refuse.next = true),
    aborts,
    turnsRunning: async (sessionId) =>
      (await client.sessions.requests(sessionId, { limit: 20 })).filter((r) => r.actionName === "respond" && r.status === "in_progress").length,
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

/** Reads `read` every 100 ms until `check` holds for it, or fails after `ms`. */
async function readUntil<T>(read: () => Promise<T>, check: (value: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  let last = await read();
  while (!check(last)) {
    if (Date.now() > end) throw new Error(`condition never held; last read: ${JSON.stringify(last)}`);
    await waitFor(100);
    last = await read();
  }
  return last;
}

/** What a user line may carry: anything more is a state the screen could draw. */
const USER_LINE_KEYS = new Set(["kind", "id", "text", "sentToThread", "requestId"]);

/**
 * A line of yours says only what you typed: it carries no field past its text, and the thread draws
 * nothing more for it, such as a mark that it waits.
 */
function expectPlainLine(view: ThreadView, text: string) {
  const line = view.entries.find((e) => e.kind === "user" && e.text === text) as ThreadEntry | undefined;
  expect(line, `the line "${text}" is in the thread`).toBeDefined();
  expect(Object.keys(line!).filter((key) => !USER_LINE_KEYS.has(key))).toEqual([]);
  const drawn = renderToStaticMarkup(createElement(Entry, { entry: line! })).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  expect(drawn).toBe(text);
}
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

  describe("a line sent mid-turn", () => {
    check("starts its own turn at once, beside the running one, and nothing says it waits", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      // Every view the thread draws, not only the latest: a mark drawn for a moment counts.
      const drawn: ThreadView[] = [];
      stops.push(lab.watchThread(id, (v) => drawn.push(v)));
      await lab.send(id, ASK.long);
      await view.until((v) => v.running);
      for (const line of ASK.beside) await lab.send(id, line);
      // Both lines are in the thread while it reads running.
      await view.until((v) => v.running && ASK.beside.every((line) => v.entries.some((e) => e.kind === "user" && e.text === line)));
      if (target.turnsRunning !== undefined) {
        // On the server all three turns run at once: none waits to start.
        await readUntil(() => target!.turnsRunning!(id), (count) => count === 3);
        // Then past the thread's next read of the turns, so it has drawn all three running.
        await waitFor(2_000);
        expect(view.latest()!.running).toBe(true);
      }
      // No line was ever drawn with a mark, in any view.
      for (const v of drawn) for (const e of v.entries) if (e.kind === "user") expectPlainLine(v, e.text);
      // Stopped, so the host can close. A Stop stops the turns the thread had read as running at the
      // press, and its request read can trail the sends, so Stop is pressed until none runs.
      for (let press = 0; press < 10 && view.latest()!.running; press++) {
        await lab.interrupt(id);
        await waitFor(1_000);
      }
      await view.until((v) => !v.running, 20_000);
    });

    check("a line sent as a turn ends is answered too, and nothing says it waited", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      await lab.send(id, ASK.after);
      // The turn's text is in: it is ending.
      await view.until((v) => v.entries.some((e) => e.kind === "assistant"));
      await lab.send(id, ASK.next);
      const answered = (v: ThreadView) => v.entries.slice(v.entries.findIndex((e) => e.kind === "user" && e.text === ASK.next) + 1).some((e) => e.kind === "assistant");
      const ended = await view.until((v) => !v.running && v.entries.some((e) => e.kind === "user" && e.text === ASK.next) && answered(v), 20_000);
      expectPlainLine(ended, ASK.after);
      expectPlainLine(ended, ASK.next);
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

    check("a stop the server refuses while the turn runs on clears stopping, says why, and draws no stopped line", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      await lab.send(id, ASK.long);
      await view.until((v) => v.running);
      target.refuseNextAbort();
      await expect(lab.interrupt(id)).rejects.toThrow(/Press Stop again/);
      // The record still reads running: no stopped line, and Stop is offered again.
      await waitFor(300);
      const after = view.latest()!;
      expect(after.running).toBe(true);
      expect(after.stopping).toBe(false);
      expect(after.entries.some((e) => e.kind === "stopped")).toBe(false);
      // Pressed again, it stops.
      await lab.interrupt(id);
      await view.until((v) => !v.running && v.entries.some((e) => e.kind === "stopped"));
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

  describe("a line with files", () => {
    check("carries the file to the main session, draws it on your line, and reads its bytes back", async () => {
      target = await make();
      const { lab } = target;
      const id = await target.open("session");
      const view = thread(lab, id);
      const shot = await lab.upload({ data: new Blob([PNG], { type: "image/png" }), mediaType: "image/png", filename: "bug.png" });
      expect(shot.data).toMatch(/^fsd-blob:/);
      await lab.send(id, ASK.shot, [shot]);
      const sent = await view.until((v) => v.entries.some((e) => e.kind === "user" && e.text === ASK.shot), 30_000);
      const line = sent.entries.find((e) => e.kind === "user" && e.text === ASK.shot) as Extract<ThreadEntry, { kind: "user" }>;
      // A reference on the line, never the bytes.
      expect(line.files).toEqual([{ type: "file", data: shot.data, mediaType: "image/png", filename: "bug.png" }]);
      expect(new Uint8Array(await (await lab.readFile(line.files![0])).arrayBuffer())).toEqual(PNG);
      // Only the real column has a model: its answer says the turn was handed the image.
      if (column === "real") {
        const answered = await view.until((v) => !v.running && v.entries.some((e) => e.kind === "assistant" && e.text === SAW_IMAGE), 30_000);
        expect(answered.entries.some((e) => e.kind === "assistant" && e.text === SAW_IMAGE)).toBe(true);
      }
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
