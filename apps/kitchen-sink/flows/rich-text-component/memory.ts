/**
 * Memory capability for the rich-text-component flow.
 *
 * This flow only *reads* memory — the `personalize` action weaves user-scoped
 * episodic + semantic facts into rewritten text. It never captures, so it uses
 * `createMemoryCapability` (the read-side entry point) rather than `system()`,
 * which would also build the capture/consolidation/prune/janitor pipeline this
 * flow never invokes.
 *
 * The tiers mirror chat-agent's `system()` config: episodic + semantic at user
 * scope. Because user-scoped resources are stored at bare `userId` (no
 * flow-isolation by default), the same user's memories are visible to both
 * flows — chat-agent writes them, this flow reads them.
 *
 * Working memory is session-scoped, so it is per-rich-text-component-session
 * and starts empty — that is fine: recall reads cross-store and falls back
 * gracefully when working memory is empty.
 */
import { createMemoryCapability } from "@flow-state-dev/memory";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../lib/models";

/**
 * Concrete model used by this flow's recall tool. Independent of the
 * chat-agent's user-controlled selection — the rich-text-component flow
 * runs internal memory recall on a single fixed model.
 */
export const MODEL_ID = DEFAULT_KITCHEN_SINK_MODEL;

export const mem = createMemoryCapability({
  model: MODEL_ID,
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});
