/**
 * GitHub polling across a restart of the lab's host. Why these matter: a host
 * that starts with no GitHub token refuses every poll it fires, and the poll
 * index is written only when a schedule is, so either failure left polling
 * silently dead. The host says the first at start and on its context strip,
 * and heals the second: a poll index file deleted while it was down is rebuilt
 * from the stored schedules once the app is up, without touching their cursors.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { sqliteScheduleIndex } from "@flow-state-dev/store-sqlite";
import { scriptedModels } from "../../test-support/contract";
import { appContextView } from "../flows/lab-context-ref.mts";
import { GITHUB_NO_TOKEN, openTeammates } from "../host.mts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

/** A data folder holding a git checkout the lab can work in. */
function dataFolder(): { data: string; repo: string } {
  const data = mkdtempSync(join(tmpdir(), "teammates-lab-polling-"));
  cleanups.push(() => rmSync(data, { recursive: true, force: true }));
  const repo = join(data, "repo");
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "-A"], { env: git });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: git });
  return { data, repo };
}

/** The lab's host over the store in `data`, as a restart opens it. */
async function openApp(data: string, repo: string, github?: { token: string; answers: number; login?: string }) {
  const flowState = await openTeammates({
    store: join(data, "teammates.sqlite"),
    model: "test/scripted",
    userId: "you",
    workdir: repo,
    runsRoot: join(data, "runs"),
    scriptedHarnessStepMs: 50,
    modelResolver: scriptedModels({}) as never,
    ...(github === undefined
      ? {}
      : {
          github: { token: github.token, source: "GITHUB_TOKEN" as const },
          // GitHub's `/user`, as the start-up check asks it: never the real one in a test.
          githubFetch: (async () => new Response(JSON.stringify({ login: github.login ?? "operator" }), { status: github.answers })) as unknown as typeof fetch,
        }),
  });
  cleanups.push(() => flowState.dispose());
  return flowState;
}

describe("a host with no GitHub token", () => {
  it("says GitHub polling is disabled at start and on the context strip", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { data, repo } = dataFolder();
    const flowState = await openApp(data, repo);
    expect(warn).toHaveBeenCalledWith(`teammates: ${GITHUB_NO_TOKEN}`);
    const client = createClient({ userId: "you", baseUrl: "", fetcher: createInProcessFetch(flowState as never) as unknown as typeof fetch });
    expect((await client.view(appContextView, {})).value.githubProblem).toBe(GITHUB_NO_TOKEN);
  });

  it("says nothing of it when it has one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { data, repo } = dataFolder();
    const flowState = await openApp(data, repo, { token: "ghp_test", answers: 200, login: "jhoffner" });
    expect(warn).not.toHaveBeenCalledWith(`teammates: ${GITHUB_NO_TOKEN}`);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("teammates: GitHub token from GITHUB_TOKEN works, as jhoffner"));
    const client = createClient({ userId: "you", baseUrl: "", fetcher: createInProcessFetch(flowState as never) as unknown as typeof fetch });
    expect((await client.view(appContextView, {})).value.githubProblem).toBeNull();
  });
});

describe("a host whose token GitHub refuses", () => {
  // A stale GITHUB_TOKEN wins over a working `gh` sign-in and fails every poll: said at start, and on the strip.
  it("says so at start and on the context strip, naming where the token came from", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { data, repo } = dataFolder();
    const flowState = await openApp(data, repo, { token: "ghp_stale", answers: 401 });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/GitHub refused the token from GITHUB_TOKEN \(GitHub answered 401/)));
    const client = createClient({ userId: "you", baseUrl: "", fetcher: createInProcessFetch(flowState as never) as unknown as typeof fetch });
    expect((await client.view(appContextView, {})).value.githubProblem).toMatch(/GitHub refused the token from GITHUB_TOKEN/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("ghp_stale");
  });
});

describe("the poll index across a restart", () => {
  const CELL = "you:~org:teammates-lab";
  const KEY = "workforce/subscription-polls/github-acme-app";
  const schedule = {
    orgId: "teammates-lab",
    cron: "* * * * *",
    kind: "subscription-poll",
    enabled: true,
    input: { key: "github-acme-app", provider: "github", thread: "github:acme/app", everyMinutes: 1, polledThrough: 1_234 },
  };

  it("is rebuilt from the stored schedules when its file was deleted, once, with the cursor untouched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { data, repo } = dataFolder();
    const before = await openApp(data, repo, { token: "ghp_test", answers: 200 });
    // Stored straight to resource state, as a schedule whose index row was lost: nothing mirrors it.
    const { stores } = await before.getRuntime();
    // With the user and org records any request of theirs leaves: what the start-up heal finds cells by.
    const at = Date.now();
    await stores.org.set("teammates-lab", { id: "teammates-lab", orgId: "teammates-lab", state: {}, version: 0, createdAt: at, updatedAt: at }, 0);
    await stores.user.set(CELL, { id: CELL, userId: "you", state: {}, version: 0, createdAt: at, updatedAt: at }, 0);
    await stores.resourceState.set("user", CELL, KEY, schedule, "any");
    await before.dispose();
    rmSync(join(data, "teammates-poll.sqlite"), { force: true });

    const after = await openApp(data, repo, { token: "ghp_test", answers: 200 });
    await after.ready();
    // The workforce kit's start-up work runs once the app serves, without holding start-up: wait for its line.
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("[workforce] schedule indexes checked at start: 0 clock routines, 1 polls"));
    const due = await sqliteScheduleIndex({ filename: join(data, "teammates-poll.sqlite") }).claimDue(Date.now() + 2 * 60_000, 10);
    expect(due).toEqual([expect.objectContaining({ cell: CELL, key: "github-acme-app", userId: "you", orgId: "teammates-lab", cron: "* * * * *" })]);
    expect((await (await after.getRuntime()).stores.resourceState.get("user", CELL, KEY))?.state).toEqual(schedule);
  });
});
