/**
 * Tests for GitHubSignalClient and the checks rollup over a fake `gh` exec.
 * These cover the composite completion signal: PR existence, draft state, and
 * the rollup states (green / pending / failure / none) plus the absent case.
 */
import { describe, expect, it } from "vitest";
import {
  GitHubSignalClient,
  rollupChecks,
  type GhExec,
} from "../../src/signals/github";

/** A fake exec that returns canned stdout/exit for a single `gh` call. */
function fakeExec(stdout: string, code = 0): GhExec {
  return async () => ({ stdout, stderr: "", code });
}

describe("rollupChecks", () => {
  it("is none for an empty or missing rollup", () => {
    expect(rollupChecks([])).toBe("none");
    expect(rollupChecks(null)).toBe("none");
    expect(rollupChecks(undefined)).toBe("none");
  });

  it("is success when every check completed successfully", () => {
    expect(
      rollupChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
      ]),
    ).toBe("success");
  });

  it("is pending when any check is still running", () => {
    expect(
      rollupChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "IN_PROGRESS", conclusion: null },
      ]),
    ).toBe("pending");
  });

  it("is failure when any check failed, even alongside successes", () => {
    expect(
      rollupChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ]),
    ).toBe("failure");
  });

  it("reads legacy status-context entries via `state`", () => {
    expect(rollupChecks([{ state: "SUCCESS" }])).toBe("success");
    expect(rollupChecks([{ state: "PENDING" }])).toBe("pending");
    expect(rollupChecks([{ state: "FAILURE" }])).toBe("failure");
  });
});

describe("GitHubSignalClient.pullRequestForBranch", () => {
  it("reports a ready PR: exists, not draft, checks green", async () => {
    const json = JSON.stringify([
      {
        number: 42,
        isDraft: false,
        url: "https://github.com/x/y/pull/42",
        statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
      },
    ]);
    const client = new GitHubSignalClient(fakeExec(json));
    const signal = await client.pullRequestForBranch("fix/FIX-1");
    expect(signal).toEqual({
      exists: true,
      draft: false,
      checks: "success",
      number: 42,
      url: "https://github.com/x/y/pull/42",
    });
  });

  it("reports a draft PR with pending checks", async () => {
    const json = JSON.stringify([
      {
        number: 7,
        isDraft: true,
        url: "https://github.com/x/y/pull/7",
        statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: null }],
      },
    ]);
    const client = new GitHubSignalClient(fakeExec(json));
    const signal = await client.pullRequestForBranch("fix/FIX-1");
    expect(signal.exists).toBe(true);
    expect(signal.draft).toBe(true);
    expect(signal.checks).toBe("pending");
  });

  it("reports absent when no PR matches the branch (empty list)", async () => {
    const client = new GitHubSignalClient(fakeExec("[]"));
    const signal = await client.pullRequestForBranch("fix/FIX-1");
    expect(signal.exists).toBe(false);
  });

  it("reports absent when gh exits non-zero", async () => {
    const client = new GitHubSignalClient(fakeExec("", 1));
    const signal = await client.pullRequestForBranch("fix/FIX-1");
    expect(signal.exists).toBe(false);
  });

  it("reports absent on unparseable output rather than throwing", async () => {
    const client = new GitHubSignalClient(fakeExec("not json"));
    const signal = await client.pullRequestForBranch("fix/FIX-1");
    expect(signal.exists).toBe(false);
  });
});
