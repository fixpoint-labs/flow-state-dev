/**
 * Tests for FIX-431: cross-flow schema registry + per-flow isolation.
 * Covers storage-key derivation, registry conflict detection, and end-to-end
 * isolation behavior.
 */
import {
  defineExternalResourceCollection,
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
import { resourceStorageKeys } from "../src/resources/storage-keys";
import { compareZodSchemas } from "../src/registry/schema-compat";

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
  resources: Record<string, ResourceSpec> | undefined,
  rawResources?: Record<string, unknown>
): Record<string, unknown> | undefined {
  // Pre-built entries, for the cases the spec shorthand can't express:
  // two accessors sharing ONE definition object, external collections, and
  // definitions carrying incidental extra properties.
  const declared: Record<string, unknown> = { ...rawResources };
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
  rawResources?: Record<string, unknown>;
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
    resources: buildResources(
      options.userResources,
      options.resources,
      options.rawResources
    ) as never,
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
 * These cases pin WHAT the restored check compares: shared resources at the
 * same `(scope, ref)`. Effective `flowIsolation` is a participation filter
 * applied first — isolated resources are flow-namespaced and so cannot
 * collide — rather than a third element of the key. Comparing accessor names
 * instead reintroduces the bug in a new shape: missing incompatible schemas
 * that do share a durable cell, and rejecting schemas that are genuinely
 * isolated.
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
   * The check must not INVENT conflicts either. A false rejection is a startup
   * failure for a correct program, so each case below is a valid app that must
   * register clean — the direction a green suite hides, since the broken
   * version of this check never threw at all.
   */
  describe("does not reject valid apps", () => {
    it("ignores external collections sharing a pattern", () => {
      // External collections are read-through views over the app's own store,
      // so two flows exposing `positions/*` over separate backings share no
      // framework cell. Their config admits neither `ref` nor `flowIsolation`,
      // so a rejection here would be unstartable with no way out.
      const external = (schema: z.ZodTypeAny) =>
        defineExternalResourceCollection({
          pattern: "positions/*",
          scope: "user",
          stateSchema: schema,
          read: async () => null,
          search: (async () => ({ hits: [] })) as never,
        });

      const registry = createFlowRegistry();
      registry.register(
        makeFlow({
          kind: "flow-a",
          rawResources: { portfolio: external(z.object({ shares: z.string() })) },
        })
      );

      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-b",
            rawResources: { portfolio: external(z.object({ shares: z.number() })) },
          })
        )
      ).not.toThrow();
    });

    it("canonicalizes an aliased resource to its first accessor", () => {
      // One definition object under two accessors persists to ONE slot, keyed
      // by the first accessor — `foo` here, not `preferences`. Indexing the
      // alias under its own name would collide with flow-b's unrelated
      // `preferences` cell.
      const shared = defineResource({
        scope: "user",
        stateSchema: z.object({ theme: z.string() }),
      });

      const registry = createFlowRegistry();
      registry.register(
        makeFlow({
          kind: "flow-a",
          rawResources: { foo: shared, preferences: shared },
        })
      );

      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-b",
            resources: { preferences: { schema: z.object({ theme: z.number() }) } },
          })
        )
      ).not.toThrow();
    });

    it("still catches a conflict on the canonical key of an aliased resource", () => {
      // The other direction of the same rule: flow-b addressing the canonical
      // slot (`foo`) DOES share the cell and must be rejected.
      const shared = defineResource({
        scope: "user",
        stateSchema: z.object({ theme: z.string() }),
      });

      const registry = createFlowRegistry();
      registry.register(
        makeFlow({ kind: "flow-a", rawResources: { foo: shared, preferences: shared } })
      );

      const error = captureConflict(() =>
        registry.register(
          makeFlow({
            kind: "flow-b",
            resources: { foo: { schema: z.object({ theme: z.number() }) } },
          })
        )
      );
      expect(error.field).toBe("resources.foo");
    });

    it("keys a resource carrying an incidental pattern the way persistence does", () => {
      // `defineResource` preserves unknown properties, so a plain resource can
      // carry a `pattern`. The engine's persistence path branches on the
      // STRUCTURAL `isCollectionConfig` test, so it routes this down the
      // collection branch and keys its instances off the pattern — even though
      // core's brand-based check calls it a single resource. Follow the engine:
      // these two flows share cells under `files/*` despite differing accessors.
      const withPattern = (schema: z.ZodTypeAny) =>
        defineResource({
          scope: "user",
          stateSchema: schema,
          pattern: "files/*",
        } as never);

      const registry = createFlowRegistry();
      registry.register(
        makeFlow({ kind: "flow-a", rawResources: { notes: withPattern(z.object({ body: z.string() })) } })
      );

      const error = captureConflict(() =>
        registry.register(
          makeFlow({ kind: "flow-b", rawResources: { archive: withPattern(z.object({ body: z.number() })) } })
        )
      );
      expect(error.field).toBe("resources.files/*");
    });
  });

  /**
   * Two of ONE flow's declarations can resolve to the same durable cell —
   * most reachably two collections sharing a `pattern`, which core's
   * build-time check keys apart on an incidental `ref` and therefore admits.
   * The accumulator must compare them rather than overwrite, or the earlier
   * schema silently leaves the shared view.
   */
  describe("two declarations in one flow resolving to one cell", () => {
    const coll = (schema: z.ZodTypeAny, ref: string) =>
      defineResourceCollection({
        scope: "user",
        pattern: "files/*",
        stateSchema: schema,
        ref,
      } as never);

    /** Same collection, opted into per-resource isolation. */
    const isoColl = (schema: z.ZodTypeAny, ref: string) =>
      defineResourceCollection({
        scope: "user",
        pattern: "files/*",
        stateSchema: schema,
        ref,
        flowIsolation: true,
      } as never);

    it("rejects incompatible same-pattern collections in a single flow", () => {
      const registry = createFlowRegistry();
      const error = captureConflict(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            rawResources: {
              alpha: coll(z.object({ body: z.string() }), "alpha"),
              beta: coll(z.object({ body: z.number() }), "beta"),
            },
          })
        )
      );
      expect(error.field).toBe("resources.files/*");
      // Both sides are the same flow, so isolation is no escape — isolating
      // both still lands them in one flowKind bucket.
      expect(error.message).toContain("distinct pattern");
      expect(error.message).not.toContain("flowIsolation");
    });

    it("accepts compatible same-pattern collections in a single flow", () => {
      const registry = createFlowRegistry();
      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            rawResources: {
              alpha: coll(z.object({ body: z.string() }), "alpha"),
              beta: coll(z.object({ body: z.string() }), "beta"),
            },
          })
        )
      ).not.toThrow();
    });

    it("leaves collections at differing patterns alone", () => {
      const other = defineResourceCollection({
        scope: "user",
        pattern: "notes/*",
        stateSchema: z.object({ body: z.number() }),
      } as never);

      const registry = createFlowRegistry();
      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            rawResources: { alpha: coll(z.object({ body: z.string() }), "alpha"), other },
          })
        )
      ).not.toThrow();
    });

    it("rejects incompatible same-pattern collections that are both isolated", () => {
      // Isolation moves both declarations into the one `${id}:${flowKind}`
      // bucket together — it never separates them from each other. So the
      // same-flow comparison has to run BEFORE isolated declarations are
      // filtered out of the cross-flow view, or this pair overwrites one cell
      // unchecked.
      const registry = createFlowRegistry();
      const error = captureConflict(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            rawResources: {
              alpha: isoColl(z.object({ body: z.string() }), "alpha"),
              beta: isoColl(z.object({ body: z.number() }), "beta"),
            },
          })
        )
      );
      expect(error.field).toBe("resources.files/*");
      expect(error.message).toContain("distinct pattern");
      expect(error.message).not.toContain("flowIsolation");
    });

    it("rejects the same pair when isolation comes from the flow-level flag", () => {
      // The guard has two ways in; the flow-level flag is the other.
      const registry = createFlowRegistry();
      const error = captureConflict(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            isolateUserState: true,
            rawResources: {
              alpha: coll(z.object({ body: z.string() }), "alpha"),
              beta: coll(z.object({ body: z.number() }), "beta"),
            },
          })
        )
      );
      expect(error.field).toBe("resources.files/*");
    });

    it("accepts compatible same-pattern collections that are both isolated", () => {
      const registry = createFlowRegistry();
      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            rawResources: {
              alpha: isoColl(z.object({ body: z.string() }), "alpha"),
              beta: isoColl(z.object({ body: z.string() }), "beta"),
            },
          })
        )
      ).not.toThrow();
    });

    it("leaves a shared and an isolated declaration at one pattern alone", () => {
      // The over-firing direction for the hoist: isolation is part of the cell
      // key, not ignored. These two land in different buckets — bare `{id}` and
      // `{id}:{flowKind}` — so incompatible schemas are not a conflict.
      const registry = createFlowRegistry();
      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            rawResources: {
              alpha: isoColl(z.object({ body: z.string() }), "alpha"),
              beta: defineResourceCollection({
                scope: "user",
                pattern: "files/*",
                stateSchema: z.object({ body: z.number() }),
                ref: "beta",
                flowIsolation: false,
              } as never),
            },
          })
        )
      ).not.toThrow();
    });

    it("does not compare isolated declarations across two flows", () => {
      // The hoist is per-flow: two flows each isolating the same pattern are
      // in distinct `flowKind` buckets and must stay uncompared.
      const registry = createFlowRegistry();
      registry.register(
        makeFlow({ kind: "flow-a", rawResources: { files: isoColl(z.object({ body: z.string() }), "x") } })
      );
      expect(() =>
        registry.register(
          makeFlow({ kind: "flow-b", rawResources: { files: isoColl(z.object({ body: z.number() }), "y") } })
        )
      ).not.toThrow();
    });

    it("does not treat aliases of one definition as a duplicate", () => {
      // Two accessors, one definition — canonicalized to a single ref with the
      // same schema object, so the comparison must be a no-op, not a conflict.
      const shared = defineResource({
        scope: "user",
        stateSchema: z.object({ theme: z.string() }),
      });
      const registry = createFlowRegistry();
      expect(() =>
        registry.register(
          makeFlow({ kind: "flow-a", rawResources: { foo: shared, preferences: shared } })
        )
      ).not.toThrow();
    });

    it("compares a later flow against the schema that would otherwise be dropped", () => {
      // The reported consequence: with last-write-wins only `beta` survived,
      // so a flow compatible with `beta` registered clean while sharing cells
      // with the incompatible `alpha`. Now the flow is refused at declaration.
      const registry = createFlowRegistry();
      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-a",
            rawResources: {
              alpha: coll(z.object({ body: z.string() }), "alpha"),
              beta: coll(z.object({ body: z.number() }), "beta"),
            },
          })
        )
      ).toThrow(CrossFlowSchemaConflictError);

      // Registration is transactional — the refused flow left nothing behind.
      expect(registry.list()).toEqual([]);
      expect(registry.describeSharedSchemas().participants.user).toEqual([]);
    });
  });

  /**
   * A collection's storage identity is its `pattern` and nothing else. Every
   * instance key is `resolveCollectionKey(config.pattern, key)`, and the engine
   * reads `ref` off a collection nowhere — `resourceStorageKeys` short-circuits
   * collections before it even looks. An incidental `ref` therefore moves no
   * data, and must not move the comparison either.
   */
  it("compares same-pattern collections that carry differing incidental refs", () => {
    const collection = (schema: z.ZodTypeAny, ref: string) =>
      defineResourceCollection({
        scope: "user",
        pattern: "files/*",
        stateSchema: schema,
        ref,
      } as never);

    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        rawResources: { files: collection(z.object({ body: z.string() }), "alpha") },
      })
    );

    // Different `ref`, same `pattern` — one set of durable cells. Keying on the
    // ref would file these apart and let incompatible schemas both register.
    const error = captureConflict(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          rawResources: { files: collection(z.object({ body: z.number() }), "beta") },
        })
      )
    );
    expect(error.scope).toBe("user");
    expect(error.field).toBe("resources.files/*");
    // A collection has no `ref` to change and keys on its pattern, so the
    // single-resource remedy would be advice that does nothing.
    expect(error.message).toContain("distinct pattern");
    expect(error.message).not.toContain("distinct ref");
  });

  /**
   * A `ref` is an author-supplied string used as a map key, so the maps that
   * index by it must not carry `Object.prototype`. Both directions bite:
   * writing `__proto__` hits the inherited setter instead of creating an own
   * key, and reading any inherited member name finds a function where a schema
   * should be.
   */
  describe("refs that collide with Object.prototype", () => {
    it("catches a conflict on a resource whose ref is __proto__", () => {
      const registry = createFlowRegistry();
      registry.register(
        makeFlow({
          kind: "flow-a",
          resources: { danger: { ref: "__proto__", schema: z.object({ theme: z.string() }) } },
        })
      );

      // On a plain-object accumulator this write goes through the inherited
      // `__proto__` setter, creating no enumerable own key — so the resource
      // disappears from the validator and two incompatible flows register
      // clean over one cell.
      const error = captureConflict(() =>
        registry.register(
          makeFlow({
            kind: "flow-b",
            resources: { danger: { ref: "__proto__", schema: z.object({ theme: z.number() }) } },
          })
        )
      );
      expect(error.scope).toBe("user");
      expect(error.field).toBe("resources.__proto__");
    });

    it("does not invent a conflict from an inherited Object.prototype member", () => {
      const registry = createFlowRegistry();
      registry.register(
        makeFlow({
          kind: "flow-a",
          resources: { preferences: { schema: z.object({ theme: z.string() }) } },
        })
      );

      // flow-a declares nothing at ref `toString`. Looking that ref up on a
      // plain-object map yields `Object.prototype.toString` — a function, not
      // `undefined` — which would be compared as if it were a declared schema.
      expect(() =>
        registry.register(
          makeFlow({
            kind: "flow-b",
            resources: { stringify: { ref: "toString", schema: z.object({ theme: z.number() }) } },
          })
        )
      ).not.toThrow();
    });

    it("resolves a __proto__ accessor to the same key the runtime persists under", () => {
      // The check and the write path must agree on WHERE a declaration lives.
      // `resourceStorageKeys` is the runtime's own accessor→key helper; on a
      // plain-object map a `__proto__` accessor creates no own mapping, so the
      // lookup returns `Object.prototype` and persists as `"[object Object]"`
      // while the check files it under `__proto__`. A resource declaring
      // `ref: "[object Object]"` could then overwrite that cell unchecked.
      const resource = defineResource({
        scope: "user",
        stateSchema: z.object({ theme: z.string() }),
      });
      const flow = makeFlow({ kind: "flow-proto", rawResources: { ["__proto__"]: resource } });

      // The accessor survives flow build as a real own key.
      const declared = flow.resources ?? {};
      expect(Object.hasOwn(declared, "__proto__")).toBe(true);

      const runtimeKey = resourceStorageKeys(declared)["__proto__"];
      expect(runtimeKey).toBe("__proto__");

      const registry = createFlowRegistry();
      registry.register(flow);
      expect(Object.keys(registry.describeSharedSchemas().user.resources)).toEqual([runtimeKey]);
    });

    it("resolves a __proto__ accessor to a real ref rather than a builtin", async () => {
      // The accessor→scope map, the per-scope config maps and both handle maps
      // are keyed by the same author-supplied name. On plain objects the
      // resource never got a handle at all: `get()` handed back
      // `Object.prototype` and `list()` omitted it.
      //
      // NOT yet end-to-end. This resource's state does not round-trip — the
      // default is not seeded and `patchState` throws
      // `expectedVersion ... received NaN`, because the normalizers and the
      // version map are keyed the same way and are still plain objects. Those
      // are FIX-1254's. Asserted here is only what this change fixes: lookup
      // resolves the declaration instead of a builtin.
      const resource = defineResource({
        scope: "user",
        stateSchema: z.object({ theme: z.string().default("dark") }),
      });
      const flow = makeFlow({ kind: "flow-proto", rawResources: { ["__proto__"]: resource } });
      const stores = createInMemoryStores();

      const ctx = await createExecutionContext({
        flow, actionName: "run", requestId: "req_p", sessionId: "sess_p", userId: "user_1", stores,
      });

      const bag = ctx.resources as unknown as {
        get(name: string): unknown;
        list(): unknown[];
      };
      const ref = bag.get("__proto__");
      expect(ref).not.toBe(Object.prototype);
      expect(typeof (ref as { patchState?: unknown }).patchState).toBe("function");
      expect(bag.list()).toHaveLength(1);
    });

    it("throws for an unregistered name that shadows an Object.prototype member", async () => {
      // The read-side half: on a plain handle map `get("toString")` returned
      // the builtin function instead of the honest "not registered" error.
      const flow = makeFlow({
        kind: "flow-plain",
        resources: { preferences: { schema: z.object({ theme: z.string() }) } },
      });
      const stores = createInMemoryStores();

      const ctx = await createExecutionContext({
        flow, actionName: "run", requestId: "req_t", sessionId: "sess_t", userId: "user_1", stores,
      });

      const bag = ctx.resources as unknown as { get(name: string): unknown };
      for (const name of ["toString", "constructor", "valueOf"]) {
        expect(() => bag.get(name)).toThrow(`Resource "${name}" is not registered`);
      }
    });

    it("reports a __proto__ resource in the shared schema description", () => {
      const registry = createFlowRegistry();
      registry.register(
        makeFlow({
          kind: "flow-a",
          resources: { danger: { ref: "__proto__", schema: z.object({ theme: z.string() }) } },
        })
      );

      // `describeScope` accumulates with `??=`, which reads before it writes —
      // an inherited value at that key is not nullish, so the entry is dropped.
      const desc = registry.describeSharedSchemas();
      expect(Object.keys(desc.user.resources)).toEqual(["__proto__"]);
    });
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

/**
 * A state schema may legitimately declare a field named after an
 * `Object.prototype` member. The comparator must test the OTHER shape with an
 * own-key check — `in` finds the builtin and compares a function against a Zod
 * type, turning two schemas with disjoint fields into a reported conflict.
 */
describe("schema fields named after Object.prototype members", () => {
  it("treats a prototype-named field as disjoint, not conflicting", () => {
    const withToString = z.object({ toString: z.string() });
    const without = z.object({ other: z.string() });

    const result = compareZodSchemas(withToString, without);
    expect(result.kind).toBe("compatible");
    if (result.kind === "compatible") {
      expect(result.warnings.join(" ")).toContain("toString");
    }
  });

  it("compares two schemas that both declare the field", () => {
    expect(compareZodSchemas(
      z.object({ toString: z.string() }),
      z.object({ toString: z.string() })
    ).kind).toBe("identical");

    // And a real disagreement on that field is still caught.
    const clash = compareZodSchemas(
      z.object({ toString: z.string() }),
      z.object({ toString: z.number() })
    );
    expect(clash.kind).toBe("incompatible");
  });

  it("reports disjoint fields symmetrically in both directions", () => {
    // The inherited hit also dropped the field from the disjoint report, so
    // A-vs-B and B-vs-A disagreed about what was disjoint.
    const withToString = z.object({ toString: z.string() });
    const without = z.object({ other: z.string() });

    const forward = compareZodSchemas(withToString, without);
    const backward = compareZodSchemas(without, withToString);
    expect(forward.kind).toBe("compatible");
    expect(backward.kind).toBe("compatible");
    if (forward.kind === "compatible" && backward.kind === "compatible") {
      expect(backward.warnings.join(" ")).toContain("toString");
    }
  });

  it("does not reject flows over a prototype-named schema field", () => {
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        resources: { prefs: { schema: z.object({ toString: z.string() }) } },
      })
    );
    expect(() =>
      registry.register(
        makeFlow({
          kind: "flow-b",
          resources: { prefs: { schema: z.object({ other: z.string() }) } },
        })
      )
    ).not.toThrow();
  });
});

/**
 * Compatibility is NOT transitive: `{a: string}` is compatible with both
 * `{b: string}` and `{b: number}` (disjoint fields each time), while those two
 * conflict with each other. Keeping one schema per cell and comparing every
 * later declaration against it alone would admit that pair.
 */
describe("non-transitive compatibility over one cell", () => {
  const coll = (schema: z.ZodTypeAny, ref: string) =>
    defineResourceCollection({
      scope: "user",
      pattern: "files/*",
      stateSchema: schema,
      ref,
    } as never);

  it("catches a conflict between two later declarations in one flow", () => {
    const registry = createFlowRegistry();
    const error = captureConflict(() =>
      registry.register(
        makeFlow({
          kind: "flow-a",
          rawResources: {
            one: coll(z.object({ a: z.string() }), "one"),
            two: coll(z.object({ b: z.string() }), "two"),
            three: coll(z.object({ b: z.number() }), "three"),
          },
        })
      )
    );
    expect(error.field).toBe("resources.files/*");
  });

  it("catches a conflict against a schema that is not the flow's first", () => {
    // flow-a holds two compatible declarations for one cell; flow-b conflicts
    // with the SECOND. Retaining only the first would admit it.
    const registry = createFlowRegistry();
    registry.register(
      makeFlow({
        kind: "flow-a",
        rawResources: {
          one: coll(z.object({ a: z.string() }), "one"),
          two: coll(z.object({ b: z.string() }), "two"),
        },
      })
    );

    const error = captureConflict(() =>
      registry.register(
        makeFlow({ kind: "flow-b", rawResources: { x: coll(z.object({ b: z.number() }), "x") } })
      )
    );
    expect(new Set([error.flowA, error.flowB])).toEqual(new Set(["flow-a", "flow-b"]));
  });

  it("still accepts a genuinely compatible set over one cell", () => {
    const registry = createFlowRegistry();
    expect(() =>
      registry.register(
        makeFlow({
          kind: "flow-a",
          rawResources: {
            one: coll(z.object({ a: z.string() }), "one"),
            two: coll(z.object({ b: z.string() }), "two"),
            three: coll(z.object({ c: z.string() }), "three"),
          },
        })
      )
    ).not.toThrow();
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
