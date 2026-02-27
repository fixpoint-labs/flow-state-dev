import { z } from "zod";
import { defineFlow } from "../../flow/defineFlow";
import { defineProjection, defineResource } from "../resource";

const projectionResourceInferenceSmoke = defineFlow({
  kind: "projection-resource-inference-smoke",
  actions: {},
  session: {
    resources: {
      artifacts: {
        stateSchema: z.object({
          order: z.array(z.string()),
          byId: z.record(z.object({ title: z.string() }))
        })
      }
    },
    projections: {
      artifactsTitles: {
        client: true,
        compute: (ctx) => {
          const artifacts = ctx.session.resources.get("artifacts").state;
          const firstId = artifacts.order[0];
          const title = firstId === undefined ? undefined : artifacts.byId[firstId]?.title;
          return title ?? "untitled";
        }
      }
    }
  }
});

void projectionResourceInferenceSmoke;
export const projectionResourceInferenceTypeSmoke = true;


const artifactsResource = defineResource({
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

const portableProjection = defineProjection({
  client: true,
  sessionResourceSchemas: {
    artifacts: artifactsResource
  },
  compute: (ctx) => {
    const artifacts = ctx.session.resources.get("artifacts").state;
    const firstId = artifacts.order[0];
    return firstId === undefined ? "untitled" : artifacts.byId[firstId]?.title ?? "untitled";
  }
});

void portableProjection;
