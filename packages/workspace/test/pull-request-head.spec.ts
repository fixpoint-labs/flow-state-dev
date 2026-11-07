/**
 * `pullRequestHead`: the branch a pull request's work is on, so a run can be
 * started on it. `gh` is a stub script that prints one answer and logs the
 * endpoint it was asked.
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pullRequestHead, readPullRequest } from "../src/branch-pull-requests";
import { WorkspaceRefusedError } from "../src/refused";
import { tempDir } from "./git-fixtures";

function stubGh(answer: unknown, fail?: string): { path: string; calls: () => string[] } {
  const dir = tempDir("gh");
  const log = join(dir, "calls.log");
  const path = join(dir, "gh");
  writeFileSync(
    path,
    `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(3).join(" ") + "\\n");
${fail === undefined ? "" : `process.stderr.write(${JSON.stringify(fail)} + "\\n"); process.exit(4);`}
process.stdout.write(${JSON.stringify(JSON.stringify(answer))});
`,
  );
  chmodSync(path, 0o755);
  return { path, calls: () => readFileSync(log, "utf8").trim().split("\n") };
}

const pr = (head: string, base = "acme/app") => ({
  html_url: "https://github.com/acme/app/pull/812",
  head: { ref: "fix/review-notes", sha: "abc123", repo: { full_name: head } },
  base: { repo: { full_name: base } },
});

async function refusalOf(promise: Promise<unknown>): Promise<WorkspaceRefusedError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(WorkspaceRefusedError);
  return error as WorkspaceRefusedError;
}

describe("pullRequestHead", () => {
  it("names the head branch of a pull request in the same repository", async () => {
    const gh = stubGh(pr("acme/app"));
    const head = await pullRequestHead({ cwd: tempDir("checkout"), number: 812, gh: gh.path });
    expect(head).toEqual({ branch: "fix/review-notes", commit: "abc123", url: "https://github.com/acme/app/pull/812", state: null, merged: false });
    expect(gh.calls()).toEqual(["repos/{owner}/{repo}/pulls/812"]);
  });

  it("refuses a pull request from a fork, naming it", async () => {
    const gh = stubGh(pr("someone/app"));
    const refusal = await refusalOf(pullRequestHead({ cwd: tempDir("checkout"), number: 812, gh: gh.path }));
    expect(refusal.reason).toBe("pull-request-from-fork");
    expect(refusal.message).toContain("someone/app");
  });

  it("refuses when gh can't say, with gh's words", async () => {
    const gh = stubGh({}, "gh: Not Found (HTTP 404)");
    const refusal = await refusalOf(pullRequestHead({ cwd: tempDir("checkout"), number: 9, gh: gh.path }));
    expect(refusal.reason).toBe("pull-request-unreadable");
    expect(refusal.message).toContain("Not Found");
  });

  it("refuses a number that is not a pull request's without asking", async () => {
    const refusal = await refusalOf(pullRequestHead({ cwd: tempDir("checkout"), number: 0, gh: "gh-never-run" }));
    expect(refusal.reason).toBe("pull-request-unreadable");
  });
});

describe("readPullRequest", () => {
  it("reads a merged pull request as closed and merged, asking its repository directly", async () => {
    const gh = stubGh({ ...pr("acme/app"), title: "Fix", state: "closed", merged: true, merged_at: "2026-11-01T00:00:00Z" });
    const read = await readPullRequest({ cwd: tempDir("anywhere"), number: 812, repository: "acme/app", gh: gh.path });
    expect(read).toMatchObject({ number: 812, state: "closed", merged: true, title: "Fix", branch: "fix/review-notes" });
    // Named, so no checkout of that repository is needed to ask it.
    expect(gh.calls()).toEqual(["repos/acme/app/pulls/812"]);
  });

  it("reads a closed, unmerged pull request as closed and not merged", async () => {
    const gh = stubGh({ ...pr("acme/app"), state: "closed", merged: false, merged_at: null });
    expect(await readPullRequest({ cwd: tempDir("checkout"), number: 812, gh: gh.path })).toMatchObject({ state: "closed", merged: false });
  });

  it("reads a fork's pull request, which pullRequestHead refuses to start a run on", async () => {
    // A waiting task asks whether its pull request merged; where its head lives does not change that.
    const gh = stubGh({ ...pr("someone/app"), state: "open", merged: false });
    const read = await readPullRequest({ cwd: tempDir("checkout"), number: 812, gh: gh.path });
    expect(read).toMatchObject({ state: "open", merged: false, headRepository: "someone/app", baseRepository: "acme/app" });
  });

  it("refuses an answer that names no state: an unreadable pull request is never read as open or closed", async () => {
    const gh = stubGh(pr("acme/app"));
    const refusal = await refusalOf(readPullRequest({ cwd: tempDir("checkout"), number: 812, gh: gh.path }));
    expect(refusal.reason).toBe("pull-request-unreadable");
  });

  // A host named is always passed on, github.com too: gh otherwise asks GH_HOST, which on a
  // machine set up for GitHub Enterprise would read a github.com pull request from the wrong forge.
  it("asks the named host, github.com included, and leaves gh's default host alone when none is named", async () => {
    for (const host of ["github.com", "ghe.acme.dev"]) {
      const gh = stubGh({ ...pr("acme/app"), state: "open", merged: false });
      await readPullRequest({ cwd: tempDir("anywhere"), number: 812, repository: "acme/app", host, gh: gh.path });
      expect(gh.calls()).toEqual([`--hostname ${host} repos/acme/app/pulls/812`]);
    }
    const gh = stubGh({ ...pr("acme/app"), state: "open", merged: false });
    await readPullRequest({ cwd: tempDir("anywhere"), number: 812, repository: "acme/app", gh: gh.path });
    expect(gh.calls()).toEqual(["repos/acme/app/pulls/812"]);
  });

  it("refuses when gh can't say", async () => {
    const gh = stubGh({}, "gh: not logged in");
    const refusal = await refusalOf(readPullRequest({ cwd: tempDir("checkout"), number: 9, repository: "acme/app", gh: gh.path }));
    expect(refusal.reason).toBe("pull-request-unreadable");
    expect(refusal.message).toContain("not logged in");
  });
});
