/**
 * Tests for FIX-431: cross-flow schema registry + per-flow isolation.
 * Covers storage-key derivation, registry conflict detection, and end-to-end
 * isolation behavior.
 */
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  CrossFlowSchemaConflictError,
  createExecutionContext,
  createFlowRegistry,
  createInMemoryStores,
  resolveOrgStorageKey,
  resolveUserStorageKey
} from "../src";

/**
 * One declared resource, spelled out far enough to exercise the three parts of
 * a resource's storage identity: its `scope`, its `ref` (which defaults to the
 * accessor key but is not the same thing), and its `flowIsolation` override.
 */
type ResourceSpec = {
  schema: z.ZodTypeAny;
  scope?: "user" | "org";
  /** Storage namespace. Defaults to the accessor key when omitted. */
  ref?: string;
  /** Overrides the flow-level isolation flag in both directions. */
  flowIsolation?: boolean;
  /** Declare as a collection over this glob pattern instead of a single resource. */
  pattern?: string;
};

function buildResources(
  userResources: Record<string, z.ZodTypeAny> | undefined,
  resources: Record<string, ResourceSpec> | undefined
): Record<string, unknown> | undefined {
  const declared: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(userResources ?? {})) {
    declared[name] = defineResource({ scope: "user", stateSchema: schema });
  }
  for (const [name, spec] of Object.entries(resources ?? {})) {
    const scope = spec.scope ?? "user";
    declared[name] =
      spec.pattern === undefined
        ? defineResource({
            scope,
            stateSchema: spec.schema,
            ...(spec.ref === undefined ? {} : { ref: spec.ref }),
            ...(spec.flowIsolation === undefined ? {} : { flowIsolation: spec.flowIsolation }),
          })
        : defineResourceCollection({
            scope,
            pattern: spec.pattern,
            stateSchema: spec.schema,
            ...(spec.flowIsolation === undefined ? {} : { flowIsolation: spec.flowIsolation }),
          });
  }
  return Object.keys(declared).length === 0 ? undefined : declared;
}

function makeFlowFactory(options: {
  kind: string;
  isolateUserState?: boolean;
  isolateOrgState?: boolean;
  userSchema?: z.ZodTypeAny;
  orgSchema?: z.ZodTypeAny;
  userResources?: Record<string, z.ZodTypeAny>;
  resources?: Record<string, ResourceSpec>;
}) {
  const block = handler<{ value: string }, { ok: boolean }>({
    name: "iso-handler",
    execute: () => ({ ok: true }),
  });

  // FIX-435: per-scope `resources` field is gone — keep `user.stateSchema`
  // here, and pass user- and org-scoped resources via the flat top-level
  // `flow.resources` map. Resources route to their storage layer via their
  // intrinsic `scope`.
  const user = options.userSchema
    ? { stateSchema: options.userSchema }
    : undefined;

  return defineFlow({
    kind: options.kind,
    isolateUserState: options.isolateUserState,
    isolateOrgState: options.isolateOrgState,
    actions: {
      run: { inputSchema: z.object({ value: z.string() }), block },
    },
    user,
    org: options.orgSchema ? { stateSchema: options.orgSchema } : undefined,
    resources: buildResources(options.userResources, options.resources) as never,
  });
}

function makeFlow(options: Parameters<typeof makeFlowFactory>[0]) {
  return makeFlowFactory(options)();
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

describe("resolveUserStorageKey / resolveOrgStorageKey", () => {
  it("returns the bare id when isolation is off", () => {
    const flow = makeFlow({ kind: "flow-a" });
    expect(resolveUserStorageKey("user_1", flow)).toBe("user_1");
    expect(resolveOrgStorageKey("proj_1", flow)).toBe("proj_1");
  });

  it("namespaces the key by flowKind when isolation is on", () => {
    const flow = makeFlow({ kind: "flow-a", isolateUserState: true, isolateOrgState: true });
    expect(resolveUserStorageKey("user_1", flow)).toBe("user_1:flow-a");
    expect(resolveOrgStorageKey("proj_1", flow)).toBe("proj_1:flow-a");
  });

  it("isolates user and org independently", () => {
    const flow = makeFlow({ kind: "flow-a", isolateUserState: true });
    expect(resolveUserStorageKey("user_1", flow)).toBe("user_1:flow-a");
    expect(resolveOrgStorageKey("proj_1", flow)).toBe("proj_1");
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
    // The remedy for a resource conflict is the resource's own flag — the
    // flow-level one does not reliably isolate a resource that overrode it.
    expect(error.message).toContain("flowIsolation");
  });

  it("skips cross-flow checks when a flow isolates the user scope", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));
    expect(() =>
      registry.register(makeFlow({ kind: "flow-b", isolateUserState: true, userSchema: z.object({ theme: z.number() }) }))
    ).not.toThrow();
  });

  it("reports org-scope conflicts with the correct scope label", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", orgSchema: z.object({ title: z.string() }) }));

    const error = captureConflict(() =>
      registry.register(makeFlow({ kind: "flow-b", orgSchema: z.object({ title: z.number() }) }))
    );
    expect(error.scope).toBe("org");
    expect(error.message).toContain("isolateOrgState");
  });

  it("leaves registry state unchanged when registration fails", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));
    expect(() =>
      registry.register(makeFlow({ kind: "flow-b", userSchema: z.object({ theme: z.number() }) }))
    ).toThrow();
    expect(registry.list().map((f) => f.kind)).toEqual(["flow-a"]);
  });

  it("rolls back user-scope indexing when the org-scope check fails", () => {
    // Regression: if user validates but org throws, the user participant
    // must not linger — otherwise describeSharedSchemas misreports, and a
    // retry of the same kind would self-match and skip validation.
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        userSchema: z.object({ theme: z.string() }),
        orgSchema: z.object({ title: z.string() }),
      })
    );
    expect(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          // Compatible user, incompatible org.
          userSchema: z.object({ theme: z.string() }),
          orgSchema: z.object({ title: z.number() }),
        })
      )
    ).toThrow();

    const desc = registry.describeSharedSchemas();
    expect(desc.participants.user).toEqual(["flow-a"]);
    expect(desc.participants.org).toEqual(["flow-a"]);
    expect(registry.list().map((f) => f.kind)).toEqual(["flow-a"]);
  });

  it("describeSharedSchemas reports participating flow kinds", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow({ kind: "flow-a", userSchema: z.object({ theme: z.string() }) }));
    registry.register(makeFlow({ kind: "flow-b", isolateUserState: true, userSchema: z.object({ locale: z.string() }) }));

    const desc = registry.describeSharedSchemas();
    expect(desc.participants.user).toEqual(["flow-a"]);
    expect(desc.participants.org).toEqual([]);
  });
});

/**
 * The resource half of the cross-flow check (FIX-1158). It read the legacy
 * `flow.user.resources` / `flow.org.resources` maps, which FIX-435 replaced
 * with the flat `flow.resources` map — so it iterated `undefined` and never
 * fired for either scope.
 *
 * These cases pin WHAT the restored check keys on: `(scope, ref, effective
 * flowIsolation)`. Keying on the accessor name instead reintroduces the bug in
 * a new shape — missing incompatible schemas that do share a durable cell, and
 * rejecting schemas that are genuinely isolated.
 */
describe("cross-flow resource schema validation", () => {
  it("keys on the storage ref, not the accessor name", () => {
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        resources: { prefsA: { ref: "preferences", schema: z.object({ theme: z.string() }) } },
      })
    );

    // Different accessor, same ref — one durable cell, so it must be caught.
    const error = captureConflict(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          resources: { prefsB: { ref: "preferences", schema: z.object({ theme: z.number() }) } },
        })
      )
    );
    expect(error.scope).toBe("user");
    expect(error.field).toBe("resources.preferences");
  });

  it("does not compare same-accessor resources that address different refs", () => {
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        resources: { prefs: { ref: "preferences-a", schema: z.object({ theme: z.string() }) } },
      })
    );

    // Same accessor name, different cells — nothing is shared, so an
    // incompatible schema here is not a conflict.
    expect(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          resources: { prefs: { ref: "preferences-b", schema: z.object({ theme: z.number() }) } },
        })
      )
    ).not.toThrow();
  });

  it("compares a shared resource even when its flow isolates the scope", () => {
    // The load-bearing case for evaluating resource isolation independently of
    // the flow-level flag: flow-a isolates user STATE, but this resource opts
    // back out, so it still shares a cell with flow-b's.
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        isolateUserState: true,
        userSchema: z.object({ theme: z.string() }),
        resources: { preferences: { flowIsolation: false, schema: z.object({ theme: z.string() }) } },
      })
    );

    const error = captureConflict(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          resources: { preferences: { schema: z.object({ theme: z.number() }) } },
        })
      )
    );
    expect(error.field).toBe("resources.preferences");
  });

  it("skips a resource that isolates itself on an otherwise shared flow", () => {
    // The other direction: neither flow isolates its scope, but flow-b's
    // resource is flow-namespaced, so the two never touch one cell.
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        resources: { preferences: { schema: z.object({ theme: z.string() }) } },
      })
    );

    expect(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          resources: { preferences: { flowIsolation: true, schema: z.object({ theme: z.number() }) } },
        })
      )
    ).not.toThrow();
  });

  it("skips resources promoted to isolated by the flow-level flag", () => {
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        resources: { preferences: { schema: z.object({ theme: z.string() }) } },
      })
    );

    expect(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          isolateUserState: true,
          resources: { preferences: { schema: z.object({ theme: z.number() }) } },
        })
      )
    ).not.toThrow();
  });

  it("reports org-scoped resource conflicts with the org scope label", () => {
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        resources: { roster: { scope: "org", schema: z.object({ seats: z.string() }) } },
      })
    );

    const error = captureConflict(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          resources: { roster: { scope: "org", schema: z.object({ seats: z.number() }) } },
        })
      )
    );
    expect(error.scope).toBe("org");
    expect(error.field).toBe("resources.roster");
  });

  it("reports a resource conflict from a flow whose scope record is isolated", () => {
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        resources: { preferences: { schema: z.object({ theme: z.string() }) } },
      })
    );
    registry.register(
      makeFlow({
        kind: "flow-b",
        isolateUserState: true,
        userSchema: z.object({ locale: z.string() }),
        resources: { preferences: { flowIsolation: false, schema: z.object({ theme: z.string() }) } },
      })
    );

    // flow-b participates in the user scope for its shared RESOURCE while its
    // scope record stays isolated — so the merged state view is flow-a's alone.
    const desc = registry.describeSharedSchemas();
    expect(desc.participants.user).toEqual(["flow-a", "flow-b"]);
    expect(Object.keys(desc.user.resources)).toEqual(["preferences"]);
  });

  /**
   * Two overlaps this check does NOT catch, both excluded from FIX-1158 on
   * purpose and both closed by FIX-1207. They are one question — what identity
   * the check keys on — and answering it means extending the identity model,
   * which is new capability rather than the repair this issue is.
   *
   * These assertions pin the CURRENT behaviour so the exclusion is visible and
   * deliberate. When FIX-1207 lands, both flip to `captureConflict`.
   */
  describe("known gaps, excluded by design (FIX-1207)", () => {
    it("does NOT catch a collection pattern overlapping a concrete ref", () => {
      const registry = createFlowRegistry();
      registry.register(
        makeFlow({
          kind: "flow-a",
          resources: { files: { pattern: "files/*", schema: z.object({ body: z.string() }) } },
        })
      );

      // `resolveCollectionKey("files/*", "a")` resolves to `files/a` — the same
      // ResourceStateStore cell flow-b declares. Exact-ref comparison indexes
      // them under `files/*` and `files/a`, so they never meet.
      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-b",
            resources: { fileA: { ref: "files/a", schema: z.object({ body: z.number() }) } },
          })
        )
      ).not.toThrow();
    });

    it("does NOT catch two instances of one flow kind with differing overrides", () => {
      const registry = createFlowRegistry();
      const factory = makeFlowFactory({
        kind: "flow-a",
        resources: { preferences: { schema: z.object({ theme: z.string() }) } },
      });

      registry.register(factory({ id: "instance-1" }));

      // Per-instance `resources` overrides can disagree over the same cell,
      // but participants are retained per flowKind and same-kind pairs are
      // skipped, so the second instance is never compared to the first.
      expect(() =>
        registry.register(
          factory({
            id: "instance-2",
            resources: {
              preferences: defineResource({ scope: "user", stateSchema: z.object({ theme: z.number() }) }),
            } as never,
          })
        )
      ).not.toThrow();
    });
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

  it("uses namespaced key for org scope when isolated", async () => {
    const flow = makeFlow({
      kind: "flow-iso-proj",
      isolateOrgState: true,
      orgSchema: z.object({ title: z.string().optional() }),
    });
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow, actionName: "run", requestId: "req_1", sessionId: "sess_1", userId: "user_1", orgId: "proj_1", stores,
    });
    await ctx.org?.patchState({ title: "My Project" });

    const namespaced = await stores.org.get("proj_1:flow-iso-proj");
    expect(namespaced?.state).toMatchObject({ title: "My Project" });
    expect(namespaced?.orgId).toBe("proj_1");
    expect(await stores.org.get("proj_1")).toBeUndefined();
  });
});
