import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { artifactResourceStateSchema } from "../schemas";

export const updateArtifactInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

export const updateArtifactOutputSchema = z.object({
  success: z.boolean(),
  id: z.string()
});

// Tool block: LLM-callable artifact writer.
// Demonstrates resource mutation via updateState() — an atomic read-modify-write
// that receives the current raw state and returns the next state.
export const updateArtifact = handler({
  name: "update-artifact",
  description: "Create or update an artifact in the session artifacts resource.",
  inputSchema: updateArtifactInputSchema,
  outputSchema: updateArtifactOutputSchema,
  execute: async (input, ctx) => {
    const artifacts = ctx.session?.resources.get("artifacts");
    if (artifacts === undefined) {
      return {
        success: false,
        id: input.id
      };
    }

    // updateState() is an atomic read-modify-write. The callback receives the
    // current raw state and must return the complete next state.
    await artifacts.updateState(async (rawState) => {
      const state = artifactResourceStateSchema.parse(rawState);
      const order = state.order.includes(input.id)
        ? state.order
        : [...state.order, input.id];

      return {
        byId: {
          ...state.byId,
          [input.id]: {
            id: input.id,
            title: input.title,
            content: input.content,
            updatedAt: Date.now()
          }
        },
        order
      };
    });

    return {
      success: true,
      id: input.id
    };
  }
});
