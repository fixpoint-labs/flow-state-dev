import { z } from "zod";
import { defineFlow } from "../../flow/defineFlow";
import { defineResource } from "../resource";
import { contextFn } from "../../context";
import { section, list } from "../../prompt";

/**
 * Type test: clientData on session scope with typed resources.
 * Verifies that clientData compute functions receive properly typed
 * state and resource handles.
 */
const clientDataResourceInferenceSmoke = defineFlow({
  kind: "clientdata-resource-inference-smoke",
  actions: {},
  session: {
    stateSchema: z.object({ mode: z.string() }),
    resources: {
      artifacts: {
        stateSchema: z.object({
          order: z.array(z.string()),
          byId: z.record(z.object({ title: z.string() }))
        })
      }
    },
    clientData: {
      artifactsTitles: (ctx) => {
        // ctx.state is JsonObject (same as old projections — state schema
        // validation happens at write time, not in clientData compute)
        const mode = ctx.state.mode;
        void mode;

        // ctx.resources.artifacts should be typed with ResourceHandle
        const artifacts = ctx.resources.artifacts.state;
        const firstId = artifacts.order[0];
        const title = firstId === undefined ? undefined : artifacts.byId[firstId]?.title;
        return title ?? "untitled";
      }
    }
  }
});

void clientDataResourceInferenceSmoke;
export const clientDataResourceInferenceTypeSmoke = true;


/**
 * Type test: contextFn with session state schema.
 * Verifies that contextFn callback receives properly typed scopes.
 */
const sessionStateSchema = z.object({
  coveredTopics: z.array(z.string()),
  currentPhase: z.string()
});

const researchCtx = contextFn(
  { session: sessionStateSchema },
  ({ session }) => {
    // session.coveredTopics should be string[]
    const topics: string[] = session.coveredTopics;
    const phase: string = session.currentPhase;
    return section("Research", list(topics), `Phase: ${phase}`);
  }
);

// contextFn should return a function compatible with generator context slots
const _ctxFnSignatureCheck: (input: unknown, ctx: any) => string = researchCtx;
void _ctxFnSignatureCheck;


/**
 * Type test: defineResource still works unchanged.
 */
const artifactsResource = defineResource({
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

void artifactsResource;
