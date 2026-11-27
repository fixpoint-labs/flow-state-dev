/**
 * The package's stub harness and the `access` feed (FIX-2900): it declares
 * `enforcesReadOnly`, and a run fed `read-only` does nothing in its checkout,
 * so a model-free check of a read-only turn grades what a real harness holds.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import type { HarnessAccess, HarnessFeeds } from "@flow-state-dev/core/harness";
import { harnessStub } from "../src";

const feeds = (access?: HarnessAccess): HarnessFeeds => ({
  cwd: () => "/tmp/checkout",
  worktree: () => "/tmp/checkout",
  resume: () => null,
  onSession: () => {},
  onUsage: () => {},
  ...(access === undefined ? {} : { access: () => access }),
});

describe("the stub harness's read-only runs", () => {
  it("declares enforcesReadOnly, and drops it when told", () => {
    expect(harnessStub().slot(feeds()).enforcesReadOnly).toBe(true);
    expect(harnessStub({ enforcesReadOnly: false }).slot(feeds()).enforcesReadOnly).toBeUndefined();
  });

  it("a run fed read-only does no work in its checkout and makes no tool call; a full run does both", async () => {
    let worked = 0;
    let called = 0;
    const stub = harnessStub({ duringRun: () => void (worked += 1), toolCalls: [{ toolName: "Bash", input: {}, run: () => void (called += 1) }] });
    await testBlock(stub.slot(feeds("read-only")), { input: { prompt: "answer" } });
    expect({ worked, called }).toEqual({ worked: 0, called: 0 });
    expect(stub.runs[0]!.access).toBe("read-only");

    await testBlock(stub.slot(feeds("full")), { input: { prompt: "change it" } });
    expect({ worked, called }).toEqual({ worked: 1, called: 1 });
    expect(stub.runs[1]!.access).toBe("full");
  });
});
