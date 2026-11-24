// FIX-2624; FIX-2771.
/**
 * The lab's two host reads, the context strip's and the readiness chips', are
 * views read by scope: the page reads them with no session, so opening the lab
 * finds or makes none for them. Read against the lab's own host, in process,
 * through the refs the page reads them by.
 *
 * Worker talk reads workforce's worker messages view, not the whole log: on
 * the lab's own host, the screen's three answers (pending, "Messaging …",
 * and a line's replied or no answer) are the ones the whole log gives.
 *
 * The lab-context view also answers under a second user and a second org, on a
 * router whose flow signs both in: what it answers is the host's settings, the
 * same for every caller, and no caller's read makes a session.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, createInProcessFetch, disposeFlowApiRouter } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { workerMessagesViewRef, type WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { scriptedModels } from "../../test-support/contract";
import { appContextView } from "../flows/lab-context-ref.mts";
import { appContextViewOf } from "../flows/lab-context.mts";
import { openTeammates } from "../host.mts";
import { answerIn } from "../src/components/Popups";
import { owedRepliesFrom, pendingFor } from "../src/lib/talk";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A git checkout the lab can work in. */
function workingFolder(): string {
  const data = mkdtempSync(join(tmpdir(), "teammates-lab-reads-"));
  cleanups.push(() => rmSync(data, { recursive: true, force: true }));
  const repo = join(data, "repo");
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "-A"], { env: git });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: git });
  return repo;
}

/** The lab's own host, in process, and a client of it as the page's user. */
async function openApp() {
  const repo = workingFolder();
  const flowState = await openTeammates({
    store: join(repo, "..", "teammates.sqlite"),
    model: "test/scripted",
    userId: "you",
    workdir: repo,
    runsRoot: join(repo, "..", "runs"),
    scriptedHarnessStepMs: 50,
    modelResolver: scriptedModels({}) as never,
  });
  cleanups.push(async () => (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.());
  const fetcher = createInProcessFetch(flowState as never) as unknown as typeof fetch;
  return { repo, flowState, client: createClient({ userId: "you", baseUrl: "", fetcher }) };
}

describe("the lab's host reads", () => {
  it("read the context strip and the readiness chips with no session found or made", async () => {
    const { repo, client } = await openApp();
    const context = (await client.view(appContextView, {})).value;
    expect(context).toMatchObject({ folder: repo, folderProblem: null, model: "test/scripted" });
    expect((await client.view(harnessReadinessViewRef("harnesses"), {})).value.map((harness) => harness.harness)).toEqual(["claude-code", "codex", "cursor"]);
    // Re-check: the same view, checked anew.
    expect((await client.view(harnessReadinessViewRef("harnesses"), { refresh: true })).value.map((harness) => harness.harness)).toEqual(["claude-code", "codex", "cursor"]);
    expect(await client.sessions.list({ userId: "you" })).toEqual([]);
  });
});

describe("worker talk", () => {
  const LEAD = "teammates.chief-of-staff";
  const RESEARCHER = "teammates.researcher";
  const WRITER = "teammates.writer";
  const logged = (id: string, at: number, fields: Partial<WorkerMessageResourceState>): WorkerMessageResourceState => ({
    id, from: LEAD, to: RESEARCHER, text: `text ${id}`, exchange: id, fromSession: "s_from", fromFlow: "agent", toSession: "s_to", toFlow: "agent", hop: 1, status: "delivered", at, ...fields,
  });
  // Every way a row stands, for Lead: to it and from it, open and closed, answered and not.
  const log = [
    logged("m01", 1, { from: RESEARCHER, to: LEAD, status: "unconfirmed" }), // on its way to Lead: pending
    logged("m02", 2, { from: WRITER, to: LEAD, status: "delivered" }), // landed: not pending
    logged("m03", 3, { from: WRITER, to: LEAD, status: "refused" }), // never lands
    logged("m04", 4, { replyRequested: true }), // Lead waits on researcher's reply
    logged("m05", 5, { to: WRITER, replyRequested: true, answeredBy: "m06" }), // answered
    logged("m06", 6, { from: WRITER, to: LEAD, inReplyTo: "m05", exchange: "m05" }),
    logged("m07", 7, { to: WRITER, replyRequested: true, answeredBy: "m08" }), // answered with no answer
    logged("m08", 8, { from: WRITER, to: LEAD, inReplyTo: "m07", exchange: "m07", noAnswer: true }),
    logged("m09", 9, { replyRequested: true, status: "undeliverable" }), // never landed: owes nothing
    logged("m10", 10, {}), // a plain message: owes nothing
    logged("m11", 11, { from: WRITER, to: RESEARCHER, status: "unconfirmed" }), // not Lead's
  ];
  // The lines Lead's conversation shows: what it sent, and what it read.
  const sentIds = ["m04", "m05", "m07", "m09", "m10"];
  const entries = [
    { kind: "received" as const, id: "e2", messageId: "m02", from: WRITER, text: "x" },
    ...sentIds.map((messageId) => ({ kind: "sent" as const, id: `e_${messageId}`, messageId, to: RESEARCHER, text: "x" })),
  ];

  it("reads Lead's open messages and the answers to its lines on screen, and draws what the whole log draws", async () => {
    const { flowState, client } = await openApp();
    // Written as the log's rows are stored: the view's first lookup builds its indexes from them.
    const stores = (await (flowState as unknown as { getRuntime(): Promise<{ stores: { resourceState: { set(...args: unknown[]): Promise<unknown> } } }> }).getRuntime()).stores;
    for (const r of log) await stores.resourceState.set("user", "you:~org:teammates-lab", `workforce/messages/${r.id}`, r, "any");

    const status = (await client.view(workerMessagesViewRef(), { worker: LEAD })).value;
    const onScreen = (await client.view(workerMessagesViewRef(), { worker: LEAD, ids: sentIds })).value;
    // Open rows only, with no line on screen: nothing closed or another pair's.
    expect(status.map((m) => m.id)).toEqual(["m01", "m04"]);
    // Today's read: every row to or from Lead.
    const whole = log.filter((m) => m.from === LEAD || m.to === LEAD);
    expect(pendingFor(LEAD, onScreen, entries as never).map((m) => m.id)).toEqual(pendingFor(LEAD, whole, entries as never).map((m) => m.id));
    expect(pendingFor(LEAD, onScreen, entries as never).map((m) => m.id)).toEqual(["m01"]);
    expect(owedRepliesFrom(LEAD, status)).toEqual(owedRepliesFrom(LEAD, whole));
    expect(owedRepliesFrom(LEAD, status)).toEqual([RESEARCHER]);
    expect(sentIds.map((id) => answerIn(onScreen, id))).toEqual(sentIds.map((id) => answerIn(whole, id)));
    expect(sentIds.map((id) => answerIn(onScreen, id))).toEqual(["working", "replied", "no answer", "working", "working"]);
  });
});

describe("the lab-context view", () => {
  const signIn = (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    const org = context.request?.headers.get("x-org");
    return user == null || org == null ? null : { userId: user, orgId: org };
  };

  it("answers a second user and a second org the host's settings, and makes no session for any of them", async () => {
    const settings = { folder: "/work", folderProblem: null, model: "openai/gpt-6-luna", harness: "codex", delegates: { lead: "all" as const } };
    const flow = defineFlow({
      kind: "lab-context",
      views: { context: appContextViewOf(async () => settings) },
      authentication: { resolvePrincipal: signIn },
    } as never)();
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    cleanups.push(() => disposeFlowApiRouter(router));
    const clientOf = (userId: string, orgId: string) =>
      createClient({
        userId,
        fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(new URL(String(input instanceof Request ? input.url : input), "http://localhost"), init);
          request.headers.set("x-user", userId);
          request.headers.set("x-org", orgId);
          const path = new URL(request.url).pathname.replace(/^\/api\/flows\//, "").split("/");
          return request.method === "GET" ? router.GET(request, { params: { path } }) : router.POST(request, { params: { path } });
        },
      });
    for (const [userId, orgId] of [["alice", "org-a"], ["bob", "org-a"], ["carol", "org-b"]] as const) {
      const answer = await clientOf(userId, orgId).view(appContextView, {});
      // The host's settings, not a caller's data: no user or org topic, nothing one caller's read could leak.
      expect(answer.value).toEqual(settings);
      expect(answer.topics).toEqual([]);
    }
    expect(await stores.session.list({})).toEqual([]);
  });
});
