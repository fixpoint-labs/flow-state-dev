// @vitest-environment happy-dom
/**
 * The lab's contract matrix: what the screen reads through `src/app/`'s hooks
 * and writes through its calls, in six scenarios, each run against the
 * scripted server (`test/scripted-server.ts`, which the screen tests draw on)
 * and against the lab's own host (`host.mts`, in process, with only the model
 * scripted and every coding run on harness-manager's scripted coder). Both
 * columns go through the same hooks and share every assertion, so a package
 * change that alters what the hooks hand the screen fails here, and a scripted
 * server that serves what the real host can't fails too. The Claude Code-style
 * lab runs the same scenarios on its own hooks.
 *
 * A stop is a task's Cancel, or Stop on the worker's turn. Its main worker
 * takes a task's result as a turn of its own, after the one that filed it.
 *
 * The screen reads a conversation's tasks through harness-manager's coding
 * board view and acts on them through orchestration's Inbox client, and the
 * scripted server files no tasks: the task scenarios run on the real column
 * only, through that view and that client.
 *
 * A gap the lab will close is listed in `GAPS` with its issue: that
 * assertion runs as `it.fails`, so it stays green while the gap is there and
 * turns red the day the issue lands, and that PR removes the mark.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { createElement, Fragment, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type Client, type SessionConnectionStatus, type UploadRequest } from "@flow-state-dev/client";
import type { FileContent } from "@flow-state-dev/core/items";
import { codingBoardViewRef, type CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { createInboxClient } from "@flow-state-dev/orchestration/inbox";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { pluggable, scriptedModels, waitFor } from "../../../test-support/contract";
import { openTeammates } from "../../host.mts";
import { AppProvider, ConversationFollower, useAppClient, useConversationCalls } from "../../src/app";
import type { ConversationEntry, ConversationView } from "../../src/lib/conversation";
import type { AppConnection } from "../../src/lib/files";
import { Entry } from "../../src/components/Entry";
import { scriptedServer } from "../scripted-server";

// The scenarios drive the hooks from outside React, as the host's answers arrive: no act() to wrap them in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

/** Stops a watch. */
type Unsubscribe = () => void;

/** What a conversation's follower read, as every screen on it reads it. */
type Read = { view: ConversationView; connection: SessionConnectionStatus };

/** The screen's half of the lab, on one client: its provider, a follower per conversation a scenario watches, and its calls. */
interface Screen {
  open(worker: string): Promise<string>;
  send(id: string, text: string, files?: readonly FileContent[]): Promise<void>;
  interrupt(id: string): Promise<void>;
  retry(id: string, requestId: string): Promise<void>;
  upload(request: UploadRequest): Promise<FileContent>;
  readFile(file: FileContent): Promise<Blob>;
  /** What conversation `id`'s follower read, on each change; its follower is mounted from the first watch on. */
  watch(id: string, on: (read: Read) => void): Unsubscribe;
  close(): void;
}

/** The provider over `client` and `connection`, drawn, with its calls and conversations held for a scenario to drive. */
function mountScreen(client: Client, connection: AppConnection): Screen {
  let held: { app: ReturnType<typeof useAppClient>; calls: ReturnType<typeof useConversationCalls> } | undefined;
  let follow: (ids: string[]) => void = () => {};
  const followed: string[] = [];
  function Probe() {
    const [ids, setIds] = useState<string[]>([]);
    follow = setIds;
    held = { app: useAppClient(), calls: useConversationCalls() };
    return createElement(Fragment, null, ...ids.map((id) => createElement(ConversationFollower, { key: id, sessionId: id })));
  }
  const drawn = render(createElement(AppProvider, { client, connection, pollIntervalMs: 150 }, createElement(Probe)));
  const calls = () => held!.calls;
  return {
    open: (worker) => calls().open(worker),
    send: (id, text, files = []) => calls().send(id, text, files),
    interrupt: (id) => calls().stop(id),
    retry: (id, requestId) => calls().retry(id, requestId),
    upload: (request) => calls().upload(request),
    readFile: (file) => calls().readFile(file),
    watch(id, on) {
      if (!followed.includes(id)) {
        followed.push(id);
        follow([...followed]);
      }
      const { conversations } = held!.app;
      let last: unknown;
      const tell = () => {
        const read = conversations.read(id);
        if (read?.view === undefined || read === last) return;
        last = read;
        on({ view: read.view, connection: read.connection });
      };
      const stop = conversations.subscribe(tell);
      tell();
      return stop;
    },
    close: () => drawn.unmount(),
  };
}

const CHIEF = "teammates.chief-of-staff";
const CODER = "teammates.cursor";

/** One column of the matrix: the screen's half on a server, and what a scenario does to the server behind it. */
interface Target {
  lab: Screen;
  /** The next line's turn fails at its model call. */
  failNextTurn(): void;
  /** The host stops answering; `restore` brings it back. */
  lose(): void;
  restore(): void;
  /** The next abort is answered 409 and goes no further, as when an answer resumed the turn first. */
  refuseNextAbort(): void;
  /** The abort calls the screen posted, by URL; the scripted server takes none over a fetch, so it has none. */
  aborts?: string[];
  /** The client the real column's screen reads its tasks through; the scripted one files none. */
  client?: Client;
  /** How many of the conversation's turns the server holds `in_progress` now, from its request rows; the scripted one says none. */
  turnsRunning?(sessionId: string): Promise<number>;
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
  /** More lines sent while a turn runs: like `meanwhile`, each one's turn works on until it is stopped. */
  beside: ["Meanwhile, list the launch risks.", "Meanwhile, check the launch date."],
  /** A line sent as a turn ends. */
  next: "Add the beta numbers.",
  /** A line sent with a screenshot. */
  shot: "What does this screenshot show?",
};

/** What the lead says when its model was handed the line's image: only a turn that got it can say it. */
const SAW_IMAGE = "I see the screenshot.";

/** A tiny PNG, as the composer would upload it. */
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

/** The last user message of a step's messages: what this turn answers, not what an earlier one did. */
const lastUserLine = (said: string) => said.slice(said.lastIndexOf('"role":"user"'));

/** The scripted server. */
function scriptedTarget(): Target {
  const server = scriptedServer({ speed: 0.2 });
  const lab = mountScreen(server.client, server.connection);
  return {
    lab,
    failNextTurn: () => server.failNextTurn(FAILURE),
    lose: () => server.setConnection("lapsed"),
    restore: () => server.setConnection("live"),
    refuseNextAbort: () => server.refuseNextStop(),
    close: async () => lab.close(),
  };
}

/** The workers' turns, by the worker a step is for. Only the model is scripted; every tool runs for real. */
function appScript(failing: { next: boolean }): ModelResolver {
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
        // The lead
        if (failing.next) {
          failing.next = false;
          throw new Error(FAILURE);
        }
        const asked = lastUserLine(said);
        // The line's image, as the model is handed it: a file part of its type.
        if (asked.includes(ASK.shot)) return { text: asked.includes("image/png") ? SAW_IMAGE : "I see no image." };
        if (asked.includes(ASK.stopMe) && step < 2) {
          const module = step === 0 ? "A" : "B";
          return { call: { name: "createTask", args: { assignee: CODER, title: `Fix module ${module}`, goal: `Fix the typo in module ${module}.` } } };
        }
        if (asked.includes(ASK.stopMe) || asked.includes("Meanwhile,")) {
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
    // Off this file's own path: the DOM's URL, which the hooks need here, isn't Node's.
    tree: join(dirname(fileURLToPath(import.meta.url)), "../../workforce"),
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 50,
    modelResolver: appScript(failing),
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
  const client = createClient({ userId: "you", baseUrl: "", fetcher: plug.fetcher as never });
  const lab = mountScreen(client, { fetcher: plug.fetcher as never });
  return {
    lab,
    failNextTurn: () => (failing.next = true),
    lose: () => plug.pull(),
    restore: () => plug.restore(),
    refuseNextAbort: () => (refuse.next = true),
    aborts,
    client,
    turnsRunning: async (sessionId) =>
      (await client.sessions.requests(sessionId, { limit: 20 })).filter((r) => r.actionName === "respond" && r.status === "in_progress").length,
    close: async () => {
      lab.close();
      plug.restore();
      await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

/** Assertions the lab can't meet yet, by column, with the issue that closes each. */
const GAPS: Record<string, { real?: string; scripted?: string }> = {
};

const stops: Unsubscribe[] = [];
let target: Target | undefined;
/** The lead's conversation the scenario opened. */
let chiefId: string | undefined;
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

const conversation = (lab: Screen, id: string) => follow<ConversationView>((on) => lab.watch(id, (read) => on(read.view)));
/** A conversation's tasks as the screen reads them: the coding board view, read every 200 ms. */
const tasks = (client: Client, id: string) =>
  follow<CodingBoardTask[]>((on) => {
    let live = true;
    const read = async () => {
      while (live) {
        on((await client.view(codingBoardViewRef(), { sessionId: id })).value);
        await waitFor(200);
      }
    };
    void read().catch(() => {});
    return () => {
      live = false;
    };
  });

/** The board's actions on conversation `id`'s tasks, as the screen sends them: the Inbox client's `board(at)`. */
const boardOf = async (client: Client, id: string) => {
  const detail = await client.sessions.get(id);
  return createInboxClient(client).board({ flowId: detail.flowId ?? detail.flowKind, sessionId: id, board: "tasks" });
};
const connection = (lab: Screen, id: string) => follow<SessionConnectionStatus>((on) => lab.watch(id, (read) => on(read.connection)));

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

/** Presses Stop until the conversation reads nothing running. */
async function stopAll(lab: Screen, id: string, view: Followed<ConversationView>) {
  for (let press = 0; press < 10 && view.latest()!.running; press++) {
    await lab.interrupt(id);
    await waitFor(1_000);
  }
  await view.until((v) => !v.running, 30_000);
}

/** What a user line may carry: anything more is a state the screen could draw. */
const USER_LINE_KEYS = new Set(["kind", "id", "text"]);

/** The entries after your line `text`: what its turn, and any later one, wrote. */
const afterLine = (view: ConversationView, text: string) => {
  const at = view.entries.findIndex((e) => e.kind === "user" && e.text === text);
  return at < 0 ? [] : view.entries.slice(at + 1);
};

/**
 * A line of yours says only what you typed: it carries no field past its text, and the conversation
 * draws nothing more for it, such as a mark that it waits for the worker's answer.
 */
function expectPlainLine(view: ConversationView, text: string) {
  const line = view.entries.find((e) => e.kind === "user" && e.text === text) as ConversationEntry | undefined;
  expect(line, `the line "${text}" is in the conversation`).toBeDefined();
  expect(Object.keys(line!).filter((key) => !USER_LINE_KEYS.has(key))).toEqual([]);
  const entry = createElement(Entry, { entry: line!, workerName: "Lead", nameOf: (id: string) => id, lookOf: () => ({ icon: "★", color: "amber" as const }) });
  expect(renderToStaticMarkup(entry).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")).toBe(text);
}

describe.each([
  ["scripted", async () => scriptedTarget()],
  ["real", async () => realTarget()],
] as const)("the %s server", (column, make) => {
  /** `it`, or `it.fails` when this column has a gap named for `name`. */
  const check = (name: string, run: () => Promise<void>) => {
    const gap = GAPS[name]?.[column];
    return gap === undefined ? it(name, run, 60_000) : it.fails(`${name} (gap: ${gap})`, run, 60_000);
  };
  /** The lead's conversation, on a fresh target. */
  const chief = async () => {
    target = await make();
    // Opening a conversation reads the roster first, as its follower does: a line under a worker's name it knows
    // is drawn as that worker's.
    const id = await target.lab.open(CHIEF);
    chiefId = id;
    return { lab: target.lab, id };
  };

  // The scripted server files no tasks: these read the real host's board, as the screen does.
  if (column === "real") {
    describe("a result that lands mid-turn", () => {
      check("shows the task's result under the worker that ran it, once its review is accepted, and the row reads done", async () => {
        const { lab, id } = await chief();
        const client = target!.client!;
        const view = conversation(lab, id);
        const board = tasks(client, id);
        await lab.send(id, ASK.result);
        const filed = await view.until((v) => v.entries.some((e) => e.kind === "task"));
        const card = filed.entries.find((e) => e.kind === "task") as { taskId: string; to: string };
        // A coding run that committed waits for your review, answerable once the view knows the run's flow.
        const held = await board.until((r) => r.some((t) => t.id === card.taskId && t.asks[0]?.ask.kind === "review" && t.asks[0].unanswerable === null), 30_000);
        await createInboxClient(client).answerOne(held.find((t) => t.id === card.taskId)!.asks[0]!, { value: { verdict: "accepted" } });
        await view.until((v) => v.entries.some((e) => e.kind === "result" && e.taskId === card.taskId && e.from === card.to && e.failed !== true && e.text.length > 0));
        await board.until((r) => r.some((t) => t.id === card.taskId && t.status === "completed"));
      });
    });

  describe("a line sent mid-turn", () => {
    check("starts its own turn at once, beside the running one, and nothing says it waits", async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      // Every view the conversation draws, not only the latest: a mark drawn for a moment counts.
      const drawn: ConversationView[] = [];
      stops.push(lab.watch(id, (read) => drawn.push(read.view)));
      await lab.send(id, ASK.meanwhile);
      await view.until((v) => v.running && v.entries.some((e) => e.kind === "user" && e.text === ASK.meanwhile));
      for (const line of ASK.beside) await lab.send(id, line);
      // Both lines are in the conversation while it reads running.
      await view.until((v) => v.running && ASK.beside.every((line) => v.entries.some((e) => e.kind === "user" && e.text === line)));
      if (target!.turnsRunning !== undefined) {
        // On the server all three turns run at once: none waits to start.
        await readUntil(() => target!.turnsRunning!(id), (count) => count === 3);
        // Then past the conversation's next read of the requests, so it has drawn all three running.
        await waitFor(2_000);
        expect(view.latest()!.running).toBe(true);
      }
      // No line was ever drawn with a mark, in any view.
      for (const v of drawn) for (const e of v.entries) if (e.kind === "user") expectPlainLine(v, e.text);
      // Stopped, so the host can close. A Stop stops the turns the view had read as running at the
      // press, and its request read can trail the sends, so Stop is pressed until none runs.
      await stopAll(lab, id, view);
    });

    check("a line sent as a turn ends is answered too, and nothing says it waited", async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      await lab.send(id, ASK.hello);
      // The turn's text is in: it is ending.
      await view.until((v) => afterLine(v, ASK.hello).some((e) => e.kind === "assistant"), 30_000);
      await lab.send(id, ASK.next);
      const ended = await view.until((v) => !v.running && afterLine(v, ASK.next).some((e) => e.kind === "assistant"), 30_000);
      expectPlainLine(ended, ASK.hello);
      expectPlainLine(ended, ASK.next);
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
    check("offers Retry on it, which runs it again as a new request that answers", async () => {
      const view = await failed();
      const line = after(view).find((e): e is Extract<ConversationEntry, { kind: "failed" }> => e.kind === "failed");
      expect(line).toMatchObject({ reason: expect.stringContaining(FAILURE), retryable: true });
      await target!.lab.retry(chiefId!, line!.requestId);
      const answered = await conversation(target!.lab, chiefId!).until((v) => !v.running && after(v).some((e) => e.kind === "assistant"), 30_000);
      // The failed line stays, with no Retry: the new request is the newest turn now.
      expect(after(answered).filter((e) => e.kind === "failed").map((e) => (e as { retryable: boolean }).retryable)).toEqual([false]);
    });
  });

    describe("a held question and its answer", () => {
      check("shows the task waiting on its question, and the answer clears it", async () => {
        const { lab, id } = await chief();
        const client = target!.client!;
        const board = tasks(client, id);
        await lab.send(id, ASK.question);
        const held = await board.until((r) => r.some((t) => t.asks[0]?.ask.kind === "question" && t.asks[0].unanswerable === null));
        const task = held.find((t) => t.asks[0]?.ask.kind === "question")!;
        expect(task.asks[0]).toMatchObject({ ask: { kind: "question", prompt: QUESTION }, unanswerable: null });
        expect(task.status).toBe("in_progress");
        await createInboxClient(client).answerOne(task.asks[0]!, { text: "Only line 1." });
        await board.until((r) => r.some((t) => t.id === task.id && t.asks.length === 0));
      });
    });

    describe("a stop", () => {
      check("cancels a running task, and it stays cancelled", async () => {
        const { lab, id } = await chief();
        const client = target!.client!;
        const board = tasks(client, id);
        await lab.send(id, ASK.long);
        const running = await board.until((r) => r.some((t) => t.status === "in_progress"));
        const task = running.find((t) => t.status === "in_progress")!;
        await (await boardOf(client, id)).cancel(task.id);
        await board.until((r) => r.some((t) => t.id === task.id && t.status === "cancelled"));
        await waitFor(1_500);
        expect(board.latest()!.find((t) => t.id === task.id)!.status).toBe("cancelled");
      });
    });
  }

  describe("a turn stop", () => {
    /** The tasks the turn files: the real lead files two; the scripted one files none. */
    const filed = column === "real" ? 2 : 0;
    /** The lead's conversation, answering a turn that filed its tasks and works on. */
    const answering = async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      await lab.send(id, ASK.stopMe);
      // Stop is on screen while the view reads the worker answering.
      await view.until((v) => v.running && v.entries.some((e) => e.kind === "user" && e.text === ASK.stopMe) && v.entries.filter((e) => e.kind === "task").length === filed, 30_000);
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
      expect(ended.entries.slice(0, at).filter((e) => e.kind === "task")).toHaveLength(filed);
      expect(at).toBe(ended.entries.length - 1);
      // One abort, for the answering turn: none for the board's own passes.
      if (target!.aborts !== undefined) expect(target!.aborts).toHaveLength(1);
    });

    // The scripted server runs no background work: only the real column has tasks left running.
    if (column === "real") {
      check("counts the background work the stopped turn left running, from the session's runs", async () => {
        const { lab, id, view } = await answering();
        const client = target!.client!;
        const board = tasks(client, id);
        await lab.interrupt(id);
        await view.until((v) => !v.running && v.entries.some((e) => e.kind === "stopped"));
        const counted = await view.until((v) => v.backgroundRunning !== null && v.backgroundRunning > 0, 30_000);
        // Stop stops the turn only: both tasks it filed still run, until their own end.
        expect(counted.backgroundRunning).toBe(2);
        const rows = await board.until((r) => r.filter((t) => t.status === "in_progress").length === 2);
        const actions = await boardOf(client, id);
        for (const row of rows) await actions.cancel(row.id);
        await view.until((v) => v.backgroundRunning === 0, 30_000);
      });
    }

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
      await expect(lab.interrupt(id)).rejects.toThrow(/Stop it again/);
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

  describe("a line with files", () => {
    check("carries the file to the worker, draws it on your line, and reads its bytes back", async () => {
      const { lab, id } = await chief();
      const view = conversation(lab, id);
      const shot = await lab.upload({ data: new Blob([PNG], { type: "image/png" }), mediaType: "image/png", filename: "bug.png" });
      expect(shot.data).toMatch(/^fsd-blob:/);
      await lab.send(id, ASK.shot, [shot]);
      const sent = await view.until((v) => v.entries.some((e) => e.kind === "user" && e.text === ASK.shot), 30_000);
      const line = sent.entries.find((e) => e.kind === "user" && e.text === ASK.shot) as Extract<ConversationEntry, { kind: "user" }>;
      // A reference on the line, never the bytes.
      expect(line.files).toEqual([{ type: "file", data: shot.data, mediaType: "image/png", filename: "bug.png" }]);
      expect(new Uint8Array(await (await lab.readFile(line.files![0])).arrayBuffer())).toEqual(PNG);
      // Only the real column has a model: its answer says the turn was handed the image.
      if (column === "real") {
        const answered = await view.until((v) => afterLine(v, ASK.shot).some((e) => e.kind === "assistant"), 30_000);
        expect(afterLine(answered, ASK.shot).find((e) => e.kind === "assistant")).toMatchObject({ text: SAW_IMAGE });
      }
      await stopAll(lab, id, view);
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
