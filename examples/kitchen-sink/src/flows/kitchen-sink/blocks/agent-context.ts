/**
 * Shared context functions for kitchen-sink generators.
 *
 * These are re-evaluated before each step of the tool loop (via prepareStep),
 * so generators always see fresh state — e.g. artifacts created mid-turn.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { BlockDefinition } from "@flow-state-dev/core/types";

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
  const artifacts = (ctx.session as any).resources.artifacts;
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

// ---------------------------------------------------------------------------
// Voice context
// ---------------------------------------------------------------------------
// When TTS is active or the user spoke, tell the LLM so it can adapt its
// output style (shorter sentences, no markdown tables, conversational tone).

export const voiceContext = (_input: unknown, ctx: BlockContext) => {
  const voice = (ctx as any).requestRuntime?.metadata?.voice as
    | { ttsEnabled?: boolean; inputModality?: string }
    | undefined;
  if (!voice) return undefined;
  const parts: string[] = [];
  if (voice.ttsEnabled) {
    parts.push(
      "Your response will be read aloud via text-to-speech. Keep sentences short and conversational. Avoid markdown formatting, tables, code blocks, and bullet lists — they sound bad when spoken."
    );
  }
  if (voice.inputModality === "speech") {
    parts.push("The user spoke this message (voice input). Respond conversationally.");
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
};
