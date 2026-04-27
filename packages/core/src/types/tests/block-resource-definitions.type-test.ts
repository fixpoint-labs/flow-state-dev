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
    const entries = ctx.resources.observations.state.entries;
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
    const obs = ctx.resources.observations.state.entries;
    void obs;

    const arts = ctx.resources.artifacts.state;
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
  prompt: (_input, ctx) => {
    const entries = ctx.resources.observations.state.entries;
    return `You have ${entries.length} observations`;
  },
  context: [
    (_input, ctx) => {
      const entries = ctx.resources.observations.state.entries;
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
  execute: (_input, ctx) => {
    const count = ctx.resources.observations.state.entries.length;
    return count > 0 ? routeA : routeB;
  }
});
void routerWithResources;

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
