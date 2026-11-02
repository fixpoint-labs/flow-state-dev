/**
 * `pullRequestHead`: the branch a pull request's work is on, so a run can be
 * started on it. `gh` is a stub script that prints one answer and logs the
 * endpoint it was asked.
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pullRequestHead } from "../src/branch-pull-requests";
import { WorkspaceRefusedError } from "../src/refused";
import { tempDir } from "./git-fixtures";

function stubGh(answer: unknown, fail?: string): { path: string; calls: () => string[] } {
  const dir = tempDir("gh");
  const log = join(dir, "calls.log");
  const path = join(dir, "gh");
  writeFileSync(
    path,
    `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(log)}, (process.argv[3] ?? "") + "\\n");
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
    expect(head).toEqual({ branch: "fix/review-notes", commit: "abc123", url: "https://github.com/acme/app/pull/812" });
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
