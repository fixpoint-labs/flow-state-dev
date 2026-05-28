/**
 * Type-level smoke test for the FIX-435 unified resource installation surface.
 * Resources are declared with an intrinsic `scope`, blocks accept a single
 * `resources` map, and `ctx.resources.<key>` is the only accessor.
 */
import { z } from "zod";
import { handler } from "../../blocks/handler";
import { generator } from "../../blocks/generator";
import { router } from "../../blocks/router";
import { defineResource } from "../resource";
import type { ResourceRef } from "../resource";
import { defineResourceCollection } from "../resource-collection";
import type { ResourceCollectionRef } from "../resource-collection";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

// ── Define portable resources with intrinsic scope ────────────────────

const observationsResource = defineResource({
  ref: "observations",
  scope: "session",
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), score: z.number() }))
  })
});

const artifactsResource = defineResource({
  ref: "artifacts",
  scope: "user",
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

// ── Handler: flat `resources` map yields typed `ctx.resources.<key>` ──

const persistObs = handler({
  name: "persist-obs",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: {
    observations: observationsResource
  },
  execute: async (input, ctx) => {
    const entries = (await ctx.resources.observations.state()).entries;
    const first = entries[0];
    void first?.text;
    void first?.score;
    void input.text;
    return { ok: true };
  }
});

type PersistObsOutput = typeof persistObs extends { outputSchema: { _output: infer O } } ? O : never;
type _PersistObsCheck = Assert<Equals<PersistObsOutput, { ok: boolean }>>;

// ── Handler: resources at multiple scopes share the same flat namespace

const multiScopeBlock = handler({
  name: "multi-scope",
  inputSchema: z.string(),
  outputSchema: z.string(),
  resources: {
    observations: observationsResource,
    artifacts: artifactsResource
  },
  execute: async (_input, ctx) => {
    const obs = (await ctx.resources.observations.state()).entries;
    void obs;

    const arts = await ctx.resources.artifacts.state();
    const firstId = arts.order[0];
    void firstId;

    return "done";
  }
});
void multiScopeBlock;

// ── Generator: typed ctx.resources reaches every callback ─────────────

const gen = generator({
  name: "gen-with-resources",
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.string(),
  resources: {
    observations: observationsResource
  },
  model: "demo-model",
  prompt: async (_input, ctx) => {
    const entries = (await ctx.resources.observations.state()).entries;
    return `You have ${entries.length} observations`;
  },
  context: [
    async (_input, ctx) => {
      const entries = (await ctx.resources.observations.state()).entries;
      return entries.map((e: { text: string; score: number }) => e.text).join(", ");
    }
  ],
  user: (input) => input.prompt
});
void gen;

// ── Router: flat resources field ──────────────────────────────────────

const routeA = handler({
  name: "route-a",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input) => `a:${input}`
});

const routeB = handler({
  name: "route-b",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input) => `b:${input}`
});

const routerWithResources = router({
  name: "router-with-resources",
  inputSchema: z.string(),
  outputSchema: z.string(),
  resources: {
    observations: observationsResource
  },
  routes: [routeA, routeB],
  execute: async (_input, ctx) => {
    const count = (await ctx.resources.observations.state()).entries.length;
    return count > 0 ? routeA : routeB;
  }
});
void routerWithResources;

// ── ResourceRef / ResourceCollectionRef async accessor surface (FIX-688) ──

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  scope: "session",
  stateSchema: z.object({ language: z.string() })
});
void filesCollection;

// A standalone ref's `state()` is an async method returning Readonly<TState>.
type FileState = { language: string };
type RefStateReturn = ReturnType<ResourceRef<FileState>["state"]>;
type _RefStateIsPromise = Assert<Equals<RefStateReturn, Promise<Readonly<FileState>>>>;

// The collection ref's accessors are fully async (FIX-688).
declare const coll: ResourceCollectionRef<FileState>;

type CollGetReturn = ReturnType<typeof coll.get>;
type _CollGetIsPromise = Assert<Equals<CollGetReturn, Promise<ResourceRef<FileState>>>>;

type CollGetOptionalReturn = ReturnType<typeof coll.getOptional>;
type _CollGetOptionalIsPromise = Assert<
  Equals<CollGetOptionalReturn, Promise<ResourceRef<FileState> | undefined>>
>;

type CollCountReturn = ReturnType<typeof coll.count>;
type _CollCountIsPromise = Assert<Equals<CollCountReturn, Promise<number>>>;

type CollListReturn = ReturnType<typeof coll.list>;
type _CollListIsPagedPromise = Assert<
  Equals<
    CollListReturn,
    Promise<{ items: ResourceRef<FileState>[]; nextCursor?: string }>
  >
>;

type CollScanReturn = ReturnType<typeof coll.scan>;
type _CollScanIsAsyncIterator = Assert<
  Equals<CollScanReturn, AsyncIterableIterator<ResourceRef<FileState>>>
>;

// list() accepts the paging opts shape; scan() accepts an AbortSignal.
async function _exerciseCollSurface(): Promise<void> {
  const page = await coll.list({ limit: 10, cursor: "files/a", prefix: "files/" });
  void page.items;
  void page.nextCursor;
  const ac = new AbortController();
  for await (const ref of coll.scan({ prefix: "files/", signal: ac.signal, pageSize: 25 })) {
    void (await ref.state()).language;
  }
}
void _exerciseCollSurface;

// ── BlockDefinition.declaredResources type check ──────────────────────

const blockDef = handler({
  name: "def-check",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input) => input
});

// declaredResources is optional on BlockDefinition
const _maybeDeclared: typeof blockDef.declaredResources = undefined;
void _maybeDeclared;

// ── No resources: default ctx still works ─────────────────────────────

const noResources = handler({
  name: "no-resources",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (_input, ctx) => {
    void ctx.resources;
    return "ok";
  }
});
void noResources;

export const blockResourceDefinitionsTypeSmoke = true;
