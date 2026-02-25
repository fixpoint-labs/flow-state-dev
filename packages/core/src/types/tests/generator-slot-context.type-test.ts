import { z } from "zod";
import { generator } from "../../blocks/generator";

const generatorContextTypeSmoke = generator({
  name: "generator-context-type-smoke",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  userStateSchema: z.object({ preferredModel: z.string().optional() }),
  sessionResourceSchemas: z.object({
    artifacts: z.object({
      order: z.array(z.string()),
      byId: z.record(z.object({ title: z.string().optional() }))
    })
  }),
  model: (_input, ctx) => ctx.user.state.preferredModel ?? "demo-model",
  prompt: "type smoke",
  context: [
    (input, ctx) => {
      const message: string = input.message;
      const artifacts = ctx.session.resources.get("artifacts").state;
      const firstId = artifacts.order[0];
      const firstTitle = firstId === undefined ? undefined : artifacts.byId[firstId]?.title;
      return `${message}:${firstTitle ?? "none"}`;
    }
  ],
  user: (input) => input.message
});

void generatorContextTypeSmoke;
export const generatorSlotContextTypeSmoke = true;
