/**
 * The host's turn-end check: the pull requests on a checkout's branches, added
 * to the session's record when it lacks them.
 *
 * What a host relies on: a pull request the in-turn recorder could not read is
 * on the record after the check, marked as found on the branch; one the
 * recorder already wrote stays one row and keeps the turn that opened it; the
 * host's own session branch is checked even after the agent moved to another;
 * a pull request from before the turn on a branch the agent switched to is
 * not the turn's; one budget bounds the whole check, however many branches;
 * and a `gh` that fails is a reason handed back, never a throw.
 *
 * `gh` is a stub script that answers by branch; git is real.
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OBSERVED_PULL_REQUESTS, writePullRequests } from "@flow-state-dev/core";
import { recordBranchPullRequests } from "../src/branch-pull-requests";
import { git, tempDir } from "./git-fixtures";

/** A checkout on `branch`, with a commit. */
function checkout(branch: string): string {
  const dir = tempDir("branch-prs");
  git(dir, "init", "-q", "-b", branch);
  writeFileSync(join(dir, "a.txt"), "a");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "a");
  return dir;
}

/** A `gh` that answers `gh api …pulls?head=…:<branch>…` from `byBranch`, logging each endpoint. */
function stubGh(byBranch: Record<string, unknown[]>, fail?: string, hangMs = 0): { path: string; calls: () => string[] } {
  const dir = tempDir("gh");
  const log = join(dir, "calls.log");
  const answers = join(dir, "answers.json");
  writeFileSync(answers, JSON.stringify(byBranch));
  const path = join(dir, "gh");
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require("node:fs");
const endpoint = process.argv[3] ?? "";
fs.appendFileSync(${JSON.stringify(log)}, endpoint + "\\n");
${hangMs > 0 ? `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${hangMs});` : ""}
${fail === undefined ? "" : `process.stderr.write(${JSON.stringify(fail)} + "\\n"); process.exit(4);`}
const branch = decodeURIComponent(/head=\\{owner\\}:([^&]*)/.exec(endpoint)?.[1] ?? "");
process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(${JSON.stringify(answers)}, "utf8"))[branch] ?? []));
`,
  );
  chmodSync(path, 0o755);
  return { path, calls: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
}

function memoryCollection() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    async getOptional(key: string) {
      const state = rows.get(key);
      return state === undefined ? undefined : { state };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      rows.set(key, { ...rows.get(key), ...update });
    },
  };
}

const listed = (number: number, branch: string, extra: Record<string, unknown> = {}) => ({
  number,
  html_url: `https://github.com/acme/app/pull/${number}`,
  title: `PR ${number}`,
  state: "open",
  draft: false,
  merged_at: null,
  head: { ref: branch },
  ...extra,
});

const ctxWith = (collection: ReturnType<typeof memoryCollection>) => ({
  resources: { [OBSERVED_PULL_REQUESTS]: collection },
  request: { identity: { id: "req_turn" } },
});

describe("recordBranchPullRequests", () => {
  it("adds a pull request on the checkout's branch, marked as found there", async () => {
    const collection = memoryCollection();
    const gh = stubGh({ "feat/notes": [listed(90, "feat/notes")] });
    const result = await recordBranchPullRequests(ctxWith(collection), { cwd: checkout("feat/notes"), gh: gh.path });
    expect(result).toMatchObject({ status: "recorded", branches: ["feat/notes"] });
    expect(gh.calls()).toEqual(["repos/{owner}/{repo}/pulls?head={owner}:feat%2Fnotes&state=all&per_page=20"]);
    expect(collection.rows.get("github.com/acme/app/90")).toMatchObject({
      source: "branch",
      requestId: "req_turn",
      branch: "feat/notes",
      title: "PR 90",
      state: "open",
    });
  });

  it("checks the host's session branch beside the one the agent moved to", async () => {
    const collection = memoryCollection();
    const gh = stubGh({ "agent-branch": [listed(91, "agent-branch")], "kitchen-sink/codex/s1": [listed(92, "kitchen-sink/codex/s1")] });
    await recordBranchPullRequests(ctxWith(collection), {
      cwd: checkout("agent-branch"),
      branches: ["kitchen-sink/codex/s1"],
      gh: gh.path,
    });
    expect([...collection.rows.keys()].sort()).toEqual(["github.com/acme/app/91", "github.com/acme/app/92"]);
  });

  it("keeps one row, and the turn that opened it, for a pull request the recorder already wrote", async () => {
    const collection = memoryCollection();
    await writePullRequests(collection, [{ host: "github.com", owner: "acme", name: "app", number: 90, url: "https://github.com/acme/app/pull/90" }], {
      source: "tool",
      requestId: "req_opened",
    });
    const gh = stubGh({ notes: [listed(90, "notes", { merged_at: "2026-10-28T00:00:00Z", state: "closed" })] });
    await recordBranchPullRequests(ctxWith(collection), { cwd: checkout("notes"), gh: gh.path });
    expect([...collection.rows.keys()]).toEqual(["github.com/acme/app/90"]);
    expect(collection.rows.get("github.com/acme/app/90")).toMatchObject({ source: "tool", requestId: "req_opened", state: "merged" });
  });

  it("hands back why when gh fails, and writes nothing", async () => {
    const collection = memoryCollection();
    const gh = stubGh({}, "gh: To get started with GitHub CLI, please run:  gh auth login");
    const result = await recordBranchPullRequests(ctxWith(collection), { cwd: checkout("notes"), gh: gh.path });
    expect(result).toEqual({
      status: "unavailable",
      reason: "GitHub could not be asked about branch notes: gh: To get started with GitHub CLI, please run:  gh auth login",
    });
    expect(collection.rows.size).toBe(0);
  });

  it("hands back why when the flow has no record", async () => {
    const result = await recordBranchPullRequests({ resources: {} }, { cwd: checkout("notes"), gh: "gh-never-run" });
    expect(result).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/not registered/) });
  });

  it("leaves out a pull request created before the turn, on a branch the agent switched to", async () => {
    const collection = memoryCollection();
    const turnStart = Date.parse("2026-10-28T12:00:00Z");
    const gh = stubGh({
      release: [
        listed(40, "release", { created_at: "2025-03-01T00:00:00Z", merged_at: "2025-03-02T00:00:00Z", state: "closed" }),
        listed(93, "release", { created_at: "2026-10-28T12:05:00Z" }),
      ],
    });
    const result = await recordBranchPullRequests(ctxWith(collection), { cwd: checkout("release"), gh: gh.path, openedSince: turnStart });
    expect(result).toMatchObject({ status: "recorded" });
    expect([...collection.rows.keys()]).toEqual(["github.com/acme/app/93"]);
  });

  it("ends within its one budget when gh hangs, with several branches to ask", async () => {
    const collection = memoryCollection();
    const gh = stubGh({}, undefined, 10_000);
    const started = Date.now();
    const result = await recordBranchPullRequests(ctxWith(collection), {
      cwd: checkout("a"),
      branches: ["b", "c"],
      gh: gh.path,
      timeoutMs: 1_500,
    });
    expect(result).toMatchObject({ status: "unavailable" });
    // Three commands at 1.5 s each, one after another, would take 4.5 s.
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(collection.rows.size).toBe(0);
  }, 15_000);
});
