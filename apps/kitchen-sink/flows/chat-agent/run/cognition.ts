/**
 * Cognition subsystems for the chat turn — cross-turn memory and the analyst
 * perspective.
 *
 * `mem` is the unified memory system (working / episodic / semantic / digest);
 * its `capability` is installed on the assistant + pattern generators, its
 * `captureFromItems` runs as a background `.work()` after each turn, and its
 * `userResources` register on the flow. `analystPerspective` contributes
 * perspective framing to every mode but only accumulates state in ask mode
 * (capture is gated in run.ts).
 */
import { system as memorySystem } from "@flow-state-dev/memory";
import { perspective, system as perspectiveSystem } from "@thought-fabric/core/identity";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../../lib/models";

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export const mem = memorySystem({
  model: DEFAULT_KITCHEN_SINK_MODEL,
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
  // Enables the rolling-summary digest tier. Without this the unified
  // memory formatter has nothing to render in the system prompt's
  // <memory> section once working memory drifts past capacity. The digest
  // refreshes after consolidation/prune actually mutate the semantic store
  // (see `withDigestRegenerate`), not on every turn.
  digest: true,
});

// ---------------------------------------------------------------------------
// Perspective (ask mode only)
// ---------------------------------------------------------------------------

const analyst = perspective({
  name: "analyst-perspective",
  description: "Analytical reasoning partner who decomposes problems and evaluates tradeoffs",
  salience: {
    amplify: ["assumptions", "tradeoffs", "edge cases", "constraints", "contradictions"],
    suppress: ["pleasantries", "filler", "hedging language"],
  },
  reasoning: {
    priorities: ["identify unstated assumptions", "surface tradeoffs", "check for missing constraints"],
    riskModel: "What could go wrong if we act on incomplete information?",
  },
  expertise: ["problem decomposition", "tradeoff analysis", "critical thinking"],
  communicationStyle: {
    tone: "direct and specific",
    emphasis: "answer first, then reasoning",
  },
});

export const analystPerspective = perspectiveSystem(analyst, { model: DEFAULT_KITCHEN_SINK_MODEL });
