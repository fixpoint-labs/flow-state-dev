/**
 * The harness session flow, against a stub harness rather than a real one:
 * what it does is the same for every harness it runs.
 *
 * Red states produced before these were trusted:
 *   - drop the "already titled" guard: the second turn retitles the session.
 *   - drop the empty-title guard: a whitespace-only prompt writes an empty title.
 *   - drop the `branch` null check: the turn-end check reads a directory for a
 *     host that said its session has no branch.
 */
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  harnessSessionFlow,
  harnessSessionTitle,
  type HarnessSessionFeeds,
  type HarnessSessionPlace,
  type HarnessSessionWorkspace,
} from "../src";

/** A harness that asks which conversation to continue, as every harness does, then runs nothing. */
const stubAgent = (feeds: HarnessSessionFeeds) =>
  handler({
    name: "stub-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async (_input, ctx) => {
      await feeds.resume(ctx as unknown as HarnessCallbackContext);
      return { outcome: "completed" };
    },
  }) as unknown as HarnessBlock;

/** A host whose sessions work nowhere real, logging each place the turn-end check located. */
function noWorkspace(branch: string | null = null): HarnessSessionWorkspace & { located: HarnessSessionPlace[] } {
  const located: HarnessSessionPlace[] = [];
  return {
    located,
    provision: async () => "/nowhere",
    locate: (place) => {
      located.push(place);
      return "/nowhere";
    },
    branch: () => branch,
  };
}

/** One turn of `sessionId`, born with a model the first time, as a create through the flow's routes would be. */
async function turn(stores: ReturnType<typeof createInMemoryStores>, sessionId: string, prompt: string, workspace = noWorkspace()) {
  if ((await stores.session.get(sessionId)) === undefined) {
    const now = Date.now();
    await stores.session.set(
      sessionId,
      { id: sessionId, flowKind: "stub-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "any" as never,
    );
  }
  return runAction({
    flow: harnessSessionFlow({ kind: "stub-session", workspace, agent: stubAgent }),
    actionName: "turn",
    input: { prompt },
    userId: "u",
    orgId: DEFAULT_ORG_ID,
    sessionId,
    stores,
    runtimeConfig: {},
  } as never);
}

describe("a harness session's title", () => {
  it("is its first prompt, so the rail lists a person's words rather than an id, and later turns keep it", async () => {
    const stores = createInMemoryStores();
    await turn(stores, "s-title", "Fix the flaky retry test\nit fails on CI only");
    expect((await stores.session.get("s-title"))?.title).toBe("Fix the flaky retry test");
    await turn(stores, "s-title", "now something else entirely");
    expect((await stores.session.get("s-title"))?.title).toBe("Fix the flaky retry test");
  });

  it("waits for a prompt with words in it, rather than writing an empty title", async () => {
    const stores = createInMemoryStores();
    await turn(stores, "s-blank", "   \n  ");
    expect((await stores.session.get("s-blank"))?.title).toBeUndefined();
    await turn(stores, "s-blank", "Now a real prompt");
    expect((await stores.session.get("s-blank"))?.title).toBe("Now a real prompt");
  });

  it("is one line, collapsed and cut to a length a rail can hold", () => {
    expect(harnessSessionTitle("\n  a   b\tc  \nsecond")).toBe("a b c");
    const cut = harnessSessionTitle("x".repeat(200));
    expect(cut).toHaveLength(60);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("the turn-end pull request check", () => {
  it("is left out when the host says the session has no branch, so it reads no directory the host didn't name", async () => {
    const workspace = noWorkspace(null);
    await turn(createInMemoryStores(), "s-nobranch", "hello", workspace);
    expect(workspace.located).toEqual([]);
  });

  it("looks for the session's working directory when the host names its branch", async () => {
    const workspace = noWorkspace("sessions/s-branch");
    await turn(createInMemoryStores(), "s-branch", "hello", workspace);
    expect(workspace.located).toEqual([{ flowKind: "stub-session", sessionId: "s-branch" }]);
  });
});
