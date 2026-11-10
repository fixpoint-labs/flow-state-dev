/**
 * The host-parity check: a rebuilt teammates host serves the same flows as
 * today's, and each one is wired. Retained POC evidence, never shipped; `run.sh`
 * copies it into `labs/teammates/test/` for the run, beside a copy of each host
 * as `host.zz-<name>.mts`, and removes them afterwards.
 *
 * For each host named in `FIX2622_HOSTS` (comma-separated), in process, with
 * only the model scripted and every coding run on harness-manager's scripted
 * harness:
 *
 * 1. `GET /api/flows` lists exactly the ids today's host lists: one copy per
 *    worker flow `hireWorkforce` registers, `workforce-roster`,
 *    `harness-readiness` and `lab-context`.
 * 2. One action per flow shows it is wired: `read` on the two read-only
 *    flows, a hire on the roster flow and a roster read that lists the hire,
 *    one scripted turn on the agent copy (Lead answers), and one on the coder
 *    copy (a task Lead files reaches the coding run's review).
 *
 * `FIX2622_EXPECT_RED=1` inverts the verdict for the control: the host must
 * fail the check, and the failure is printed for the record.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { scriptedModels, waitFor } from "../../test-support/contract";
import { createLabAdapter, type BoardTask, type ConversationView, type LabAdapter } from "../src/adapter";

const CHIEF = "teammates.chief-of-staff";
const CODER = "teammates.cursor";
const HELLO = "Hello there.";
const CODE = "Please fix the typo in the README.";
const HIRE = { name: "zzparity", role: "Checks the parity of hosts.", instructions: "Answer briefly." };

const HOSTS = (process.env.FIX2622_HOSTS ?? "today").split(",").filter((name) => name !== "");
const EXPECT_RED = process.env.FIX2622_EXPECT_RED === "1";

/** Lead files one coding task when asked to fix something, and otherwise says "Noted.". */
function script(): ModelResolver {
  return scriptedModels(
    {
      "agent-answer": ({ said, step }) => {
        const asked = said.slice(said.lastIndexOf('"role":"user"'));
        if (asked.includes(CODE) && step === 0) {
          return { call: { name: "createTask", args: { assignee: CODER, title: "Fix the typo", goal: "Fix the typo in the README's first line." } } };
        }
        return { text: step > 0 ? "Filed." : "Noted." };
      },
      "memory/observe": () => ({ output: { items: [] } }),
    },
    () => ({ text: "ok" }),
  ) as ModelResolver;
}

interface Opened {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  lab: LabAdapter;
  repo: string;
  close(): Promise<void>;
}

/** Opens `host.zz-<name>.mts` on a fresh store and a one-commit repository. */
async function open(name: string, extra: Record<string, unknown> = {}): Promise<Opened> {
  const data = mkdtempSync(join(tmpdir(), `fix2622-${name}-`));
  const repo = join(data, "repo");
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  writeFileSync(join(repo, "README.md"), "Relay keps your team in sync.\n");
  execFileSync("git", ["-C", repo, "add", "-A"], { env: git });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: git });
  const { openTeammates } = (await import(`../host.zz-${name}.mts`)) as { openTeammates: (options: Record<string, unknown>) => Promise<unknown> };
  const state = await openTeammates({
    store: join(data, "teammates.sqlite"),
    model: "test/scripted",
    userId: "you",
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 20,
    modelResolver: script(),
    ...extra,
  });
  const fetch = createInProcessFetch(state as never) as unknown as Opened["fetch"];
  const lab = createLabAdapter(createClient({ userId: "you", baseUrl: "", fetcher: fetch as never }));
  return {
    fetch,
    lab,
    repo,
    close: async () => {
      await (state as { dispose?: () => Promise<void> }).dispose?.();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

/** The ids `GET /api/flows` lists, sorted. */
async function servedIds(host: Opened): Promise<string[]> {
  const response = await host.fetch("/api/flows", { headers: { "x-user-id": "you" } });
  const body = (await response.json()) as unknown;
  if (response.status !== 200) throw new Error(`GET /api/flows answered ${response.status}: ${JSON.stringify(body)}`);
  const list = (Array.isArray(body) ? body : (body as { flows?: unknown[] }).flows ?? []) as Array<{ id?: string; kind?: string }>;
  return list.map((flow) => flow.id ?? flow.kind ?? "?").sort();
}

/** Resolves with the first value `watch` hands on that `check` holds for, or fails after `ms`. */
function until<T>(watch: (on: (value: T) => void) => () => void, check: (value: T) => boolean, ms = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let last: T | undefined;
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`condition never held; last value: ${JSON.stringify(last)?.slice(0, 800)}`));
    }, ms);
    stop = watch((value) => {
      last = value;
      if (!check(value)) return;
      clearTimeout(timer);
      queueMicrotask(() => stop());
      resolve(value);
    });
  });
}

/** Every check one host must pass. Throws the first that fails. */
async function parity(host: Opened, expectedIds: string[]): Promise<void> {
  const served = await servedIds(host);
  if (JSON.stringify(served) !== JSON.stringify(expectedIds)) {
    throw new Error(`the served flow ids aren't today's: served [${served.join(", ")}], today serves [${expectedIds.join(", ")}]`);
  }

  const context = await host.lab.readContext();
  expect(context.folder, "lab-context read").toBe(host.repo);
  expect(Object.keys(context.delegates), "lab-context lists the declared delegates").toContain(CHIEF);
  const harnesses = await host.lab.readHarnesses();
  expect(harnesses.length, "harness-readiness read: one row per harness").toBe(3);

  const before = await host.lab.listWorkers();
  const hired = await host.lab.hire(HIRE);
  const after = await host.lab.listWorkers();
  expect(before.some((w) => w.id === hired.id), "not on the roster before the hire").toBe(false);
  expect(after.some((w) => w.id === hired.id && w.own === true), "the roster read lists the hire").toBe(true);

  const id = await host.lab.openConversation(CHIEF);
  const watch = (on: (v: ConversationView) => void) => host.lab.watchConversation(id, on);
  await host.lab.send(id, HELLO);
  await until(watch, (v) => !v.running && v.entries.some((e) => e.kind !== "user" && "text" in e && e.text === "Noted."));

  await host.lab.send(id, CODE);
  const filed = await until(watch, (v) => v.entries.some((e) => e.kind === "task"));
  const card = filed.entries.find((e) => e.kind === "task") as unknown as { taskId: string; to: string };
  expect(card.to, "the task went to the coding worker").toBe(CODER);
  await until(
    (on: (rows: BoardTask[]) => void) => host.lab.watchTasks(id, on),
    (rows) => rows.some((t) => t.id === card.taskId && t.waiting?.kind === "review"),
    30_000,
  );
}

let expectedIds: string[] = [];
beforeAll(async () => {
  const today = await open("today");
  try {
    expectedIds = await servedIds(today);
  } finally {
    await today.close();
  }
  console.log(`today's host serves: ${expectedIds.join(", ")}`);
}, 60_000);

afterAll(() => waitFor(10));

describe.each(HOSTS)("host %s", (name) => {
  it(EXPECT_RED ? "fails the parity check (control)" : "serves today's flows, each wired", async () => {
    let host: Opened | undefined;
    let failure: unknown;
    try {
      host = await open(name);
      await parity(host, expectedIds);
    } catch (error) {
      failure = error;
    } finally {
      await host?.close();
    }
    if (EXPECT_RED) {
      expect(failure, `host ${name} should have failed the parity check`).toBeDefined();
      console.log(`RED (as required) for ${name}:\n${failure instanceof Error ? failure.message : String(failure)}`);
    } else if (failure !== undefined) {
      throw failure;
    }
  }, 90_000);

  // `tree` names the workers' folder as a user would, in an env var: a path relative to where the
  // host was started. Every host must read it against the working directory, as today's does.
  if (!EXPECT_RED) {
    it("reads a relative `tree` against the working directory", async () => {
      const lab = fileURLToPath(new URL("..", import.meta.url));
      const tree = relative(process.cwd(), join(lab, "workforce"));
      if (resolve(lab, tree) === join(lab, "workforce")) {
        throw new Error(`run this from a folder other than ${lab} (run.sh runs it from the repository root): from here a relative tree reads the same against either folder`);
      }
      let host: Opened | undefined;
      try {
        host = await open(name, { tree });
        const served = await servedIds(host);
        expect(served, `served with tree "${tree}"`).toEqual(expectedIds);
        expect((await host.lab.listWorkers()).some((w) => w.id === CHIEF), `the roster read from "${tree}" lists Lead`).toBe(true);
      } finally {
        await host?.close();
      }
    }, 60_000);
  }
});
