/**
 * Tests for FIX-431: cross-flow schema registry + per-flow isolation.
 * Covers storage-key derivation, registry conflict detection, and end-to-end
 * isolation behavior across both in-memory and (via shared contract) other
 * store adapters.
 */
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
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

  const userResources =
    options.userResources !== undefined
      ? Object.fromEntries(
          Object.entries(options.userResources).map(([name, schema]) => [
            name,
            defineResource({ stateSchema: schema }),
          ])
        )
      : undefined;

  return defineFlow({
    kind: options.kind,
    isolateUserState: options.isolateUserState,
    isolateProjectState: options.isolateProjectState,
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block,
      },
    },
    user: (options.userSchema !== undefined || userResources !== undefined)
      ? {
          ...(options.userSchema !== undefined ? { stateSchema: options.userSchema } : {}),
          ...(userResources !== undefined ? { resources: userResources } : {}),
        }
      : undefined,
    project: options.projectSchema !== undefined
      ? { stateSchema: options.projectSchema }
      : undefined,
  })();
}

describe("resolveUserStorageKey / resolveProjectStorageKey", () => {
  it("returns the bare id when isolation is off", () => {
    const flow = makeFlow({ kind: "flow-a" });
    expect(resolveUserStorageKey("user_1", flow)).toBe("user_1");
    expect(resolveProjectStorageKey("proj_1", flow)).toBe("proj_1");
  });

  it("namespaces the key by flowKind when isolation is on", () => {
    const flow = makeFlow({
      kind: "flow-a",
      isolateUserState: true,
      isolateProjectState: true,
    });
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
    const flowA = makeFlow({
      kind: "flow-a",
      userSchema: z.object({ theme: z.string(), locale: z.string().optional() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      userSchema: z.object({ theme: z.string(), locale: z.string().optional() }),
    });

    const registry = createFlowRegistry();
    registry.register(flowA);
    expect(() => registry.register(flowB)).not.toThrow();
  });

  it("allows structural extension (one flow adds fields) without error", () => {
    const warnSpy = vitestWarnSpy();

    const flowA = makeFlow({
      kind: "flow-a",
      userSchema: z.object({ theme: z.string() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      userSchema: z.object({ theme: z.string(), extra: z.string() }),
    });

    const registry = createFlowRegistry();
    registry.register(flowA);
    registry.register(flowB);

    expect(warnSpy.messages.some((m) => m.includes("compatible"))).toBe(true);
    warnSpy.restore();
  });

  it("rejects two flows with incompatible user.stateSchema", () => {
    const flowA = makeFlow({
      kind: "flow-a",
      userSchema: z.object({ theme: z.string() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      userSchema: z.object({ theme: z.number() }),
    });

    const registry = createFlowRegistry();
    registry.register(flowA);
    expect(() => registry.register(flowB)).toThrow(CrossFlowSchemaConflictError);

    try {
      registry.register(flowB);
    } catch (err) {
      const error = err as CrossFlowSchemaConflictError;
      expect(error.scope).toBe("user");
      expect(error.field).toBe("stateSchema");
      expect(new Set([error.flowA, error.flowB])).toEqual(new Set(["flow-a", "flow-b"]));
      expect(error.message).toContain("flow-a");
      expect(error.message).toContain("flow-b");
      expect(error.message).toContain("isolateUserState");
    }
  });

  it("rejects same-named resources with incompatible schemas", () => {
    const flowA = makeFlow({
      kind: "flow-a",
      userResources: { preferences: z.object({ theme: z.string() }) },
    });
    const flowB = makeFlow({
      kind: "flow-b",
      userResources: { preferences: z.object({ theme: z.number() }) },
    });

    const registry = createFlowRegistry();
    registry.register(flowA);

    try {
      registry.register(flowB);
      expect.fail("expected CrossFlowSchemaConflictError");
    } catch (err) {
      const error = err as CrossFlowSchemaConflictError;
      expect(error).toBeInstanceOf(CrossFlowSchemaConflictError);
      expect(error.scope).toBe("user");
      expect(error.field).toBe("resources.preferences");
    }
  });

  it("skips cross-flow checks when a flow isolates the user scope", () => {
    const flowA = makeFlow({
      kind: "flow-a",
      userSchema: z.object({ theme: z.string() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      isolateUserState: true,
      userSchema: z.object({ theme: z.number() }),
    });

    const registry = createFlowRegistry();
    registry.register(flowA);
    expect(() => registry.register(flowB)).not.toThrow();
  });

  it("reports project-scope conflicts with the correct scope label", () => {
    const flowA = makeFlow({
      kind: "flow-a",
      projectSchema: z.object({ title: z.string() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      projectSchema: z.object({ title: z.number() }),
    });

    const registry = createFlowRegistry();
    registry.register(flowA);
    try {
      registry.register(flowB);
      expect.fail("expected CrossFlowSchemaConflictError");
    } catch (err) {
      const error = err as CrossFlowSchemaConflictError;
      expect(error.scope).toBe("project");
      expect(error.message).toContain("isolateProjectState");
    }
  });

  it("leaves registry state unchanged when registration fails", () => {
    const flowA = makeFlow({
      kind: "flow-a",
      userSchema: z.object({ theme: z.string() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      userSchema: z.object({ theme: z.number() }),
    });

    const registry = createFlowRegistry();
    registry.register(flowA);
    expect(() => registry.register(flowB)).toThrow();
    expect(registry.list().map((f) => f.kind)).toEqual(["flow-a"]);
  });

  it("describeSharedSchemas reports participating flow kinds", () => {
    const flowA = makeFlow({
      kind: "flow-a",
      userSchema: z.object({ theme: z.string() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      isolateUserState: true,
      userSchema: z.object({ locale: z.string() }),
    });

    const registry = createFlowRegistry();
    registry.register(flowA);
    registry.register(flowB);

    const desc = registry.describeSharedSchemas();
    expect(desc.participants.user).toEqual(["flow-a"]);
    expect(desc.participants.project).toEqual([]);
  });
});

describe("end-to-end: shared vs isolated state", () => {
  it("shares user-scope state across compatible flows by default", async () => {
    const flowA = makeFlow({
      kind: "flow-a",
      userSchema: z.object({ displayName: z.string().optional() }),
    });
    const flowB = makeFlow({
      kind: "flow-b",
      userSchema: z.object({ displayName: z.string().optional() }),
    });

    const stores = createInMemoryStores();

    const ctxA = await createExecutionContext({
      flow: flowA,
      actionName: "run",
      requestId: "req_a",
      sessionId: "sess_a",
      userId: "user_1",
      stores,
    });
    await ctxA.user.patchState({ displayName: "Alice" });

    const ctxB = await createExecutionContext({
      flow: flowB,
      actionName: "run",
      requestId: "req_b",
      sessionId: "sess_b",
      userId: "user_1",
      stores,
    });

    expect(ctxB.user.state).toMatchObject({ displayName: "Alice" });
  });

  it("isolated flow does not see shared-flow state and vice versa", async () => {
    const sharedFlow = makeFlow({
      kind: "shared-flow",
      userSchema: z.object({ displayName: z.string().optional() }),
    });
    const isolatedFlow = makeFlow({
      kind: "isolated-flow",
      isolateUserState: true,
      userSchema: z.object({ locale: z.string().optional() }),
    });

    const stores = createInMemoryStores();

    const ctxShared = await createExecutionContext({
      flow: sharedFlow,
      actionName: "run",
      requestId: "req_shared",
      sessionId: "sess_shared",
      userId: "user_1",
      stores,
    });
    await ctxShared.user.patchState({ displayName: "Alice" });

    const ctxIsolated = await createExecutionContext({
      flow: isolatedFlow,
      actionName: "run",
      requestId: "req_iso",
      sessionId: "sess_iso",
      userId: "user_1",
      stores,
    });
    await ctxIsolated.user.patchState({ locale: "en" });

    expect(ctxIsolated.user.state).not.toMatchObject({ displayName: "Alice" });
    expect(ctxIsolated.user.state).toMatchObject({ locale: "en" });

    // Shared record must survive — no silent destruction.
    const sharedRecord = await stores.user.get("user_1");
    expect(sharedRecord?.state).toMatchObject({ displayName: "Alice" });
    expect((sharedRecord?.state as { locale?: string }).locale).toBeUndefined();

    const isolatedRecord = await stores.user.get("user_1:isolated-flow");
    expect(isolatedRecord?.state).toMatchObject({ locale: "en" });
    expect((isolatedRecord?.state as { displayName?: string }).displayName).toBeUndefined();
  });

  it("uses namespaced key for project scope when isolated", async () => {
    const flow = makeFlow({
      kind: "flow-iso-proj",
      isolateProjectState: true,
      projectSchema: z.object({ title: z.string().optional() }),
    });

    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_1",
      sessionId: "sess_1",
      userId: "user_1",
      projectId: "proj_1",
      stores,
    });
    await ctx.project?.patchState({ title: "My Project" });

    const namespaced = await stores.project.get("proj_1:flow-iso-proj");
    expect(namespaced?.state).toMatchObject({ title: "My Project" });
    expect(namespaced?.projectId).toBe("proj_1");

    const bare = await stores.project.get("proj_1");
    expect(bare).toBeUndefined();
  });

  it("preserves UserRecord.userId as the bare identity when isolated", async () => {
    const flow = makeFlow({
      kind: "iso-user",
      isolateUserState: true,
      userSchema: z.object({ locale: z.string().optional() }),
    });

    const stores = createInMemoryStores();
    await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_1",
      sessionId: "sess_1",
      userId: "user_1",
      stores,
    });

    const record = await stores.user.get("user_1:iso-user");
    expect(record?.id).toBe("user_1:iso-user");
    expect(record?.userId).toBe("user_1");
  });

  it("existing flows without isolation flags keep the previous storage key", async () => {
    const flow = makeFlow({
      kind: "legacy",
      userSchema: z.object({ name: z.string().optional() }),
    });
    const stores = createInMemoryStores();

    await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_1",
      sessionId: "sess_1",
      userId: "user_1",
      stores,
    });

    const bare = await stores.user.get("user_1");
    expect(bare?.id).toBe("user_1");
  });
});

function vitestWarnSpy() {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  return {
    messages,
    restore() {
      console.warn = original;
    },
  };
}
