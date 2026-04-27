import { z } from "zod";
import { defineFlow } from "../../flow/defineFlow";
import { defineResource } from "../resource";
import { contextFn } from "../../context";
import { section, list } from "../../prompt";

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
