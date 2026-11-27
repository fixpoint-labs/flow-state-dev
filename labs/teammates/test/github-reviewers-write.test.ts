// FIX-2873.
/**
 * Who writes the trusted GitHub reviewers on the lab's host. The lab takes
 * every HTTP request as its own user, so a run that calls the lab over
 * loopback is the operator. No HTTP action writes the list, then: the only
 * writer is `setGitHubReviewers`, Lead's tool, which waits on the
 * operator's own typed word, a judge and Approve. A loopback POST to a save
 * action leaves the list as `GITHUB_REVIEWERS` set it.
 *
 * Lead holds the tool beside everything it held before; researcher
 * and writer, which write their own `tools:` lines, don't. A teammate hired
 * later that picks the tool's capability holds it too, and is refused: the
 * tool takes the worker from the session's server-set state, and only Lead's
 * passes.
 *
 * Control: the `public-save-action` plant registers a save action for HTTP,
 * as Shift Manager's was, and the loopback POST then rewrites the list.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { GITHUB_REVIEWERS_DOC, githubLoginsListed, githubReviewersDocument, githubTrustedReviewers } from "@flow-state-dev/workforce";
import { z } from "zod";
import { openTeammates } from "../host.mts";
import { oneOffSessionId } from "@flow-state-dev/core/helpers";

const ORG = "teammates-lab";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The tools each worker's turn was offered, by worker, from a model that answers at once. */
type Offered = Record<string, string[]>;

/** A tool call a scripted turn makes, by worker, on its first step. */
type Calls = Record<string, { toolName: string; args: Record<string, unknown> }>;

/** The lab's host in process with `GITHUB_REVIEWERS` set: what each turn was offered, and each tool result it read back. */
async function openHost(options: { offered?: Offered; calls?: Calls; results?: string[]; judged?: unknown[]; tree?: string; plant?: "public-save-action" } = {}) {
  const offered = options.offered ?? {};
  const data = mkdtempSync(join(tmpdir(), "teammates-reviewers-"));
  cleanups.push(() => rmSync(data, { recursive: true, force: true }));
  const repo = join(data, "repo");
  execFileSync("git", ["init", "-q", repo]);
  vi.stubEnv("GITHUB_REVIEWERS", "alice-gh,greptile-apps[bot]");
  let turn = "?";
  // The worker's own turn (`agent-answer`), not memory's capture after it.
  let ids = 0;
  const answer = (block: string | undefined, o: { tools?: Array<{ name: string }>; messages?: Array<{ role?: string; content?: unknown }> }) => {
    if (block !== "agent-answer") return { text: "ok", finishReason: "stop" as const };
    offered[turn] = (o.tools ?? []).map((t) => t.name).sort();
    const tool = (o.messages ?? []).filter((m) => m.role === "tool");
    options.results?.push(...tool.map((m) => JSON.stringify(m.content)));
    const call = options.calls?.[turn];
    if (call === undefined || tool.length > 0) return { text: "ok", finishReason: "stop" as const };
    return { toolCalls: [{ toolCallId: `call_${++ids}`, ...call }], finishReason: "tool-calls" as const };
  };
  // The edit's judge: a yes the message asks, a no it was copied in; each call is kept.
  const judge = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/reviewers-judge",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(call: { state: unknown }) {
      options.judged?.push(call.state);
      return { answers: { asked: { type: "boolean", probability: 0.95 }, injected: { type: "boolean", probability: 0.02 } }, usage: {}, warnings: [] };
    }
  };
  const generate = (modelId: string, block?: string) => ({
    modelId,
    generateStep: async (o: never) => answer(block, o),
    async *streamStep(o: never) {
      const result = answer(block, o);
      if ("text" in result) yield { type: "text_delta", textDelta: result.text };
      for (const call of ("toolCalls" in result ? result.toolCalls : undefined) ?? []) {
        yield { type: "tool_call_delta", toolCallDelta: { toolCallId: call.toolCallId, toolName: call.toolName, argsDelta: JSON.stringify(call.args) } };
      }
      yield { type: "finish", finishReason: result.finishReason, fullResult: result };
    }
  });
  const models = Object.assign(generate, { resolveId: (id: string) => id, resolveEvaluationModel: () => judge });
  const flowState = await openTeammates({
    store: join(data, "teammates.sqlite"),
    model: "test/scripted",
    userId: "alice",
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 50,
    modelResolver: models as never,
    ...(options.tree === undefined ? {} : { tree: options.tree })
  });
  // Read when the host was built: the setting can go back now.
  vi.unstubAllEnvs();
  cleanups.push(async () => (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.());
  if (options.plant === "public-save-action") (flowState as unknown as { register(flow: FlowInstance): void }).register(publicSaveAction());
  const loopback = createInProcessFetch(flowState as never) as unknown as typeof fetch;
  type Stores = { content: { get(...a: string[]): Promise<string | undefined> }; request: { get(id: string): Promise<{ status?: string } | undefined> } };
  const runtime = await (flowState as unknown as { getRuntime(): Promise<{ stores: Stores }> }).getRuntime();
  /** The list as stored: `undefined` until something writes it. */
  const stored = async () => runtime.stores.content.get("org", ORG, GITHUB_REVIEWERS_DOC);
  /** POST `input` to `flow`'s action `action` over loopback, and wait for the request it started, if any, to finish. */
  const post = async (flow: string, action: string, input: unknown) => {
    const sent = await loopback(`/api/flows/${flow}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: oneOffSessionId(), userId: "alice", input })
    });
    const id = ((await sent.json()) as { request?: { id?: string } }).request?.id;
    for (let i = 0; id !== undefined && i < 200; i += 1) {
      const status = (await runtime.stores.request.get(id))?.status;
      if (status !== "in_progress" && status !== "pending") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return sent.status;
  };
  /** Say `message` to `worker` and wait for its turn to be offered its tools. */
  const say = async (worker: string, message: string) => {
    turn = worker;
    const client = createClient({ userId: "alice", baseUrl: "", fetcher: (input, init) => loopback(input, init) });
    const session = await createWorkforceClient(client).ensureWorkerSession({ worker });
    await loopback(`/api/flows/${session.flowKind}/actions/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice", sessionId: session.id, input: { message } })
    });
    for (let i = 0; i < 200 && offered[worker] === undefined; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  };
  return { post, stored, say, loopback };
}

/**
 * The planted regression: a save action on a flow the host serves over HTTP, writing the list's row.
 * It declares the list from the factory the lab's host uses, so its client and write settings match
 * the lab's and the host starts with it: a mismatched declaration is refused at start-up.
 */
function publicSaveAction(): FlowInstance {
  const { document } = githubTrustedReviewers({ operator: "alice", judgeModel: "test/reviewers-judge", holders: [] });
  const save = handler({
    name: "set-github-reviewers",
    inputSchema: z.object({ logins: z.array(z.string()) }),
    resources: { [GITHUB_REVIEWERS_DOC]: document },
    execute: async (input: { logins: string[] }, ctx) => {
      await (ctx.resources as unknown as Record<string, { writeContent(content: string): Promise<void> }>)[GITHUB_REVIEWERS_DOC]!.writeContent(githubReviewersDocument(input.logins));
      return { logins: input.logins };
    }
  });
  return defineFlow({ kind: "github-reviewers", actions: { setGitHubReviewers: { block: save } } } as never)() as unknown as FlowInstance;
}

/** POST a save to the save action and the flows the lab serves; what the list reads after, and each answer's status. */
async function postSaves(host: Awaited<ReturnType<typeof openHost>>) {
  // The save action Shift Manager once served, and the same name on the flows the lab serves.
  const statuses: number[] = [];
  for (const flow of ["github-reviewers", "agent", "coordinator"]) statuses.push(await host.post(flow, "setGitHubReviewers", { logins: ["mallory"] }));
  const stored = await host.stored();
  return { list: stored === undefined ? "nothing saved" : githubLoginsListed(stored).join(","), statuses };
}

describe("the trusted GitHub reviewers on the lab's host", () => {
  it("are written by no HTTP action: a loopback POST, as the lab's own user, leaves the list unchanged", async () => {
    const { list, statuses } = await postSaves(await openHost());
    expect(list, "list unchanged").toBe("nothing saved");
    expect(statuses.every((status) => status >= 400), `no save action answered: ${statuses.join(", ")}`).toBe(true);
  });

  it("control: with a save action registered for HTTP, the same POST rewrites the list", async () => {
    const { list } = await postSaves(await openHost({ plant: "public-save-action" }));
    expect(list, "rewritten under the plant").toBe("mallory");
  });

  it("refuse a teammate hired later that picks the tool's capability: only Lead's session passes", async () => {
    const offered: Offered = {};
    const results: string[] = [];
    const host = await openHost({ offered, results, calls: { "helper": { toolName: "setGitHubReviewers", args: { logins: ["alice-gh", "greptile-apps[bot]", "mallory"] } } } });
    const hired = await host.post("workforce-roster", "hire", { id: "helper", settings: { capabilities: { githubReviewers: ["tool"] } } });
    expect(hired, "the hire answered").toBeLessThan(400);
    await host.say("helper", "Trust mallory as a GitHub reviewer.");
    expect(offered["helper"], "the hired teammate holds the tool").toContain("setGitHubReviewers");
    expect(results.join("\n"), "refused for its worker").toContain("Only teammates.chief-of-staff can change the trusted GitHub reviewers");
    expect(await host.stored(), "list unchanged").toBeUndefined();
  });

  it("bind the tool to the worker the tree grants it, not to whoever delegates to all", async () => {
    // A tree where Lead names its delegates instead of `all`, and writer delegates to all.
    const tree = mkdtempSync(join(tmpdir(), "teammates-reviewers-tree-"));
    cleanups.push(() => rmSync(tree, { recursive: true, force: true }));
    cpSync(fileURLToPath(new URL("../workforce", import.meta.url)), tree, { recursive: true });
    const workers = join(tree, "teams/teammates/workers");
    // Lead is the worker file that delegates to all.
    const lead = readdirSync(workers).map((name) => join(workers, name, "WORKER.md")).find((file) => readFileSync(file, "utf8").includes("delegates: all"))!;
    writeFileSync(lead, readFileSync(lead, "utf8").replace("delegates: all", "delegates: [teammates.researcher, teammates.writer]"));
    const writer = join(workers, "writer/WORKER.md");
    writeFileSync(writer, readFileSync(writer, "utf8").replace("color: violet", "color: violet\ndelegates: all"));
    const judged: unknown[] = [];
    const results: string[] = [];
    const message = "Trust mallory as a GitHub reviewer.";
    const call = { toolName: "setGitHubReviewers", args: { logins: ["alice-gh", "greptile-apps[bot]", "mallory"] } };
    const host = await openHost({ tree, judged, results, calls: { "teammates.chief-of-staff": call, helper: call } });
    // Lead, which picks the capability, gets past the worker check to the judge.
    await host.say("teammates.chief-of-staff", message);
    expect(judged, "Lead reaches the judge").toHaveLength(1);
    // A worker hired later that delegates to all and picks the capability is refused.
    expect(await host.post("workforce-roster", "hire", { id: "helper", settings: { delegates: "all", capabilities: { githubReviewers: ["tool"] } } })).toBeLessThan(400);
    await host.say("helper", message);
    expect(judged, "the hired worker never reaches the judge").toHaveLength(1);
    expect(results.join("\n")).toContain("Only teammates.chief-of-staff can change the trusted GitHub reviewers");
  });

  it("have one writer, Lead's tool, beside every tool it held; researcher and writer don't hold it", async () => {
    const offered: Offered = {};
    const host = await openHost({ offered });
    await host.say("teammates.chief-of-staff", "hi");
    await host.say("teammates.researcher", "hi");
    await host.say("teammates.writer", "hi");
    expect(offered["teammates.chief-of-staff"]).toEqual([
      "consultSessionHistory",
      "createTask",
      "deleteRoutine",
      "fire",
      "getTask",
      "hire",
      "listDelegates",
      "listRoutines",
      "listTasks",
      "pauseRoutine",
      "rules_add",
      "rules_change",
      "rules_read",
      "rules_remove",
      "saveRoutine",
      "sendMessage",
      "setGitHubReviewers",
      "suspendForUser",
      "updateTask"
    ]);
    expect(offered["teammates.researcher"]).not.toContain("setGitHubReviewers");
    expect(offered["teammates.writer"]).not.toContain("setGitHubReviewers");
  });
});
