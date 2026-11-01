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
  type HarnessSessionState,
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

describe("a fresh checkout's setup, on the turn that waits for it", () => {
  /** A harness that asks for its working directory, as every harness does before it runs. */
  const cwdAgent = (feeds: HarnessSessionFeeds) =>
    handler({
      name: "stub-harness",
      inputSchema: z.object({ prompt: z.string() }),
      execute: async (_input, ctx) => {
        await feeds.resume(ctx as unknown as HarnessCallbackContext);
        await feeds.cwd(ctx as unknown as HarnessCallbackContext);
        return { outcome: "completed" };
      },
    }) as unknown as HarnessBlock;

  async function cwdTurn(stores: ReturnType<typeof createInMemoryStores>, sessionId: string, workspace: HarnessSessionWorkspace) {
    if ((await stores.session.get(sessionId)) === undefined) {
      const now = Date.now();
      await stores.session.set(
        sessionId,
        { id: sessionId, flowKind: "stub-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
        "any" as never,
      );
    }
    return runAction({
      flow: harnessSessionFlow({ kind: "stub-session", workspace, agent: cwdAgent }),
      actionName: "turn",
      input: { prompt: "hello" },
      userId: "u",
      orgId: DEFAULT_ORG_ID,
      sessionId,
      stores,
      runtimeConfig: {},
    } as never);
  }

  /** Each turn's `setup`, oldest first. */
  async function setups(stores: ReturnType<typeof createInMemoryStores>, sessionId: string) {
    const turns = ((await stores.session.get(sessionId))?.state as HarnessSessionState).turns ?? {};
    return Object.values(turns)
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
      .map((record) => record.setup);
  }

  it("is running on the turn's record while the host runs it, then failed with its tail", async () => {
    const stores = createInMemoryStores();
    const seen: unknown[] = [];
    const workspace: HarnessSessionWorkspace = {
      ...noWorkspace(),
      provision: async (_place, request) => {
        await request.onSetup();
        seen.push(...(await setups(stores, "s-setup")));
        return { path: "/nowhere", setup: { status: "failed", tail: "ERR_LOCKFILE\nThe setup command exited 1." } };
      },
    };

    await cwdTurn(stores, "s-setup", workspace);

    // What a page reads while the first turn waits: "Setting up…".
    expect(seen).toEqual([{ state: "running", tail: null }]);
    // And after: "Setup failed: <tail>". The turn still ran in the checkout.
    expect(await setups(stores, "s-setup")).toEqual([
      { state: "failed", tail: "ERR_LOCKFILE\nThe setup command exited 1." },
    ]);
  });

  it("is done when it succeeded, and absent on a later turn the host ran none for", async () => {
    const stores = createInMemoryStores();
    let first = true;
    const workspace: HarnessSessionWorkspace = {
      ...noWorkspace(),
      provision: async (_place, request) => {
        if (!first) return { path: "/nowhere" };
        first = false;
        await request.onSetup();
        return { path: "/nowhere", setup: { status: "done" } };
      },
    };

    await cwdTurn(stores, "s-done", workspace);
    await cwdTurn(stores, "s-done", workspace);

    expect(await setups(stores, "s-done")).toEqual([{ state: "done", tail: null }, null]);
  });

  it("is never recorded for a host that hands back a bare path", async () => {
    const stores = createInMemoryStores();
    await cwdTurn(stores, "s-bare", noWorkspace());
    expect(await setups(stores, "s-bare")).toEqual([null]);
  });
});
