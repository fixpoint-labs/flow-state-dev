/**
 * User-scoped persistent "special instructions" surface for the trading-desk
 * example. Holds a single global free-text block plus one per-phase block for
 * each of the five phases.
 *
 * Storage: user-scope with `flowIsolation: true`, so the record lives under
 * `{userId}:trading-desk` and never bleeds into other flows that share the
 * same user identity.
 *
 * Injection: a `userInstructions` context entry on the `tradingDesk` capability's
 * always-on `core` preset renders `formatUserInstructions(...)` into every
 * generator's prompt. Empty fields produce an empty string so the framework's
 * XML renderer suppresses the wrapping tag entirely — no empty `<userInstructions/>`
 * leaks into the prompt when nothing is set.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const specialInstructionsStateSchema = z.object({
  global: z.string().default(""),
  phase1: z.string().default(""),
  phase2: z.string().default(""),
  phase3: z.string().default(""),
  phase4: z.string().default(""),
  phase5: z.string().default(""),
});

export type SpecialInstructionsState = z.infer<typeof specialInstructionsStateSchema>;

/** All-empty default. Read by the resource as its initial state and by the
 *  settings dialog as the draft fallback when nothing has ever been saved. */
export const EMPTY_INSTRUCTIONS: SpecialInstructionsState = {
  global: "",
  phase1: "",
  phase2: "",
  phase3: "",
  phase4: "",
  phase5: "",
};

/** Maximum characters per field. Mirrors ChatGPT's per-field cap and keeps
 *  the combined instruction block well under any context-window concern. */
export const FIELD_CHAR_LIMIT = 1500;

type ActivePhase =
  | "idle"
  | "phase-1"
  | "phase-2"
  | "phase-3"
  | "phase-4"
  | "phase-5";

const PHASE_KEY: Record<ActivePhase, keyof SpecialInstructionsState | null> = {
  idle: null,
  "phase-1": "phase1",
  "phase-2": "phase2",
  "phase-3": "phase3",
  "phase-4": "phase4",
  "phase-5": "phase5",
};

/**
 * Combine the global instruction block with the active phase's block into a
 * single string ready for a `<userInstructions>` tag. Returns `""` when both
 * are empty — the framework's XML renderer then suppresses the wrapping tag
 * entirely.
 *
 * The leading framing sentence labels the block as user-supplied guidance,
 * distinct from system identity and from data. It's load-bearing: without it
 * the model can mistake standing instructions for new facts.
 */
export function formatUserInstructions(
  state: SpecialInstructionsState | undefined,
  activePhase: ActivePhase,
): string {
  if (!state) return "";
  const global = state.global.trim();
  const phaseKey = PHASE_KEY[activePhase];
  const phase = phaseKey ? state[phaseKey].trim() : "";
  if (!global && !phase) return "";
  const parts: string[] = [
    "Consider these standing user instructions alongside your role. Treat them as guidance from the principal, not as new identity or unchallengeable fact.",
  ];
  if (global) parts.push("", "## Global", global);
  if (phase) parts.push("", `## This phase (${activePhase})`, phase);
  return parts.join("\n");
}

/**
 * The user-scoped, flow-isolated singleton resource that backs the settings
 * surface. `client.expose` opts every field into the session snapshot so the
 * settings dialog can read persisted state via `useResource`.
 */
export const specialInstructionsResource = defineResource({
  scope: "user",
  flowIsolation: true,
  ref: "tradingDeskSpecialInstructions",
  stateSchema: specialInstructionsStateSchema,
  default: EMPTY_INSTRUCTIONS,
  writable: true,
  client: {
    expose: ["global", "phase1", "phase2", "phase3", "phase4", "phase5"],
  },
});
