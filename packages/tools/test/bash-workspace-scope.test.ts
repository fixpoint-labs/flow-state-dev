/**
 * Which directory a run's workspace lands in.
 *
 * Asserted through `createBashBlocks` against a mocked `resolveSandbox`, so
 * the path under test is the real one — the scope option through to the
 * directory — rather than a pure helper reached around the outside of the
 * factory.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import path from "node:path";
import { runForTest } from "@flow-state-dev/testing";
import type { CommandResult } from "../src/bash/types";

const resolveSandbox = vi.fn(async () => ({
  sandbox: {
    async executeCommand(): Promise<CommandResult> {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async readFile(): Promise<string> {
      throw new Error("not found");
    },
    async writeFile(): Promise<void> {},
  },
  sandboxId: "sb",
}));

vi.mock("../src/bash/resolve-sandbox", () => ({
  resolveSandbox: (...args: unknown[]) => resolveSandbox(...(args as [])),
}));

/** A context carrying the identity fields the scopes key on. */
function ctxFor(sessionId: string, requestId: string) {
  return {
    request: { identity: { id: requestId } },
    session: { identity: { id: sessionId, userId: "u1", orgId: "o1" } },
    user: { identity: { id: "u1" } },
    org: { identity: { id: "o1" } },
    resources: {},
  } as any;
}

/** The workspace directory `resolveSandbox` was handed on call `n`. */
const cwdOfCall = (n: number): string | undefined =>
  (resolveSandbox.mock.calls[n]?.[1] as { cwd?: string } | undefined)?.cwd;

const workspaceDir = (scope: string, id: string) =>
  path.join(process.cwd(), ".fsdev", "workspaces", scope, id);

async function runOnce(
  scope: "run" | "session" | "user" | "org" | undefined,
  ctx: unknown,
) {
  const { createBashBlocks } = await import("../src/bash/blocks");
  const { bashCommand } = createBashBlocks({
    provider: { type: "local", ...(scope ? { scope } : {}) },
    destination: "/workspace",
  });
  await runForTest(bashCommand, { command: "ls" }, ctx as never);
}

describe("workspace scope", () => {
  beforeEach(() => {
    resolveSandbox.mockClear();
    vi.resetModules();
  });

  it("gives two requests in one session two workspaces under `run`", async () => {
    await runOnce("run", ctxFor("s1", "r1"));
    await runOnce("run", ctxFor("s1", "r2"));

    // Two sandboxes, because the registry key moved with the request.
    expect(resolveSandbox).toHaveBeenCalledTimes(2);
    expect(cwdOfCall(0)).toBe(workspaceDir("run", "r1"));
    expect(cwdOfCall(1)).toBe(workspaceDir("run", "r2"));
  });

  it("gives them ONE workspace when the scope is left at its default", async () => {
    // The half that must not change. Everything shipped today is on this
    // branch, and a session whose runs stopped sharing a workspace would be a
    // silent behaviour change for every existing deployment (BP-030).
    await runOnce(undefined, ctxFor("s1", "r1"));
    await runOnce(undefined, ctxFor("s1", "r2"));

    // One sandbox, reused: the second request found the first in the registry.
    expect(resolveSandbox).toHaveBeenCalledTimes(1);
    expect(cwdOfCall(0)).toBe(workspaceDir("session", "s1"));
  });

  it("keys the broader scopes on their own identities, not the request", async () => {
    await runOnce("user", ctxFor("s1", "r1"));
    expect(cwdOfCall(0)).toBe(workspaceDir("user", "u1"));

    resolveSandbox.mockClear();
    vi.resetModules();

    await runOnce("org", ctxFor("s2", "r2"));
    expect(cwdOfCall(0)).toBe(workspaceDir("org", "o1"));
  });
});
