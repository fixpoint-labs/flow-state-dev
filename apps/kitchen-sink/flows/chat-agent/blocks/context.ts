/**
 * Shared context functions for chat-agent generators.
 *
 * These are re-evaluated before each step of the tool loop (via prepareStep),
 * so generators always see fresh state — e.g. artifacts created mid-turn.
 */
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { BlockDefinition } from "@flow-state-dev/core/types";
export { voiceContext } from "@flow-state-dev/server";


// ---------------------------------------------------------------------------
// Shared memory interface
// ---------------------------------------------------------------------------
// All generator factories take this shape so the same `mem` object from
// flow.ts can be passed to createChatGenerator, createCreateGenerator, and
// createPlanDemo without adapters.

export interface GeneratorMemory {
  contextFormatter: BlockDefinition<any, any> | ((input: unknown, ctx: any) => string | undefined | Promise<string | undefined>);
  captureFromItems: BlockDefinition<any, any>;
}

// ---------------------------------------------------------------------------
// Artifact list context
// ---------------------------------------------------------------------------
// Shows artifact title + summary so the LLM has an up-to-date inventory
// without reading full content. Summary is populated by summarize-artifacts.

export const artifactListContext = (_input: unknown, ctx: BlockContext) => {
  const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<{
    title: string;
    summary: string;
    updatedAt: number;
  }>;
  const instances = artifacts.list();
  if (instances.length === 0) {
    return "No artifacts exist yet in this session.";
  }
  const list = instances
    .map((ref: any) => {
      const id = ref.name.replace("artifacts/", "");
      const title = ref.state.title ?? "Untitled";
      const summary = ref.state.summary ? ` — ${ref.state.summary}` : "";
      return `- ${id}: ${title}${summary}`;
    })
    .join("\n");
  return `Current artifacts:\n${list}`;
};
