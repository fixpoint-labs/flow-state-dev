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
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryStores, runAction, runRead } from "@flow-state-dev/engine";
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

describe("what a turn changed", () => {
  // A page shows each turn's own changes (FIX-2384): a later turn's commits
  // must not be read as an earlier one's, and a turn's base comes from the
  // checkout as the turn found it, never from the caller.
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

  /** A session that works in one real git checkout, and a harness that commits one file per turn, named by its prompt. */
  function committing() {
    const dir = mkdtempSync(join(tmpdir(), "hm-session-changes-"));
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "README.md"), "start\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "start");
    const workspace: HarnessSessionWorkspace = { provision: async () => dir, locate: () => dir, branch: () => null };
    const agent = (feeds: HarnessSessionFeeds) =>
      handler({
        name: "committing-harness",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async (input, ctx) => {
          const cwd = await feeds.cwd(ctx as unknown as HarnessCallbackContext);
          writeFileSync(join(cwd, `${input.prompt}.txt`), `${input.prompt}\n`);
          git(cwd, "add", ".");
          git(cwd, "commit", "-q", "-m", input.prompt);
          return { outcome: "completed" };
        },
      }) as unknown as HarnessBlock;
    const flow = harnessSessionFlow({ kind: "stub-session", workspace, agent });
    return { dir, flow };
  }

  it("reads each turn's own files between the commits its record keeps, and one file's patch", async () => {
    const stores = createInMemoryStores();
    const { dir, flow } = committing();
    try {
      const now = Date.now();
      await stores.session.set(
        "s-changes",
        { id: "s-changes", flowKind: "stub-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
        "any" as never,
      );
      const act = (prompt: string) =>
        runAction({ flow, actionName: "turn", input: { prompt }, userId: "u", orgId: DEFAULT_ORG_ID, sessionId: "s-changes", stores, runtimeConfig: {} } as never);
      await act("first");
      await act("second");
      const turns = Object.entries(((await stores.session.get("s-changes"))!.state as { turns: Record<string, { at: number; base: string | null; head: string | null }> }).turns)
        .sort(([, a], [, b]) => a.at - b.at)
        .map(([id, record]) => ({ id, ...record }));
      expect(turns).toHaveLength(2);
      expect(turns[1]!.base).toBe(turns[0]!.head);

      const read = (input: unknown) => runRead({ flow, readName: "changes", input, userId: "u", orgId: DEFAULT_ORG_ID, sessionId: "s-changes", stores });
      expect(await read({ turn: turns[0]!.id })).toMatchObject({
        diff: { files: [{ path: "first.txt", added: 1, removed: 0 }], verified: true },
        patch: null,
      });
      expect(await read({ turn: turns[1]!.id })).toMatchObject({ diff: { files: [{ path: "second.txt" }] } });
      const patch = (await read({ turn: turns[0]!.id, path: "first.txt" })) as { patch: { patch: string } };
      expect(patch.patch.patch).toContain("+first");
      await expect(read({ turn: "no-such-turn" })).rejects.toThrow(/no turn/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records no base for a turn that never reached a git checkout, and reads it as unverified", async () => {
    const stores = createInMemoryStores();
    await turn(stores, "s-nogit", "hello");
    const [id, record] = Object.entries(((await stores.session.get("s-nogit"))!.state as { turns: Record<string, { base: string | null }> }).turns)[0]!;
    expect(record.base).toBeNull();
    const flow = harnessSessionFlow({ kind: "stub-session", workspace: noWorkspace(), agent: stubAgent });
    expect(await runRead({ flow, readName: "changes", input: { turn: id }, userId: "u", orgId: DEFAULT_ORG_ID, sessionId: "s-nogit", stores })).toMatchObject({
      diff: { files: [], verified: false },
    });
  });
});
