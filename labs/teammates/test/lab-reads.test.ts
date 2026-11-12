// FIX-2624.
/**
 * The lab's two host reads, the context strip's and the readiness chips', are
 * views read by scope: the page reads them with no session, so opening the lab
 * finds or makes none for them. Read against the lab's own host, in process.
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
import { viewRef } from "@flow-state-dev/client";
import { scriptedModels } from "../../test-support/contract";
import { labContextView, openTeammates, type LabContextView } from "../host.mts";
import { createLabAdapter } from "../src/adapter";

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

describe("the lab's host reads", () => {
  it("read the context strip and the readiness chips with no session found or made", async () => {
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
    const client = createClient({ userId: "you", baseUrl: "", fetcher });
    const lab = createLabAdapter(client, { fetcher });

    const context = await lab.readContext();
    expect(context).toMatchObject({ folder: repo, folderProblem: null, model: "test/scripted" });
    expect((await lab.readHarnesses()).map((harness) => harness.harness)).toEqual(["claude-code", "codex", "cursor"]);
    expect(await client.sessions.list({ userId: "you" })).toEqual([]);
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
      views: { context: labContextView(async () => settings) },
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
    const ref = viewRef<LabContextView>("lab-context", "context");

    for (const [userId, orgId] of [["alice", "org-a"], ["bob", "org-a"], ["carol", "org-b"]] as const) {
      const answer = await clientOf(userId, orgId).view(ref, {});
      // The host's settings, not a caller's data: no user or org topic, nothing one caller's read could leak.
      expect(answer.value).toEqual(settings);
      expect(answer.topics).toEqual([]);
    }
    expect(await stores.session.list({})).toEqual([]);
  });
});
