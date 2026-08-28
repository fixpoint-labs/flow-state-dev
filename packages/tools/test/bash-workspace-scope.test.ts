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

// `run` and `session` carry the tenant because their ids come off the request
// body. `user` and `org` do not: those scopes are shared across tenants by
// design, and a tenant segment would split them.
//
// Absence is `enc-none`, a segment `safeSegment` cannot emit — a literal `-`
// would be a tenant id the engine accepts, and "no tenant" would then share a
// directory with the tenant named `-`.
const NO_TENANT = "enc-none";
// Asserted by SHAPE rather than by rebuilding the encoded name here. A test
// that re-derived the encoding would agree with a broken encoder as readily as
// a working one; what these cases are about is which identity the directory
// follows, so they check the scope, the tenant segment, and that the id it was
// keyed on is still legible in the leaf.
const expectWorkspace = (
  actual: string | undefined,
  scope: string,
  id: string,
  tenant?: string,
) => {
  const prefix = path.join(process.cwd(), ".fsdev", "workspaces", scope);
  expect(actual).toBeDefined();
  expect(actual!.startsWith(tenant === undefined ? prefix : path.join(prefix, tenant))).toBe(
    true,
  );
  expect(actual!.slice(actual!.lastIndexOf("/") + 1)).toMatch(
    new RegExp(`^enc-${id.replace(/[^A-Za-z0-9_-]/g, "-")}-[0-9a-f]{12}$`),
  );
};

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
    expectWorkspace(cwdOfCall(0), "run", "r1", NO_TENANT);
    expectWorkspace(cwdOfCall(1), "run", "r2", NO_TENANT);
    expect(cwdOfCall(0)).not.toBe(cwdOfCall(1));
  });

  it("gives them ONE workspace when the scope is left at its default", async () => {
    // The half that must not change. Everything shipped today is on this
    // branch, and a session whose runs stopped sharing a workspace would be a
    // silent behaviour change for every existing deployment (BP-030).
    await runOnce(undefined, ctxFor("s1", "r1"));
    await runOnce(undefined, ctxFor("s1", "r2"));

    // One sandbox, reused: the second request found the first in the registry.
    expect(resolveSandbox).toHaveBeenCalledTimes(1);
    expectWorkspace(cwdOfCall(0), "session", "s1", NO_TENANT);
  });

  it("keys the broader scopes on their own identities, not the request", async () => {
    await runOnce("user", ctxFor("s1", "r1"));
    expectWorkspace(cwdOfCall(0), "user", "u1");

    resolveSandbox.mockClear();
    vi.resetModules();

    await runOnce("org", ctxFor("s2", "r2"));
    expectWorkspace(cwdOfCall(0), "org", "o1");
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
      expect(resolved.startsWith(root + "/run/enc-none/")).toBe(true);
      expect(resolved).not.toContain("..");
    }
  });

  it("keeps an ordinary id legible in the name it encodes to", async () => {
    // Every id is encoded — there is no pass-through — so this does rename
    // existing workspaces. What it keeps is readability for whoever runs `ls`.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const resolved = resolveWorkspaceCwdForTest("run", { requestId: "req_x1y2", sessionId: "s" });
    expect(resolved).toMatch(/\/\.fsdev\/workspaces\/run\/enc-none\/enc-req_x1y2-[0-9a-f]{12}$/);
  });

  it("cannot be handed a name that impersonates another id's encoding", async () => {
    // Compute the victim's encoded directory name and submit it as your own
    // id. A guard that recognises the encoded prefix catches this spelling.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const victim = resolveWorkspaceCwdForTest("run", { requestId: "a/b", sessionId: "s" });
    const impostorId = victim.slice(victim.lastIndexOf("/") + 1);
    const impostor = resolveWorkspaceCwdForTest("run", { requestId: impostorId, sessionId: "s" });
    expect(impostor).not.toBe(victim);
  });

  it("cannot be impersonated by a differently-cased spelling of that encoding", async () => {
    // The same attack with the prefix in caps. A case-SENSITIVE guard lets it
    // through unchanged, and on macOS APFS or Windows the two names are one
    // directory — while the raw ids still key two registry entries, so both
    // runs write the same files believing they are isolated.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const victim = resolveWorkspaceCwdForTest("run", { requestId: "a/b", sessionId: "s" });
    const shouted = victim.slice(victim.lastIndexOf("/") + 1).toUpperCase();
    const impostor = resolveWorkspaceCwdForTest("run", { requestId: shouted, sessionId: "s" });
    expect(impostor.toLowerCase()).not.toBe(victim.toLowerCase());
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
    // `requestId` arrives on the request body. `tenantId` is the framework's
    // own boundary — it already namespaces session storage so two tenants
    // sharing a session id never share data — and the workspace follows it.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const a = resolveWorkspaceCwdForTest("run", {
      requestId: "req_1",
      sessionId: "s",
      tenantId: "tenant-a",
    });
    const b = resolveWorkspaceCwdForTest("run", {
      requestId: "req_1",
      sessionId: "s",
      tenantId: "tenant-b",
    });
    expect(a).not.toBe(b);
  });

  it("keeps an org workspace shared across the org's users and tenants", async () => {
    // The contract `scope: "org"` sells is "shared across everyone in an org",
    // and core is explicit that user and org scopes stay shared across tenants
    // by design. A tenant or user segment would split exactly the sharing the
    // scope exists to provide.
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const first = resolveWorkspaceCwdForTest("org", {
      requestId: "r1",
      sessionId: "s1",
      userId: "u1",
      orgId: "acme",
      tenantId: "tenant-a",
    });
    const second = resolveWorkspaceCwdForTest("org", {
      requestId: "r2",
      sessionId: "s2",
      userId: "u2",
      orgId: "acme",
      tenantId: "tenant-b",
    });
    expect(first).toBe(second);
  });

  it("keeps a user workspace whole across that user's org contexts", async () => {
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const inOrgA = resolveWorkspaceCwdForTest("user", {
      requestId: "r1",
      sessionId: "s1",
      userId: "u1",
      orgId: "org-a",
    });
    const inOrgB = resolveWorkspaceCwdForTest("user", {
      requestId: "r2",
      sessionId: "s2",
      userId: "u1",
      orgId: "org-b",
    });
    expect(inOrgA).toBe(inOrgB);
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

  it("frames key components, so one id cannot spell another principal's key", async () => {
    // Joined raw on a delimiter these are the same string. The collision is on
    // the REGISTRY key rather than the directory — `safeSegment` keeps the
    // paths apart — so the second principal is handed the FIRST one's live
    // sandbox, before a directory of its own is ever created.
    const { resolveRegistryKeyForTest } = await import("../src/bash/blocks");
    const first = resolveRegistryKeyForTest("run", {
      requestId: "d",
      sessionId: "s",
      tenantId: "a:b",
    });
    const second = resolveRegistryKeyForTest("run", {
      requestId: "b:d",
      sessionId: "s",
      tenantId: "a",
    });
    expect(first).not.toBe(second);
  });

  it("keeps a tenantless request out of the workspace of the tenant named `-`", async () => {
    // `extractTenantId` rejects only the empty string and anything with `":"`,
    // so `-` is a tenant id a deployment can really send. A literal sentinel
    // for absence puts "no tenant" and that tenant on one key and one
    // directory.
    const { resolveWorkspaceCwdForTest, resolveRegistryKeyForTest } = await import(
      "../src/bash/blocks"
    );
    const absent = { requestId: "r1", sessionId: "s1" };
    const dashTenant = { requestId: "r1", sessionId: "s1", tenantId: "-" };

    expect(resolveWorkspaceCwdForTest("run", absent)).not.toBe(
      resolveWorkspaceCwdForTest("run", dashTenant),
    );
    expect(resolveRegistryKeyForTest("run", absent)).not.toBe(
      resolveRegistryKeyForTest("run", dashTenant),
    );
  });

  it("keeps component boundaries in the MOAT run name", async () => {
    // A run name is one flat string with no separator to spare, and MOAT
    // reconnects by name ALONE. Joining components on `-` loses their
    // boundaries, so these two identities would name one container and the
    // second principal would attach to the first's.
    const { resolveMoatRunNameForTest } = await import("../src/bash/blocks");
    const first = resolveMoatRunNameForTest({
      requestId: "r",
      sessionId: "c",
      tenantId: "a-b",
    });
    const second = resolveMoatRunNameForTest({
      requestId: "r",
      sessionId: "b-c",
      tenantId: "a",
    });
    expect(first).not.toBe(second);
  });

  it("does not collapse two hostile ids onto one workspace", async () => {
    const { resolveWorkspaceCwdForTest } = await import("../src/bash/blocks");
    const a = resolveWorkspaceCwdForTest("run", { requestId: "a/b", sessionId: "s" });
    const b = resolveWorkspaceCwdForTest("run", { requestId: "a\\b", sessionId: "s" });
    expect(a).not.toBe(b);
  });
});
