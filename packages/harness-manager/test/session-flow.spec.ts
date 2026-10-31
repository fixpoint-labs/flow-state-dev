/**
 * The harness session flow, against a stub harness rather than a real one:
 * what it does is the same for every harness it runs.
 *
 * Refused while a turn runs is concurrency the engine enforces at its dispatch
 * seam, which `runAction` bypasses; the goal check
 * `goals/harness-manager/session-worktree-lifecycle` proves it over HTTP.
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
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeLockPath } from "@flow-state-dev/workspace";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  HARNESS_SESSION_REMOVE_UNSUPPORTED,
  harnessSessionFlow,
  harnessSessionStartSchema,
  harnessSessionStateSchema,
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

/** A harness that provisions its working directory, as a real one does, and waits on `gate` when given one. */
const provisioningAgent = (gate?: Promise<void>) => (feeds: HarnessSessionFeeds) =>
  handler({
    name: "provisioning-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async (_input, ctx) => {
      await feeds.resume(ctx as unknown as HarnessCallbackContext);
      await feeds.cwd(ctx as unknown as HarnessCallbackContext);
      await gate;
      return { outcome: "completed" };
    },
  }) as unknown as HarnessBlock;

/** Where the recording workspace's sessions "work": real paths, since a turn holds its worktree's in-use lock beside it. */
const places = mkdtempSync(join(tmpdir(), "session-flow-places-"));

/** A workspace that logs what it was asked and names the branch it gives a session. */
function recordingWorkspace() {
  const provisioned: Array<{ place: HarnessSessionPlace; start: unknown }> = [];
  const removed: Array<{ place: HarnessSessionPlace; deleteBranch: boolean; force: boolean }> = [];
  const located: HarnessSessionPlace[] = [];
  const workspace: HarnessSessionWorkspace = {
    provision: async (place, request) => {
      provisioned.push({ place, start: request?.start });
      return { path: join(places, place.sessionId), branch: "fix/review-notes" };
    },
    locate: (place) => {
      located.push(place);
      return join(places, place.sessionId);
    },
    branch: () => "sessions/never-read",
    remove: async (place, options) => {
      removed.push({ place, ...options });
      return { branchDeleted: options.deleteBranch };
    },
  };
  return { workspace, provisioned, removed, located };
}

async function seed(stores: ReturnType<typeof createInMemoryStores>, sessionId: string, state: Record<string, unknown>) {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    { id: sessionId, flowKind: "stub-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
    "any" as never,
  );
}

function act(stores: ReturnType<typeof createInMemoryStores>, sessionId: string, workspace: HarnessSessionWorkspace, actionName: string, input: unknown, gate?: Promise<void>) {
  return runAction({
    flow: harnessSessionFlow({ kind: "stub-session", workspace, agent: provisioningAgent(gate) }),
    actionName,
    input,
    userId: "u",
    orgId: DEFAULT_ORG_ID,
    sessionId,
    stores,
    runtimeConfig: {},
  } as never);
}

describe("where a session starts", () => {
  it("is handed to the workspace on every provision, so the first one can honour it", async () => {
    const stores = createInMemoryStores();
    const { workspace, provisioned } = recordingWorkspace();
    await seed(stores, "s-start", { model: "stub-model", start: { pullRequest: 812 } });

    await act(stores, "s-start", workspace, "turn", { prompt: "address the review" });

    expect(provisioned.map((call) => call.start)).toEqual([{ pullRequest: 812 }]);
  });

  it("records the branch the workspace gave the session, and the turn-end check reads it", async () => {
    const stores = createInMemoryStores();
    const { workspace, located } = recordingWorkspace();
    await seed(stores, "s-record", { model: "stub-model", start: { branch: "fix/review-notes" } });

    await act(stores, "s-record", workspace, "turn", { prompt: "go" });

    const state = (await stores.session.get("s-record"))?.state as Record<string, unknown>;
    expect(state.workspace).toEqual({ path: join(places, "s-record"), branch: "fix/review-notes", removed: false });
    // The check ran for the recorded branch, not the host's `branch()`, which names one it never gave.
    expect(located).toHaveLength(1);
  });

  it("is checked at create: a malformed start is refused, so a session never starts somewhere it didn't ask for", () => {
    expect(harnessSessionStartSchema.safeParse({ base: "origin/main" }).success).toBe(true);
    expect(harnessSessionStartSchema.safeParse({ base: "main", branch: "x" }).success).toBe(false);
    expect(harnessSessionStartSchema.safeParse({ pullRequest: -1 }).success).toBe(false);
    expect(harnessSessionStateSchema.shape.start.isOptional()).toBe(true);
  });
});

describe("a turn's hold on its worktree", () => {
  it("is taken while the turn works there and let go when it ends, so a removal from any caller sees it", async () => {
    const stores = createInMemoryStores();
    const { workspace } = recordingWorkspace();
    await seed(stores, "s-held", { model: "stub-model" });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const lock = worktreeLockPath(join(places, "s-held"));

    const running = act(stores, "s-held", workspace, "turn", { prompt: "long" }, gate);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(lock)).toBe(true);
    open();
    await running;
    expect(existsSync(lock)).toBe(false);
  });
});

describe("removing a session's worktree", () => {
  it("goes through the workspace's remove and marks the record removed", async () => {
    const stores = createInMemoryStores();
    const { workspace, removed } = recordingWorkspace();
    await seed(stores, "s-rm", { model: "stub-model" });
    await act(stores, "s-rm", workspace, "turn", { prompt: "go" });

    await act(stores, "s-rm", workspace, "removeWorktree", { deleteBranch: true });

    expect(removed).toEqual([{ place: { flowKind: "stub-session", sessionId: "s-rm" }, deleteBranch: true, force: false }]);
    const state = (await stores.session.get("s-rm"))?.state as { workspace: { removed: boolean } };
    expect(state.workspace.removed).toBe(true);
  });

  it("provisions again on the next turn, and records it live", async () => {
    const stores = createInMemoryStores();
    const { workspace, provisioned } = recordingWorkspace();
    await seed(stores, "s-again", { model: "stub-model" });
    await act(stores, "s-again", workspace, "turn", { prompt: "go" });
    await act(stores, "s-again", workspace, "removeWorktree", {});
    await act(stores, "s-again", workspace, "turn", { prompt: "and again" });

    expect(provisioned).toHaveLength(2);
    const state = (await stores.session.get("s-again"))?.state as { workspace: { removed: boolean } };
    expect(state.workspace.removed).toBe(false);
  });

  it("is refused on a host whose workspace removes nothing", async () => {
    const stores = createInMemoryStores();
    await seed(stores, "s-none", { model: "stub-model" });
    const result = (await act(stores, "s-none", noWorkspace(), "removeWorktree", {})) as { output?: unknown; items: unknown[] };
    expect(result.output).toBeUndefined();
    expect(JSON.stringify(result.items)).toContain(HARNESS_SESSION_REMOVE_UNSUPPORTED);
  });
});
