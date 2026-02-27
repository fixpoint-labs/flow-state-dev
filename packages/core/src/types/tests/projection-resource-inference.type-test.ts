import { z } from "zod";
import { defineFlow } from "../../flow/defineFlow";
import { defineProjection, defineResource } from "../resource";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;

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
          const requestStateNotAny: AssertFalse<IsAny<typeof ctx.request.state>> = false;
          const sessionStateNotAny: AssertFalse<IsAny<typeof ctx.session.state>> = false;
          const userStateNotAny: AssertFalse<IsAny<NonNullable<typeof ctx.user>["state"]>> = false;
          const projectStateNotAny: AssertFalse<IsAny<NonNullable<typeof ctx.project>["state"]>> = false;

          void requestStateNotAny;
          void sessionStateNotAny;
          void userStateNotAny;
          void projectStateNotAny;

          const artifacts = ctx.session.resources.artifacts.state;
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
    const artifacts = ctx.session.resources.artifacts.state;
    const firstId = artifacts.order[0];
    return firstId === undefined ? "untitled" : artifacts.byId[firstId]?.title ?? "untitled";
  }
});

void portableProjection;
