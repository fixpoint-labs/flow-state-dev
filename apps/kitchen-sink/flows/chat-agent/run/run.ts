/**
 * The `run` action — the chat turn's root sequencer.
 *
 * Pipeline order:
 *   applyRequestedMode → applyFeatures → skillActivator → resolveThinkingStyle
 *     → thinkingStyleRouter → biasCheck (.work) → perspective capture (.workIf)
 *     → mem.captureFromItems (.work) → autoTitle (.work) → incrementRequestCount
 *
 * The router dispatches to the assistant generator (default) or one of the five
 * pattern pipelines; everything after it runs as background `.work()` except the
 * terminal request-count bump.
 */
import { sequencer, utility } from "@flow-state-dev/core";
import {
  applyRequestedMode,
  applyFeatures,
  incrementRequestCount,
  resolveThinkingStyle,
} from "./steps";
import { skillActivatorBlock } from "../shared/capabilities/features";
import { thinkingStyleRouter } from "./thinking-styles";
import { biasCheck } from "./bias-check";
import { mem, analystPerspective } from "./cognition";
import { inputSchema } from "../shared/schemas";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../../lib/models";

// Auto-titles the session from its first turn. Internal generator — runs on
// the catalog default model, not the user's selection.
const autoTitle = utility.sessionTitleGenerator({
  name: "auto-title",
  model: DEFAULT_KITCHEN_SINK_MODEL,
});

export const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(applyFeatures)
  // FIX-421: up-front skill router. Decides activeSkills before the
  // generator runs; results land on `session.state.activeSkills` for
  // the skills capability's active-skill formatter to render.
  .tap(skillActivatorBlock)
  .tap(resolveThinkingStyle)
  .step(thinkingStyleRouter)
  .work(biasCheck)
  .workIf(
    // Skip capture when the assistant produced no text (e.g. a turn that
    // ended in a tool call only). The perspective system already no-ops on
    // empty content, but gating here avoids dispatching a background block
    // we know has nothing to do.
    (response, ctx) =>
      ctx.session.state.mode === "ask" && response.length > 0,
    (response: string) => ({ content: response }),
    analystPerspective.capture,
  )
  .work(mem.captureFromItems)
  .work(autoTitle)

  .tap(incrementRequestCount);
