/**
 * Memory system for the rich-text-component flow.
 *
 * Configured to mirror chat-agent's mem.system() config: episodic + semantic
 * tiers at user scope. Because user-scoped resources are stored at bare
 * `userId` (no flow-isolation by default), the same user's episodic and
 * semantic memories are visible to both flows. The personalize action reads
 * those memories via `mem.capability` to weave user-specific details into
 * the rewritten text.
 *
 * Working memory is session-scoped, so it is per-rich-text-component-session
 * and starts empty — that is fine: personalize reads cross-store via
 * `mem.recall` which falls back gracefully when working memory is empty.
 */
import { system as memorySystem } from "@thought-fabric/core/memory";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../lib/models";

/**
 * Concrete model used by this flow's memory system. Independent of the
 * chat-agent's user-controlled selection — the rich-text-component flow
 * runs internal memory observation/recall on a single fixed model.
 */
export const MODEL_ID = DEFAULT_KITCHEN_SINK_MODEL;

export const mem = memorySystem({
  model: MODEL_ID,
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});
