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

// The org and user segments are always present — `-` when the principal
// carries neither — because the tenant is part of every workspace path.
const workspaceDir = (scope: string, id: string, org = "-", user = "-") =>
  path.join(process.cwd(), ".fsdev", "workspaces", scope, org, user, id);

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
    expect(cwdOfCall(0)).toBe(workspaceDir("run", "r1", "o1", "u1"));
    expect(cwdOfCall(1)).toBe(workspaceDir("run", "r2", "o1", "u1"));
  });

  it("gives them ONE workspace when the scope is left at its default", async () => {
    // The half that must not change. Everything shipped today is on this
    // branch, and a session whose runs stopped sharing a workspace would be a
    // silent behaviour change for every existing deployment (BP-030).
    await runOnce(undefined, ctxFor("s1", "r1"));
    await runOnce(undefined, ctxFor("s1", "r2"));

    // One sandbox, reused: the second request found the first in the registry.
    expect(resolveSandbox).toHaveBeenCalledTimes(1);
    expect(cwdOfCall(0)).toBe(workspaceDir("session", "s1", "o1", "u1"));
  });

  it("keys the broader scopes on their own identities, not the request", async () => {
    await runOnce("user", ctxFor("s1", "r1"));
    expect(cwdOfCall(0)).toBe(workspaceDir("user", "u1", "o1", "u1"));

    resolveSandbox.mockClear();
    vi.resetModules();

    await runOnce("org", ctxFor("s2", "r2"));
    expect(cwdOfCall(0)).toBe(workspaceDir("org", "o1", "o1", "u1"));
  });
});

describe("scope ids as directory names", () => {
  it("keeps a traversal-shaped request id inside the workspaces root", async () => {
    // The action route takes `requestId` off the request body and validates
    // only that it is a string. That id becomes a path segment under
    // `.fsdev/workspaces/`, so `../../` in one would put a run's workspace
    // wherever the caller likes (BP-031).
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const root = process.cwd() + "/.fsdev/workspaces";
    for (const hostile of ["../../etc", "..", "a/../../b", "/abs/path"]) {
      const resolved = resolveWorkspaceCwdForTest("run", { requestId: hostile, sessionId: "s" });
      expect(resolved.startsWith(root + "/run/-/-/")).toBe(true);
      expect(resolved).not.toContain("..");
    }
  });

  it("leaves an ordinary id untouched, so no existing workspace is renamed", async () => {
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const resolved = resolveWorkspaceCwdForTest("run", { requestId: "req_x1y2", sessionId: "s" });
    expect(resolved.endsWith("/.fsdev/workspaces/run/-/-/req_x1y2")).toBe(true);
  });

  it("keeps an encoded id out of the pass-through namespace", async () => {
    // Both ids are caller-supplied. Without a disjoint representation the
    // encoding of `a/b` is itself a valid unencoded id, so an attacker who
    // wants that workspace computes the digest, submits it as their own id,
    // and it passes through untouched onto the same directory.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const encoded = resolveWorkspaceCwdForTest("run", { requestId: "a/b", sessionId: "s" });
    const impostor = encoded.slice(encoded.lastIndexOf("/") + 1);
    const passedThrough = resolveWorkspaceCwdForTest("run", {
      requestId: impostor,
      sessionId: "s",
    });
    expect(passedThrough).not.toBe(encoded);
  });

  it("bounds an over-long id to a name a filesystem accepts", async () => {
    // 300 safe characters pass every containment check and still make the
    // first write in that workspace fail ENAMETOOLONG.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const resolved = resolveWorkspaceCwdForTest("run", {
      requestId: "r".repeat(300),
      sessionId: "s",
    });
    expect(resolved.slice(resolved.lastIndexOf("/") + 1).length).toBeLessThanOrEqual(255);
  });

  it("separates two tenants that name the same request", async () => {
    // `requestId` arrives on the request body. `orgId` comes from the verified
    // principal, and is what keeps one tenant's run out of another's files.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const a = resolveWorkspaceCwdForTest("run", {
      requestId: "req_1",
      sessionId: "s",
      orgId: "org-a",
    });
    const b = resolveWorkspaceCwdForTest("run", {
      requestId: "req_1",
      sessionId: "s",
      orgId: "org-b",
    });
    expect(a).not.toBe(b);
  });

  it("refuses a local provider that sets both cwd and scope", async () => {
    // One directory is one workspace, so the scope separates nothing — every
    // run would hold its own baseline over the same files.
    const { createBashBlocks } = await import("../src/bash/blocks");
    expect(() =>
      createBashBlocks({ provider: { type: "local", cwd: "/tmp/fixed", scope: "run" } }),
    ).toThrow(/cwd.*scope|scope.*cwd/s);
  });

  it("refuses a scope on createBashTool, which has no identity to scope by", async () => {
    // Every scope is read off a block's execution context. `createBashTool`
    // returns plain AI SDK tools and never sees one, so accepting the option
    // would hand back a single shared directory while the configuration named
    // several isolated ones.
    const { createBashTool } = await import("../src/bash/create-bash-tool");
    await expect(
      createBashTool({ provider: { type: "local", scope: "run" } }),
    ).rejects.toThrow(/scope.*createBashTool/s);
  });

  it("does not collapse two hostile ids onto one workspace", async () => {
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const a = resolveWorkspaceCwdForTest("run", { requestId: "a/b", sessionId: "s" });
    const b = resolveWorkspaceCwdForTest("run", { requestId: "a\\b", sessionId: "s" });
    expect(a).not.toBe(b);
  });
});
