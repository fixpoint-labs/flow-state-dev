/**
 * `harnessSessionFlow`'s `verify`: a turn the harness finished runs the host's
 * checks in the session's working directory and records them on the turn. A
 * red check is reported, never a failed turn.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/harness";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { harnessSessionFlow, type HarnessSessionState, type HarnessSessionWorkspace } from "../src";

const dir = mkdtempSync(join(tmpdir(), "session-verify-"));
writeFileSync(join(dir, "red.mjs"), "console.error('VERIFY-MARKER'); process.exit(1);");
writeFileSync(join(dir, "green.mjs"), "console.log('ok');");
writeFileSync(join(dir, "hang.mjs"), "setInterval(() => {}, 1000);");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const workspace: HarnessSessionWorkspace = { provision: async () => dir, locate: () => dir, branch: () => null };

/** A harness that ends with `outcome`, running nothing. */
const agentEnding = (outcome: "finished" | "failed") => () =>
  handler({
    name: "stub-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async () => ({ source: "stub/test", status: "completed", sessionId: null, url: null, dispatchedAt: 0, outcome, finalMessage: null }),
  }) as unknown as HarnessBlock;

async function turnOf(
  sessionId: string,
  outcome: "finished" | "failed",
  commands: string[] | (() => string[]),
  signal?: AbortSignal,
) {
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
    ...(signal !== undefined ? { signal } : {}),
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

  it("stops its commands when the turn is stopped", async () => {
    // A stopped turn that kept running commands would hold the session's
    // working directory until the checks' own clock ran out.
    const stop = new AbortController();
    const started = Date.now();
    await turnOf("s-stopped", "finished", () => {
      setTimeout(() => stop.abort(), 300);
      return ["node hang.mjs"];
    }, stop.signal);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it("names its commands in the turn's prompt with `inBrief`, so the agent can run them first", async () => {
    const prompts: string[] = [];
    const capturing = () =>
      handler({
        name: "stub-harness",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async (input: { prompt: string }) => {
          prompts.push(input.prompt);
          return { source: "stub/test", status: "completed", sessionId: null, url: null, dispatchedAt: 0, outcome: "failed", finalMessage: null };
        },
      }) as unknown as HarnessBlock;
    const turn = async (sessionId: string, inBrief: boolean) => {
      const stores = createInMemoryStores();
      const now = Date.now();
      await stores.session.set(
        sessionId,
        { id: sessionId, flowKind: "verify-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
        "any" as never,
      );
      await runAction({
        flow: harnessSessionFlow({ kind: "verify-session", workspace, agent: capturing, verify: { commands: ["node green.mjs", "node red.mjs"], timeoutMs: 20_000, inBrief } }),
        actionName: "turn",
        input: { prompt: "change it" },
        userId: "u",
        orgId: DEFAULT_ORG_ID,
        sessionId,
        stores,
        runtimeConfig: {},
      } as never);
      return prompts.at(-1);
    };
    const named = await turn("s-brief", true);
    expect(named?.startsWith("change it")).toBe(true);
    expect(named).toContain("- `node green.mjs`\n- `node red.mjs`");
    expect(named).toMatch(/name each by its command, with its result/);
    expect(await turn("s-no-brief", false)).toBe("change it");
  });

  /**
   * One turn on a fresh session whose directory appears only when provisioned, with a harness
   * that asks its cwd feed for where it works, as a real harness does. How many times the turn
   * provisioned the workspace (in all, and before the harness asked for its directory), and the
   * prompt the harness was handed.
   */
  async function freshTurn(sessionId: string, commands: string[] | ((context: { cwd: string }) => string[])) {
    const root = mkdtempSync(join(tmpdir(), "session-verify-fresh-"));
    const wt = join(root, "wt");
    let provisioned = 0;
    const fresh: HarnessSessionWorkspace = {
      provision: async () => {
        provisioned += 1;
        mkdirSync(wt, { recursive: true });
        writeFileSync(join(wt, "checks.txt"), "node from-the-checkout.mjs\n");
        return wt;
      },
      locate: () => wt,
      branch: () => null,
    };
    const prompts: string[] = [];
    const cwds: string[] = [];
    let provisionedBeforeHarness: number | null = null;
    const harness = (feeds: { cwd: (ctx: never) => Promise<string> }) =>
      handler({
        name: "stub-harness",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async (input: { prompt: string }, ctx: unknown) => {
          provisionedBeforeHarness = provisioned;
          cwds.push(await feeds.cwd(ctx as never));
          prompts.push(input.prompt);
          return { source: "stub/test", status: "completed", sessionId: null, url: null, dispatchedAt: 0, outcome: "failed", finalMessage: null };
        },
      }) as unknown as HarnessBlock;
    const stores = createInMemoryStores();
    const now = Date.now();
    await stores.session.set(
      sessionId,
      { id: sessionId, flowKind: "verify-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "any" as never,
    );
    await runAction({
      flow: harnessSessionFlow({ kind: "verify-session", workspace: fresh, agent: harness as never, verify: { commands, timeoutMs: 20_000, inBrief: true } }),
      actionName: "turn",
      input: { prompt: "change it" },
      userId: "u",
      orgId: DEFAULT_ORG_ID,
      sessionId,
      stores,
      runtimeConfig: {},
    } as never);
    rmSync(root, { recursive: true, force: true });
    return { provisioned, provisionedBeforeHarness, prompts, cwds, wt };
  }

  it("names checks a resolver reads from the session's directory on a fresh session's first turn, setting it up once", async () => {
    const turn = await freshTurn("s-fresh-fn", ({ cwd }) => readFileSync(join(cwd, "checks.txt"), "utf8").trim().split("\n"));
    expect(turn.prompts).toHaveLength(1);
    expect(turn.prompts[0]).toContain("- `node from-the-checkout.mjs`");
    // The harness works where the brief read: one setup per turn, so a slow or failing setup command runs once.
    expect(turn.cwds).toEqual([turn.wt]);
    expect(turn.provisioned).toBe(1);
  });

  it("names a fixed list without setting up the workspace for the brief", async () => {
    const turn = await freshTurn("s-fresh-list", ["node green.mjs"]);
    expect(turn.prompts[0]).toContain("- `node green.mjs`");
    // Writing a fixed list into the brief needs no directory, so nothing is set up until the harness asks.
    expect(turn.provisionedBeforeHarness).toBe(0);
    expect(turn.provisioned).toBe(1);
  });

  it("refuses a verify with no time budget when the flow is built", () => {
    expect(() =>
      harnessSessionFlow({ kind: "k", workspace, agent: agentEnding("finished"), verify: { commands: [], timeoutMs: 0 } }),
    ).toThrow(/timeoutMs/);
  });
});
