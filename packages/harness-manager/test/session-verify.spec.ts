/**
 * `harnessSessionFlow`'s `verify`: a turn the harness finished runs the host's
 * checks in the session's working directory and records them on the turn. A
 * red check is reported, never a failed turn.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { harnessSessionFlow, type HarnessSessionState, type HarnessSessionWorkspace } from "../src";

const dir = mkdtempSync(join(tmpdir(), "session-verify-"));
writeFileSync(join(dir, "red.mjs"), "console.error('VERIFY-MARKER'); process.exit(1);");
writeFileSync(join(dir, "green.mjs"), "console.log('ok');");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const workspace: HarnessSessionWorkspace = { provision: async () => dir, locate: () => dir, branch: () => null };

/** A harness that ends with `outcome`, running nothing. */
const agentEnding = (outcome: "finished" | "failed") => () =>
  handler({
    name: "stub-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async () => ({ source: "stub/test", status: "completed", sessionId: null, url: null, dispatchedAt: 0, outcome, finalMessage: null }),
  }) as unknown as HarnessBlock;

async function turnOf(sessionId: string, outcome: "finished" | "failed", commands: string[]) {
  const stores = createInMemoryStores();
  const now = Date.now();
  await stores.session.set(
    sessionId,
    { id: sessionId, flowKind: "verify-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
    "any" as never,
  );
  const result = (await runAction({
    flow: harnessSessionFlow({ kind: "verify-session", workspace, agent: agentEnding(outcome), verify: { commands, timeoutMs: 20_000 } }),
    actionName: "turn",
    input: { prompt: "change it" },
    userId: "u",
    orgId: DEFAULT_ORG_ID,
    sessionId,
    stores,
    runtimeConfig: {},
  } as never)) as { error?: unknown };
  const state = (await stores.session.get(sessionId))?.state as HarnessSessionState;
  return { result, turn: Object.values(state.turns ?? {})[0] };
}

describe("a session's checks at the end of a turn", () => {
  it("records a red check on the turn and leaves the turn standing", async () => {
    const { result, turn } = await turnOf("s-red", "finished", ["node red.mjs", "node green.mjs"]);
    expect(result.error).toBeUndefined();
    expect(turn?.error ?? null).toBeNull();
    expect(turn?.checks).toEqual([
      expect.objectContaining({ command: "node red.mjs", exitCode: 1 }),
      expect.objectContaining({ command: "node green.mjs", exitCode: 0 }),
    ]);
    expect(turn?.checks?.[0]?.tail).toContain("VERIFY-MARKER");
  });

  it("runs nothing after a turn the harness reported as failed", async () => {
    const { turn } = await turnOf("s-failed", "failed", ["node green.mjs"]);
    expect(turn?.checks ?? null).toBeNull();
  });

  it("refuses a verify with no time budget when the flow is built", () => {
    expect(() =>
      harnessSessionFlow({ kind: "k", workspace, agent: agentEnding("finished"), verify: { commands: [], timeoutMs: 0 } }),
    ).toThrow(/timeoutMs/);
  });
});
