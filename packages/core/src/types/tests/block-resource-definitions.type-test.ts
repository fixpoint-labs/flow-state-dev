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

// ── Define portable resources ─────────────────────────────────────────

const observationsResource = defineResource({
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), score: z.number() }))
  })
});

const artifactsResource = defineResource({
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

// ── Handler: sessionResources provides typed ctx ──────────────────────

const persistObs = handler({
  name: "persist-obs",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  sessionResources: {
    observations: observationsResource
  },
  execute: async (input, ctx) => {
    // ctx.session.resources.observations should be typed
    const entries = ctx.session.resources.observations.state.entries;
    const first = entries[0];
    void first?.text;
    void first?.score;
    void input.text;
    return { ok: true };
  }
});

// Verify BlockDefinition is returned correctly
type PersistObsOutput = typeof persistObs extends { outputSchema: { _output: infer O } } ? O : never;
type _PersistObsCheck = Assert<Equals<PersistObsOutput, { ok: boolean }>>;

// ── Handler: userResources + projectResources ─────────────────────────

const multiScopeBlock = handler({
  name: "multi-scope",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionResources: {
    observations: observationsResource
  },
  userResources: {
    artifacts: artifactsResource
  },
  execute: async (_input, ctx) => {
    // Session resources typed
    const obs = ctx.session.resources.observations.state.entries;
    void obs;

    // User resources typed
    const arts = ctx.user.resources.artifacts.state;
    const firstId = arts.order[0];
    void firstId;

    return "done";
  }
});
void multiScopeBlock;

// ── Generator: sessionResources provides typed ctx for all callbacks ──

const gen = generator({
  name: "gen-with-resources",
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.string(),
  sessionResources: {
    observations: observationsResource
  },
  model: "demo-model",
  prompt: (_input, ctx) => {
    // ctx should have typed observations
    const entries = ctx.session.resources.observations.state.entries;
    return `You have ${entries.length} observations`;
  },
  context: [
    (_input, ctx) => {
      const entries = ctx.session.resources.observations.state.entries;
      return entries.map((e: { text: string; score: number }) => e.text).join(", ");
    }
  ],
  user: (input) => input.prompt
});
void gen;

// ── Router: sessionResources provides typed ctx ───────────────────────

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
  sessionResources: {
    observations: observationsResource
  },
  routes: [routeA, routeB],
  execute: (_input, ctx) => {
    const count = ctx.session.resources.observations.state.entries.length;
    return count > 0 ? routeA : routeB;
  }
});
void routerWithResources;

// ── Backwards compatibility: sessionResourceSchemas still works ───────

const legacyHandler = handler({
  name: "legacy",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionResourceSchemas: z.object({
    artifacts: z.object({
      order: z.array(z.string()),
      byId: z.record(z.object({ title: z.string().optional() }))
    })
  }),
  execute: (_input, ctx) => {
    const artifacts = ctx.session.resources.artifacts.state;
    void artifacts.order;
    void artifacts.byId;
    return "ok";
  }
});
void legacyHandler;

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
    // Should still have untyped resource access
    void ctx.session.resources;
    return "ok";
  }
});
void noResources;

export const blockResourceDefinitionsTypeSmoke = true;
