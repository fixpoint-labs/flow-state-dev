import { z } from "zod";
import { defineFlow } from "../../flow/defineFlow";
import { defineResource } from "../resource";
import type { ClientDataOf } from "../resource";
import { defineResourceCollection } from "../resource-collection";
import { contextFn } from "../../context";
import { section, list } from "../../prompt";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

/**
 * Type test: clientData on session scope. Resources live in the flat
 * flow-level `resources` map (FIX-435); clientData compute functions
 * receive a typed scope-state context.
 */
const artifactsResource = defineResource({
  ref: "artifacts",
  scope: "session",
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

const clientDataResourceInferenceSmoke = defineFlow({
  kind: "clientdata-resource-inference-smoke",
  actions: {},
  resources: {
    artifacts: artifactsResource
  },
  session: {
    stateSchema: z.object({ mode: z.string() }),
    clientData: {
      modeLabel: (ctx) => {
        const mode = ctx.state.mode;
        return mode ?? "unknown";
      }
    }
  }
});

void clientDataResourceInferenceSmoke;
export const clientDataResourceInferenceTypeSmoke = true;


/**
 * Type test: contextFn with session state schema.
 */
const sessionStateSchema = z.object({
  coveredTopics: z.array(z.string()),
  currentPhase: z.string()
});

const researchCtx = contextFn(
  { session: sessionStateSchema },
  ({ session }) => {
    const topics: string[] = session.coveredTopics;
    const phase: string = session.currentPhase;
    return section("Research", list(topics), `Phase: ${phase}`);
  }
);

const _ctxFnSignatureCheck: (input: unknown, ctx: any) => string = researchCtx;
void _ctxFnSignatureCheck;


/**
 * Type test (FIX-741): a resource/collection's client projection output type is
 * threaded to `ClientDataOf<typeof def>`, derived from how the projection is
 * declared — identity default, `expose` (Pick), `exclude` (Omit), or `data`
 * (the projection fn's awaited return). Runtime is unchanged; these assertions
 * are compile-time only.
 */

// ── Collection: identity default (no projection) → full state ──────────
const identityCollection = defineResourceCollection({
  pattern: "identity/**",
  scope: "session",
  stateSchema: z.object({ a: z.string(), b: z.number() }),
  client: { state: { read: true } }
});
type _IdentityCollectionClient = Assert<
  Equals<ClientDataOf<typeof identityCollection>, { a: string; b: number }>
>;

// ── Collection: `expose` whitelist → Pick ──────────────────────────────
const exposeCollection = defineResourceCollection({
  pattern: "expose/**",
  scope: "session",
  stateSchema: z.object({ a: z.string(), b: z.number(), c: z.boolean() }),
  client: { expose: ["a", "b"] }
});
type _ExposeCollectionClient = Assert<
  Equals<ClientDataOf<typeof exposeCollection>, { a: string; b: number }>
>;

// ── Collection: `exclude` blacklist → Omit ─────────────────────────────
const excludeCollection = defineResourceCollection({
  pattern: "exclude/**",
  scope: "session",
  stateSchema: z.object({ a: z.string(), b: z.number(), secret: z.string() }),
  client: { exclude: ["secret"] }
});
type _ExcludeCollectionClient = Assert<
  Equals<ClientDataOf<typeof excludeCollection>, { a: string; b: number }>
>;

// ── Collection: `data` computed projection → awaited return ────────────
// The `data` escape hatch is a computed/transformed projection. To thread a
// precise client type, annotate the fn's return (the projection's contract);
// `ClientType` captures it via `Awaited<ReturnType>`. Without an annotation the
// type follows the fn's inferred return — see the README note. The `state` param
// stays `JsonValue`-shaped here (the generic schema type can't be resolved at the
// projection-fn position during inference), which is why the return is annotated.
const dataCollection = defineResourceCollection({
  pattern: "data/**",
  scope: "session",
  stateSchema: z.object({ a: z.string(), b: z.number() }),
  client: {
    data: (state): { label: string; count: number } => ({
      label: String(state.a),
      count: Number(state.b)
    })
  }
});
type _DataCollectionClient = Assert<
  Equals<ClientDataOf<typeof dataCollection>, { label: string; count: number }>
>;

// ── Single resource: `expose` → Pick ───────────────────────────────────
const exposeResource = defineResource({
  ref: "doc",
  scope: "session",
  stateSchema: z.object({ title: z.string(), body: z.string() }),
  client: { expose: ["title"] }
});
type _ExposeResourceClient = Assert<
  Equals<ClientDataOf<typeof exposeResource>, { title: string }>
>;

// Anchor the checks so the file isn't tree-shaken before tsc evaluates them.
export const clientProjectionOutputTypeSmoke = true;
void identityCollection;
void exposeCollection;
void excludeCollection;
void dataCollection;
void exposeResource;
type _Checks = [
  _IdentityCollectionClient,
  _ExposeCollectionClient,
  _ExcludeCollectionClient,
  _DataCollectionClient,
  _ExposeResourceClient
];
