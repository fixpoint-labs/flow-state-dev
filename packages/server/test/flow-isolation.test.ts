/**
 * Tests for FIX-431: cross-flow schema registry + per-flow isolation.
 * Covers storage-key derivation, registry conflict detection, and end-to-end
 * isolation behavior.
 */
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  CrossFlowSchemaConflictError,
  createExecutionContext,
  createFlowRegistry,
  createInMemoryStores,
  resolveProjectStorageKey,
  resolveUserStorageKey
} from "../src";

function makeFlow(options: {
  kind: string;
  isolateUserState?: boolean;
  isolateProjectState?: boolean;
  userSchema?: z.ZodTypeAny;
  projectSchema?: z.ZodTypeAny;
  userResources?: Record<string, z.ZodTypeAny>;
}) {
  const block = handler<{ value: string }, { ok: boolean }>({
    name: "iso-handler",
    execute: () => ({ ok: true }),
  });

  const userResources = options.userResources
    ? Object.fromEntries(
        Object.entries(options.userResources).map(([name, schema]) => [
          name,
          defineResource({ stateSchema: schema }),
        ])
      )
    : undefined;

  const user = options.userSchema || userResources
    ? { ...(options.userSchema ? { stateSchema: options.userSchema } : {}), ...(userResources ? { resources: userResources } : {}) }
    : undefined;

  return defineFlow({
    kind: options.kind,
    isolateUserState: options.isolateUserState,
    isolateProjectState: options.isolateProjectState,
    actions: {
      run: { inputSchema: z.object({ value: z.string() }), block },
    },
    user,
    project: options.projectSchema ? { stateSchema: options.projectSchema } : undefined,
  })();
}

function captureConflict(fn: () => void): CrossFlowSchemaConflictError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CrossFlowSchemaConflictError) return err;
    throw err;
  }
  throw new Error("expected CrossFlowSchemaConflictError");
}

describe("resolveUserStorageKey / resolveProjectStorageKey", () => {
  it("returns the bare id when isolation is off", () => {
    const flow = makeFlow({ kind: "flow-a" });
    expect(resolveUserStorageKey("user_1", flow)).toBe("user_1");
    expect(resolveProjectStorageKey("proj_1", flow)).toBe("proj_1");
  });

  it("namespaces the key by flowKind when isolation is on", () => {
    const flow = makeFlow({ kind: "flow-a", isolateUserState: true, isolateProjectState: true });
    expect(resolveUserStorageKey("user_1", flow)).toBe("user_1:flow-a");
    expect(resolveProjectStorageKey("proj_1", flow)).toBe("proj_1:flow-a");
  });

  it("isolates user and project independently", () => {
    const flow = makeFlow({ kind: "flow-a", isolateUserState: true });
    expect(resolveUserStorageKey("user_1", flow)).toBe("user_1:flow-a");
    expect(resolveProjectStorageKey("proj_1", flow)).toBe("proj_1");
  });
});

describe("FlowRegistry cross-flow schema validation", () => {
  it("registers two compatible flows without error", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string(), locale: z.string().optional() }) }));
    expect(() =>
      registry.register(makeFlow({ kind: "flow-b", userSchema: z.object({ theme: z.string(), locale: z.string().optional() }) }))
    ).not.toThrow();
  });

  it("allows structural extension (one flow adds fields) with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const registry = createFlowRegistry();
      registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));
      registry.register(makeFlow({ kind: "flow-b", userSchema: z.object({ theme: z.string(), extra: z.string() }) }));
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects two flows with incompatible user.stateSchema", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));

    const error = captureConflict(() =>
      registry.register(makeFlow({ kind: "flow-b", userSchema: z.object({ theme: z.number() }) }))
    );
    expect(error.scope).toBe("user");
    expect(error.field).toBe("stateSchema");
    expect(new Set([error.flowA, error.flowB])).toEqual(new Set(["flow-a", "flow-b"]));
    expect(error.message).toContain("isolateUserState");
  });

  it("rejects same-named resources with incompatible schemas", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userResources: { preferences: z.object({ theme: z.string() }) } }));

    const error = captureConflict(() =>
      registry.register(makeFlow({ kind: "flow-b", userResources: { preferences: z.object({ theme: z.number() }) } }))
    );
    expect(error.scope).toBe("user");
    expect(error.field).toBe("resources.preferences");
  });

  it("skips cross-flow checks when a flow isolates the user scope", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));
    expect(() =>
      registry.register(makeFlow({ kind: "flow-b", isolateUserState: true, userSchema: z.object({ theme: z.number() }) }))
    ).not.toThrow();
  });

  it("reports project-scope conflicts with the correct scope label", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", projectSchema: z.object({ title: z.string() }) }));

    const error = captureConflict(() =>
      registry.register(makeFlow({ kind: "flow-b", projectSchema: z.object({ title: z.number() }) }))
    );
    expect(error.scope).toBe("project");
    expect(error.message).toContain("isolateProjectState");
  });

  it("leaves registry state unchanged when registration fails", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));
    expect(() =>
      registry.register(makeFlow({ kind: "flow-b", userSchema: z.object({ theme: z.number() }) }))
    ).toThrow();
    expect(registry.list().map((f) => f.kind)).toEqual(["flow-a"]);
  });

  it("describeSharedSchemas reports participating flow kinds", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));
    registry.register(makeFlow({ kind: "flow-b", isolateUserState: true, userSchema: z.object({ locale: z.string() }) }));

    const desc = registry.describeSharedSchemas();
    expect(desc.participants.user).toEqual(["flow-a"]);
    expect(desc.participants.project).toEqual([]);
  });
});

describe("end-to-end: shared vs isolated state", () => {
  it("shares user-scope state across compatible flows by default", async () => {
    const flowA = makeFlow({ kind: "flow-a", userSchema: z.object({ displayName: z.string().optional() }) });
    const flowB = makeFlow({ kind: "flow-b", userSchema: z.object({ displayName: z.string().optional() }) });
    const stores = createInMemoryStores();

    const ctxA = await createExecutionContext({
      flow: flowA, actionName: "run", requestId: "req_a", sessionId: "sess_a", userId: "user_1", stores,
    });
    await ctxA.user.patchState({ displayName: "Alice" });

    const ctxB = await createExecutionContext({
      flow: flowB, actionName: "run", requestId: "req_b", sessionId: "sess_b", userId: "user_1", stores,
    });
    expect(ctxB.user.state).toMatchObject({ displayName: "Alice" });

    // Storage uses the bare userId when neither flow isolates.
    expect((await stores.user.get("user_1"))?.id).toBe("user_1");
  });

  it("isolated flow does not see shared-flow state and vice versa", async () => {
    const sharedFlow = makeFlow({ kind: "shared-flow", userSchema: z.object({ displayName: z.string().optional() }) });
    const isolatedFlow = makeFlow({ kind: "isolated-flow", isolateUserState: true, userSchema: z.object({ locale: z.string().optional() }) });
    const stores = createInMemoryStores();

    const ctxShared = await createExecutionContext({
      flow: sharedFlow, actionName: "run", requestId: "req_shared", sessionId: "sess_shared", userId: "user_1", stores,
    });
    await ctxShared.user.patchState({ displayName: "Alice" });

    const ctxIsolated = await createExecutionContext({
      flow: isolatedFlow, actionName: "run", requestId: "req_iso", sessionId: "sess_iso", userId: "user_1", stores,
    });
    await ctxIsolated.user.patchState({ locale: "en" });

    expect(ctxIsolated.user.state).toMatchObject({ locale: "en" });
    expect(ctxIsolated.user.state).not.toHaveProperty("displayName");

    // Shared record must survive — no silent destruction.
    const shared = await stores.user.get("user_1");
    expect(shared?.state).toEqual({ displayName: "Alice" });

    const isolated = await stores.user.get("user_1:isolated-flow");
    expect(isolated?.state).toEqual({ locale: "en" });
    expect(isolated?.id).toBe("user_1:isolated-flow");
    expect(isolated?.userId).toBe("user_1");
  });

  it("uses namespaced key for project scope when isolated", async () => {
    const flow = makeFlow({
      kind: "flow-iso-proj",
      isolateProjectState: true,
      projectSchema: z.object({ title: z.string().optional() }),
    });
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow, actionName: "run", requestId: "req_1", sessionId: "sess_1", userId: "user_1", projectId: "proj_1", stores,
    });
    await ctx.project?.patchState({ title: "My Project" });

    const namespaced = await stores.project.get("proj_1:flow-iso-proj");
    expect(namespaced?.state).toMatchObject({ title: "My Project" });
    expect(namespaced?.projectId).toBe("proj_1");
    expect(await stores.project.get("proj_1")).toBeUndefined();
  });
});
