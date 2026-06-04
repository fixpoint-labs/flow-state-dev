/**
 * `createApproachGenerator` — in-flow factory for "approach preamble"
 * generators in Phases 3–5.
 *
 * Each silent structured-output agent (trader, the three Phase 4
 * personas, the Phase 4 risk-assessment consolidator, and the Phase 5
 * portfolio manager) gets a short fast-model free-text preamble before
 * its structured generator. The preamble streams as a `message` item in
 * the transcript so the user sees the agent's plan in plain English
 * seconds before the typed memo lands. Display-only: its string output
 * is not consumed by the structured generator.
 *
 * The factory consolidates the ~80% boilerplate shared across all six
 * preambles. Hardcoded policy:
 *   - `itemVisibility: { client: true, history: false }` — produces a
 *     streaming `message` item, no `TxStruct` card (the structured
 *     generator emits its own card when
 *     `itemVisibility: { client: true, history: true }`).
 *   - `model: "intent/utility"` — always-fast regardless of the user's
 *     `costPreset`. Block-level `model:` takes precedence over the
 *     `tradingDesk` capability's `intent/${costPreset}` resolution.
 *   - No `outputSchema` — defaults to `z.string()`, which streams as a
 *     `message` item.
 *   - A single user-instruction template ("explain how you will
 *     approach writing the <artifact>").
 *
 * Call sites supply only what varies: `name`, `agentName`,
 * `artifactName`, `prompt`, `uses`. If a future preamble needs a
 * different model tier or template, extend this factory deliberately
 * rather than diverging silently — there is no `userOverride` escape
 * hatch by design.
 *
 * This is example-local on purpose. Single consumer today; promotion
 * to `@flow-state-dev/patterns` waits for a second consumer.
 */
import { generator, type DefinedCapability } from "@flow-state-dev/core";
import type { BrandedPromptSlot } from "@flow-state-dev/core/prompt-file";
import type { AgentName } from "../../agents";
import { sessionStateSchema } from "../../state";

export interface ApproachGeneratorConfig {
  /** Generator ID. Must be unique across the flow. */
  name: string;
  /** Agent identity. Must be a key of `AGENTS` so the transcript
   *  renders the speak row with the agent's badge/role/hue. */
  agentName: AgentName;
  /** The noun the user instruction names — e.g. `"TradeProposal"` or
   *  `"Aggressive Risk critique"`. Substituted into the user template. */
  artifactName: string;
  /** System prompt — per-agent personality / stance / framing. A plain string
   *  or a PromptFile-sourced prompt (`loadPrompt(...).prompt`). */
  prompt: string | BrandedPromptSlot;
  /** Capability presets supplying the per-agent context the preview
   *  should reference. Lean by design: only the inputs the preamble
   *  needs to know exist, not the full data depth the structured
   *  generator reads. */
  uses: readonly DefinedCapability[];
}

/**
 * Build an "approach preamble" generator: a fast-model, free-text
 * streaming step that previews how the agent intends to approach its
 * upcoming structured memo. See module doc-comment for the policy
 * fields hardcoded here vs. supplied by the call site.
 */
export function createApproachGenerator(config: ApproachGeneratorConfig) {
  return generator({
    name: config.name,
    itemVisibility: { client: true, history: false },
    agentName: config.agentName,
    model: "intent/utility",
    uses: config.uses,
    sessionStateSchema,
    prompt: config.prompt,
    user: `In one or two sentences, plain English, explain how you will approach writing the ${config.artifactName}. Don't commit to specifics — describe your method.`,
  });
}
