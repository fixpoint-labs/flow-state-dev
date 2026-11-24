/**
 * The lab's own host, in process, for the screen's tests: `host.mts` with
 * only the model scripted (and, where a test asks, harness-manager's scripted
 * coder), a client over the in-process fetch with a plug a test can pull, a
 * project on a fresh repository, and `src/app/`'s calls over that client.
 * `wrap` puts a tree under `AppProvider` on the same client, so a screen
 * reads exactly what the page would.
 *
 * In process there is no push socket, so every live read reads on its timer;
 * the provider's is short here. Every coding run is harness-manager's
 * scripted coder: a test never starts a real harness.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { GOAL_JUDGE_QUESTION, GOAL_JUDGE_WHY_QUESTION } from "@flow-state-dev/harness-manager";
import { pluggable, scriptedModels, waitFor, type Script } from "../../test-support/contract";
import { openClaudeCodeStyle, type ClaudeCodeStyleOptions } from "../host.mts";
import { AppProvider, appCalls, type AppCalls, type AppProject } from "../src/app";
import type { ModeId } from "../src/modes";

export { waitFor } from "../../test-support/contract";
export type { Script } from "../../test-support/contract";

/** How often a screen's reads read in these tests, in ms. */
const TEST_POLL_MS = 150;

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

/** What a test's host is made from: the scripts by block name, and any of `openClaudeCodeStyle`'s options. */
export interface TestAppOptions extends Partial<Omit<ClaudeCodeStyleOptions, "modelResolver">> {
  scripts?: Record<string, Script>;
  /** Wraps the in-process fetch, to watch or answer a call before the host does. */
  intercept?: (inner: ClientFetch) => ClientFetch;
  /** Make no project. */
  noProject?: boolean;
  /** The lab may cut worktrees from the project's repository, as `CLAUDE_CODE_STYLE_REPOSITORIES` names it; unset, a run clones it. */
  cutFromProject?: boolean;
  /** The goal judge's answer for every coding run, read through the resolver's evaluation model; unset, no judge reads a run. */
  judge?: { choice: "done" | "not-done" | "ask"; confidence: number };
}

/** An evaluation model that gives harness-manager's goal judge one verdict, with its confidence. */
function judgeModel(judge: { choice: string; confidence: number }) {
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/judge",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate() {
      return {
        answers: { [GOAL_JUDGE_QUESTION]: { type: "choice", choice: judge.choice }, [GOAL_JUDGE_WHY_QUESTION]: { type: "choice", choice: "off-target" } },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        providerMetadata: { typesafe: { confidence: { [GOAL_JUDGE_QUESTION]: judge.confidence } } },
      };
    },
  };
}

/** The lab on its own host, in process. */
export interface TestApp {
  client: Client;
  fetcher: ClientFetch;
  calls: AppCalls;
  /** The project made on a fresh repository, `vendor-notes`, unless `noProject`. */
  project?: AppProject;
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

const opened = new Set<TestApp>();

/** What a script holds until released: each is let go before the labs close, so no held turn outlives its test. */
const holds = new Set<() => void>();

/** Close every lab a test opened. Call from `afterEach`. */
export async function closeApps(): Promise<void> {
  for (const release of [...holds]) release();
  holds.clear();
  for (const lab of [...opened]) await lab.close();
}

/** The lab's host, in process, with its models scripted. */
export async function openTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { scripts = {}, intercept, noProject, cutFromProject, judge, ...host } = options;
  const data = mkdtempSync(join(tmpdir(), "ccs-lab-"));
  const repo = repository(join(data, "repo"));
  const resolver = scriptedModels(
    { "auto-title:generate": ({ said }) => ({ output: { title: firstLineOf(said) } }), ...scripts },
    () => ({ text: "Noted." }),
  ) as ModelResolver;
  if (judge !== undefined) Object.assign(resolver, { resolveEvaluationModel: () => judgeModel(judge) });
  const { flowState } = await openClaudeCodeStyle({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: cutFromProject ? [realpathSync(repo)] : [], modelResolver: resolver, scriptedStepMs: 20, ...host });
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
  const calls = appCalls(client, { fetcher });
  const project = noProject ? undefined : await calls.createProject("vendor-notes", `file://${repo}`);
  const lab: TestApp = {
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
    wrap: (children) => createElement(AppProvider, { client, connection: { fetcher }, pollIntervalMs: TEST_POLL_MS }, children),
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
export async function seedSession(lab: TestApp, mode: ModeId, line: string): Promise<string> {
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
  /** Fails the held Globex research with `reason`. */
  failGlobex(reason: string): void;
  /** The invoice export works from its next attempt. */
  fixExports(): void;
  /** How many Globex research turns are running now. */
  globexRunning(): number;
  /** Lets a held Acme research finish (`holdAcme`). */
  releaseAcme(): void;
}

/** How the session-mode main turn goes once it has filed its two research tasks. */
export interface VendorOptions {
  /** `ends` (default) at once; `takes-acme`: waits for Acme's research, then 3 s, then says it's in; `until-stopped`: works on until stopped. */
  mainTurn?: "ends" | "takes-acme" | "until-stopped";
  /** Acme's research runs until `releaseAcme`. */
  holdAcme?: boolean;
}

/**
 * The scripts the screen's tests share. Session mode: "Compare Acme and
 * Globex" makes the main session file two research tasks, Acme's settles at
 * once and Globex's stays running until released. Threads mode: a line that
 * names vendors makes the lead file three threads: "Vendor A · pricing and
 * uptime" keeps working, "Vendor B · regions" asks you which region matters,
 * and "Vendor C · summary", a coding thread on the scripted coder, waits for
 * your review. A line that names billing makes it file two: "Weekly uptime
 * digest" keeps working, and "Export failed invoices" fails, "The export
 * timed out after 30s.", every attempt until `fixExports`. A line that names
 * the CHANGELOG makes it file that line as one coding thread. Any other line is noted.
 */
export function vendorScripts(options: VendorOptions = {}): { scripts: Record<string, Script>; control: VendorControl } {
  let releaseAcme = () => {};
  const acmeGate = new Promise<void>((resolve) => (releaseAcme = resolve));
  holds.add(releaseAcme);
  let acmeDone = () => {};
  const acmeResearched = new Promise<void>((resolve) => (acmeDone = resolve));
  let releaseGlobex = () => {};
  let failGlobex: (reason: Error) => void = () => {};
  const globex = new Promise<void>((resolve, reject) => {
    releaseGlobex = resolve;
    failGlobex = reject;
  });
  globex.catch(() => undefined);
  let exportsFixed = false;
  let globexTurns = 0;
  holds.add(releaseGlobex);
  // What a thread that keeps working waits on: the labs closing.
  let close = () => {};
  const closing = new Promise<void>((resolve) => (close = resolve));
  holds.add(close);
  const lastUserLine = (said: string) => said.slice(said.lastIndexOf('"role":"user"'));
  const scripts: Record<string, Script> = {
    "agent-answer": async ({ said, step, signal }) => {
      const who = /You are ([\w-]+)/.exec(said)?.[1];
      if (who === "researcher") {
        if (said.includes("Globex")) {
          globexTurns += 1;
          await Promise.race([globex, waitFor(60_000, signal)]).finally(() => (globexTurns -= 1));
        }
        if (said.includes("Globex")) return { text: "Globex: $35 per user." };
        if (options.holdAcme) await Promise.race([acmeGate, waitFor(60_000, signal)]);
        acmeDone();
        return { text: "Acme: $40 per user, 24-hour support." };
      }
      if (who === "thread") {
        if (said.includes("Export failed invoices")) {
          if (!exportsFixed) throw new Error("The export timed out after 30s.");
          return { text: "Exported." };
        }
        if (said.includes("Vendor A") || said.includes("Weekly uptime digest")) {
          await Promise.race([closing, waitFor(60_000, signal)]);
          return { text: "Vendor A: $29 per user." };
        }
        if (step === 0) return { call: { name: "holdTaskForUser", args: { question: "Which region matters, EU or US?" } } };
        return { text: "Vendor B hosts in the EU." };
      }
      if (lastUserLine(said).includes("Compare Acme and Globex")) {
        if (step === 0) return { call: { name: "createTask", args: { assignee: "desk.researcher", title: "Research Acme", goal: "Find Acme's price and support hours." } } };
        if (step === 1) return { call: { name: "createTask", args: { assignee: "desk.researcher", title: "Research Globex", goal: "Read Globex's pricing pages." } } };
        if (options.mainTurn === "until-stopped") {
          await Promise.race([closing, waitFor(60_000, signal)]);
          // A stopped model call ends with no text, as a provider's cut stream does.
          if (signal?.aborted) throw new DOMException("The turn was stopped.", "AbortError");
        }
        if (options.mainTurn === "takes-acme") {
          // The turn runs on past Acme's settling, so the main worker takes the result into it.
          await acmeResearched;
          await waitFor(3_000, signal);
          return {
            text: "Acme's research is in. Section 1 now reads: Acme costs $40 per user, with 24-hour support.\n\nOutline:\n1. Price\n2. Support\n3. Risks\n\nGlobex is still running in the background. I'll fold it in when it lands.",
          };
        }
        return { text: "I'll write the outline myself and research both vendors in the background." };
      }
      if (lastUserLine(said).includes("Stop the Globex research")) {
        // The second task this session filed is Globex's.
        const globexId = [...said.matchAll(/\\?"taskId\\?":\\?"(task_[a-z0-9]+)/g)].map((m) => m[1])[1];
        // `step` counts every tool result the history holds; this turn's own come after its line.
        const stepped = lastUserLine(said).includes('"role":"tool"');
        if (!stepped && globexId !== undefined) return { call: { name: "updateTask", args: { id: globexId, status: "cancelled" } } };
        return { text: "Stopped the Globex research." };
      }
      return { text: "Noted." };
    },
    "coordinator-judgment": ({ step, said }) => {
      const threads = [
        { assignee: "desk.thread", title: "Vendor A · pricing and uptime", goal: "Compare Vendor A's price and uptime record." },
        { assignee: "desk.thread", title: "Vendor B · regions", goal: "Find where Vendor B hosts. Ask the user which region matters." },
        { assignee: "desk.thread-coder", title: "Vendor C · summary", goal: "Add Vendor C's summary to the CHANGELOG." },
      ];
      if (lastUserLine(said).includes("CHANGELOG")) {
        if (step > 0) return { text: "I've started a Claude Code thread for it." };
        const line = /"(?:content|text)":"([^"]*CHANGELOG[^"]*)"/.exec(lastUserLine(said))?.[1] ?? "Add a CHANGELOG line";
        return { call: { name: "createTask", args: { assignee: "desk.thread-coder", title: line, goal: line } } };
      }
      if (lastUserLine(said).includes("vendor") && step < threads.length) return { call: { name: "createTask", args: threads[step]! } };
      const billing = [
        { assignee: "desk.thread", title: "Weekly uptime digest", goal: "Write the weekly uptime digest." },
        { assignee: "desk.thread", title: "Export failed invoices", goal: "Export the failed invoices to a CSV." },
      ];
      if (lastUserLine(said).includes("billing") && step < billing.length) return { call: { name: "createTask", args: billing[step]! } };
      return { text: "I've started a thread for each." };
    },
  };
  return { scripts, control: { releaseGlobex: () => releaseGlobex(), failGlobex: (reason) => failGlobex(new Error(reason)), fixExports: () => void (exportsFixed = true), globexRunning: () => globexTurns, releaseAcme: () => releaseAcme() } };
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
