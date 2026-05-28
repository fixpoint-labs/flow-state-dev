/**
 * User-scoped "special instructions" — schema, defaults, and prompt formatter.
 *
 * This file is intentionally framework-import-free so it can be imported from
 * client components (`app/page.tsx`, `components/settings-dialog.tsx`) without
 * pulling `@flow-state-dev/core`'s root barrel — which transitively reaches
 * Node-only model resolvers — into the browser bundle. The matching
 * `defineResource` lives next door in `./special-instructions-resource`.
 *
 * Injection: a `userInstructions` context entry on the `tradingDesk`
 * capability's always-on `core` preset renders `formatUserInstructions(...)`
 * into every generator's prompt. Empty fields produce an empty string so the
 * framework's XML renderer suppresses the wrapping tag entirely — no empty
 * `<userInstructions/>` leaks into the prompt when nothing is set.
 */
import { z } from "zod";

/** Maximum characters per field. Mirrors ChatGPT's per-field cap and keeps
 *  the combined instruction block well under any context-window concern.
 *  Enforced server-side in the schema below and on the textarea via
 *  `maxLength`, so callers that bypass the UI (direct API, test harness,
 *  programmatic `sendAction`) still can't inject unbounded text into every
 *  generator's prompt. */
export const FIELD_CHAR_LIMIT = 1500;

export const specialInstructionsStateSchema = z.object({
  global: z.string().max(FIELD_CHAR_LIMIT).default(""),
  phase1: z.string().max(FIELD_CHAR_LIMIT).default(""),
  phase2: z.string().max(FIELD_CHAR_LIMIT).default(""),
  phase3: z.string().max(FIELD_CHAR_LIMIT).default(""),
  phase4: z.string().max(FIELD_CHAR_LIMIT).default(""),
  phase5: z.string().max(FIELD_CHAR_LIMIT).default(""),
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
