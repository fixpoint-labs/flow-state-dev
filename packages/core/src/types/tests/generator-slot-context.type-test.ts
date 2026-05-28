import { z } from "zod";
import { generator } from "../../blocks/generator";
import { defineResource } from "../resource";

const artifactsResource = defineResource({
  ref: "artifacts",
  scope: "session",
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string().optional() }))
  })
});

const generatorContextTypeSmoke = generator({
  name: "generator-context-type-smoke",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  userStateSchema: z.object({ preferredModel: z.string().optional() }),
  resources: { artifacts: artifactsResource },
  model: (_input, ctx) => ctx.user.state.preferredModel ?? "demo-model",
  prompt: "type smoke",
  context: [
    async (input, ctx) => {
      const message: string = input.message;
      const artifacts = await ctx.resources.get("artifacts").state;
      const firstId = artifacts.order[0];
      const firstTitle = firstId === undefined ? undefined : artifacts.byId[firstId]?.title;
      return `${message}:${firstTitle ?? "none"}`;
    }
  ],
  user: (input) => input.message
});

void generatorContextTypeSmoke;

// --- Object-form context type smoke ---

const objectFormContextSmoke = generator({
  name: "object-form-context-smoke",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  model: "demo-model",
  prompt: "object-form smoke",
  context: {
    documents: ["doc-a", "doc-b"],
    "user-preferences": (input) => `pref:${input.message}`,
    memory: {
      shortTerm: ["a"],
      longTerm: () => Promise.resolve("b"),
    },
    placeholder: null,
  },
  user: (input) => input.message,
});
void objectFormContextSmoke;

// Object entries also accepted alongside strings inside an array slot.
const arrayWithObjectEntriesSmoke = generator({
  name: "array-with-object-entries-smoke",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  model: "demo-model",
  prompt: "mixed array smoke",
  context: [
    "literal string entry",
    { documents: "doc body" },
    (input) => `dynamic:${input.message}`,
  ],
  user: (input) => input.message,
});
void arrayWithObjectEntriesSmoke;

export const generatorSlotContextTypeSmoke = true;
