// FIX-2873.
/**
 * Who writes the trusted GitHub reviewers on the lab's host. The lab takes
 * every HTTP request as its own user, so a run that calls the lab over
 * loopback is the operator. No HTTP action writes the list, then: the only
 * writer is `setGitHubReviewers`, Chief of Staff's tool, which waits on the
 * operator's own typed word, a judge and Approve. A loopback POST to a save
 * action leaves the list as `GITHUB_REVIEWERS` set it.
 *
 * Chief of Staff holds the tool beside everything it held before; researcher
 * and writer, which write their own `tools:` lines, don't.
 *
 * Control (must FAIL, on the named signal): `GOAL_CONTROL=public-save-action`
 * registers a save action for HTTP, as Shift Manager's was. Fails on "list
 * unchanged".
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { GITHUB_REVIEWERS_DOC, githubLoginsListed, githubReviewersDocument } from "@flow-state-dev/workforce";
import { z } from "zod";
import { openTeammates } from "../host.mts";

const ORG = "teammates-lab";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The tools each worker's turn was offered, by worker, from a model that answers at once. */
type Offered = Record<string, string[]>;

/** The lab's host in process with `GITHUB_REVIEWERS` set, and what each turn was offered. */
async function openHost(offered: Offered = {}) {
  const data = mkdtempSync(join(tmpdir(), "teammates-reviewers-"));
  cleanups.push(() => rmSync(data, { recursive: true, force: true }));
  const repo = join(data, "repo");
  execFileSync("git", ["init", "-q", repo]);
  vi.stubEnv("GITHUB_REVIEWERS", "alice-gh,greptile-apps[bot]");
  let turn = "?";
  // The worker's own turn (`agent-answer`), not memory's capture after it.
  const answer = (block: string | undefined, o: { tools?: Array<{ name: string }> }) => {
    if (block === "agent-answer") offered[turn] = (o.tools ?? []).map((t) => t.name).sort();
    return { text: "ok", finishReason: "stop" as const };
  };
  const models = (modelId: string, block?: string) => ({
    modelId,
    generateStep: async (o: never) => answer(block, o),
    async *streamStep(o: never) {
      const result = answer(block, o);
      yield { type: "text_delta", textDelta: result.text };
      yield { type: "finish", finishReason: result.finishReason, fullResult: result };
    }
  });
  const flowState = await openTeammates({
    store: join(data, "teammates.sqlite"),
    model: "test/scripted",
    userId: "alice",
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 50,
    modelResolver: models as never
  });
  // Read when the host was built: the setting can go back now.
  vi.unstubAllEnvs();
  cleanups.push(async () => (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.());
  if (process.env.GOAL_CONTROL === "public-save-action") (flowState as unknown as { register(flow: FlowInstance): void }).register(publicSaveAction());
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
      body: JSON.stringify({ userId: "alice", input })
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
  return { post, stored, say };
}

/** The planted regression: a save action on a flow the host serves over HTTP, writing the list's row. */
function publicSaveAction(): FlowInstance {
  const document = defineResource({ ref: GITHUB_REVIEWERS_DOC, scope: "org", stateSchema: z.object({}).passthrough(), default: {}, content: "" } as never);
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

describe("the trusted GitHub reviewers on the lab's host", () => {
  it("are written by no HTTP action: a loopback POST, as the lab's own user, leaves the list unchanged", async () => {
    const host = await openHost();
    // The save action Shift Manager once served, and the same name on the flows the lab serves.
    const statuses: number[] = [];
    for (const flow of ["github-reviewers", "agent", "coordinator"]) statuses.push(await host.post(flow, "setGitHubReviewers", { logins: ["mallory"] }));
    const stored = await host.stored();
    expect(stored === undefined ? "nothing saved" : githubLoginsListed(stored).join(","), "list unchanged").toBe("nothing saved");
    expect(statuses.every((status) => status >= 400), `no save action answered: ${statuses.join(", ")}`).toBe(true);
  });

  it("have one writer, Chief of Staff's tool, beside every tool it held; researcher and writer don't hold it", async () => {
    const offered: Offered = {};
    const host = await openHost(offered);
    await host.say("teammates.chief-of-staff", "hi");
    await host.say("teammates.researcher", "hi");
    await host.say("teammates.writer", "hi");
    expect(offered["teammates.chief-of-staff"]).toEqual([
      "consultSessionHistory",
      "createTask",
      "deleteRoutine",
      "getTask",
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
