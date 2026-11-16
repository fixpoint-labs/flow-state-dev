/**
 * The lab's own host, in process, for the screen's tests: `host.mts` with
 * only the model scripted (and, where a test asks, harness-manager's scripted
 * coder), a client over the in-process fetch with a plug a test can pull, a
 * project on a fresh repository, and `src/lab.ts`'s calls over that client.
 * `wrap` puts a tree under `LabProvider` on the same client, so a screen
 * reads exactly what the page would.
 *
 * In process there is no push socket, so every live read reads on its timer;
 * the provider's is short here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { pluggable, scriptedModels, waitFor, type Script } from "../../test-support/contract";
import { openLab, type LabOptions } from "../host.mts";
import { LabProvider, labCalls, type LabCalls, type LabProject } from "../src/lab";
import type { ModeId } from "../src/modes";

export { waitFor } from "../../test-support/contract";
export type { Script, ScriptedCall } from "../../test-support/contract";

/** How often a screen's reads read in these tests, in ms. */
export const TEST_POLL_MS = 150;

/** A repository the lab may cut from: committed, ignoring `.fsdev/`. */
export function repository(dir: string): string {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env });
  return dir;
}

/** A session's title, as these tests' title model writes it: the first line of its first message. */
function firstLineOf(said: string): string {
  const first = (JSON.parse(said) as { role: string; content: unknown }[]).find((message) => message.role === "user");
  return typeof first?.content === "string" ? first.content.split("\n")[0]!.trim() : "Untitled";
}

/** What a test's host is made from: the scripts by block name, and any of `openLab`'s options. */
export interface TestLabOptions extends Partial<Omit<LabOptions, "modelResolver">> {
  scripts?: Record<string, Script>;
  /** Wraps the in-process fetch, to watch or answer a call before the host does. */
  intercept?: (inner: ClientFetch) => ClientFetch;
  /** Make no project. */
  noProject?: boolean;
}

/** The lab on its own host, in process. */
export interface TestLab {
  client: Client;
  fetcher: ClientFetch;
  calls: LabCalls;
  /** The project made on a fresh repository, `vendor-notes`, unless `noProject`. */
  project?: LabProject;
  /** The repository the project names. */
  repo: string;
  data: string;
  flowState: unknown;
  /** The host stops answering; `restore` brings it back. */
  pull(): void;
  restore(): void;
  /** Holds every call whose path ends with `path` until the returned release is called. */
  hold(path: string): () => void;
  /** Every call the page made, as `METHOD path`, in order. */
  readonly asked: string[];
  /** `children` under the lab's provider, on this client. */
  wrap(children: ReactNode): ReactNode;
  close(): Promise<void>;
}

const opened = new Set<TestLab>();

/** What a script holds until released: each is let go before the labs close, so no held turn outlives its test. */
const holds = new Set<() => void>();

/** Close every lab a test opened. Call from `afterEach`. */
export async function closeLabs(): Promise<void> {
  for (const release of [...holds]) release();
  holds.clear();
  for (const lab of [...opened]) await lab.close();
}

/** The lab's host, in process, with its models scripted. */
export async function openTestLab(options: TestLabOptions = {}): Promise<TestLab> {
  const { scripts = {}, intercept, noProject, ...host } = options;
  const data = mkdtempSync(join(tmpdir(), "ccs-lab-"));
  const repo = repository(join(data, "repo"));
  const resolver = scriptedModels(
    { "auto-title:generate": ({ said }) => ({ output: { title: firstLineOf(said) } }), ...scripts },
    () => ({ text: "Noted." }),
  ) as ModelResolver;
  const { flowState } = await openLab({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: [], modelResolver: resolver, ...host });
  const inProcess = createInProcessFetch(flowState as never) as unknown as ClientFetch;
  const asked: string[] = [];
  const held = new Map<string, Promise<void>>();
  const watched = (async (input, init) => {
    const path = new URL(String(input instanceof Request ? input.url : input), "http://x").pathname;
    asked.push(`${init?.method ?? "GET"} ${path}`);
    for (const [suffix, until] of [...held]) if (path.endsWith(suffix)) await until;
    return inProcess(input, init);
  }) as ClientFetch;
  const plug = pluggable((intercept === undefined ? watched : intercept(watched)) as never);
  const fetcher = plug.fetcher as unknown as ClientFetch;
  const client = createClient({ userId: "u_lab", baseUrl: "", fetcher });
  const calls = labCalls(client, { fetcher });
  const project = noProject ? undefined : await calls.createProject("vendor-notes", `file://${repo}`);
  const lab: TestLab = {
    client,
    fetcher,
    calls,
    ...(project === undefined ? {} : { project }),
    repo,
    data,
    flowState,
    asked,
    hold: (path) => {
      let release!: () => void;
      const until = new Promise<void>((resolve) => (release = resolve));
      held.set(path, until);
      return () => {
        if (held.get(path) === until) held.delete(path);
        release();
      };
    },
    pull: () => plug.pull(),
    restore: () => plug.restore(),
    wrap: (children) => createElement(LabProvider, { client, connection: { fetcher }, pollIntervalMs: TEST_POLL_MS }, children),
    close: async () => {
      opened.delete(lab);
      plug.restore();
      // A turn a test left running would hold the host's dispose until it ended: stop each one.
      const sessions = await client.sessions.list().catch(() => []);
      for (const session of sessions) {
        const running = await client.sessions.requests(session.id, { status: "in_progress", limit: 50 }).catch(() => []);
        for (const request of running) await client.flow(request.flowId ?? request.flowKind).request(request.id).abort().catch(() => undefined);
      }
      await (flowState as { dispose?: () => Promise<void> }).dispose?.();
      rmSync(data, { recursive: true, force: true });
    },
  };
  opened.add(lab);
  return lab;
}

/**
 * A session in `mode` with one line sent and its turn ended, titled after the
 * line: what a person who used the lab before has in the sidebar.
 */
export async function seedSession(lab: TestLab, mode: ModeId, line: string): Promise<string> {
  const { id } = await lab.calls.openSession(mode, lab.project!.id);
  await lab.calls.send(id, line);
  await readUntil(() => lab.client.sessions.get(id), (session) => session.title === line.split("\n")[0]);
  await readUntil(() => lab.client.sessions.requests(id, { limit: 20 }), (requests) => requests.every((r) => r.status !== "in_progress"));
  return id;
}

/** What the vendor scripts are doing, for a test to steer them. */
export interface VendorControl {
  /** Lets the held Globex research finish. */
  releaseGlobex(): void;
}

/**
 * The scripts the screen's tests share. Session mode: "Compare Acme and
 * Globex" makes the main session file two research tasks, Acme's settles at
 * once and Globex's stays running until released. Threads mode: the lead
 * files a thread, "Vendor B · regions", which asks you which region matters.
 * Any other line is noted.
 */
export function vendorScripts(): { scripts: Record<string, Script>; control: VendorControl } {
  let releaseGlobex = () => {};
  const globex = new Promise<void>((resolve) => (releaseGlobex = resolve));
  holds.add(releaseGlobex);
  const lastUserLine = (said: string) => said.slice(said.lastIndexOf('"role":"user"'));
  const scripts: Record<string, Script> = {
    "agent-answer": async ({ said, step, signal }) => {
      const who = /You are ([\w-]+)/.exec(said)?.[1];
      if (who === "researcher") {
        if (said.includes("Globex")) await Promise.race([globex, waitFor(60_000, signal)]);
        return { text: said.includes("Globex") ? "Globex: $35 per user." : "Acme: $40 per user, 24-hour support." };
      }
      if (who === "thread") {
        if (step === 0) return { call: { name: "holdTaskForUser", args: { question: "Which region matters, EU or US?" } } };
        return { text: "Vendor B hosts in the EU." };
      }
      if (lastUserLine(said).includes("Compare Acme and Globex")) {
        if (step === 0) return { call: { name: "createTask", args: { assignee: "desk.researcher", title: "Research Acme", goal: "Find Acme's price and support hours." } } };
        if (step === 1) return { call: { name: "createTask", args: { assignee: "desk.researcher", title: "Research Globex", goal: "Read Globex's pricing pages." } } };
        return { text: "I'm researching both vendors in the background." };
      }
      return { text: "Noted." };
    },
    "coordinator-judgment": ({ step, said }) =>
      step === 0 && lastUserLine(said).includes("vendor")
        ? { call: { name: "createTask", args: { assignee: "desk.thread", title: "Vendor B · regions", goal: "Find where Vendor B hosts. Ask the user which region matters." } } }
        : { text: "I've started a thread for it." },
  };
  return { scripts, control: { releaseGlobex: () => releaseGlobex() } };
}

/** Reads `read` every 50 ms until `check` holds, or fails after `ms` with the last value. */
export async function readUntil<T>(read: () => Promise<T> | T, check: (value: T) => boolean, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  let last: T | undefined;
  for (;;) {
    last = await read();
    if (check(last)) return last;
    if (Date.now() > until) throw new Error(`condition never held; last value: ${JSON.stringify(last)?.slice(0, 1500)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
