/**
 * chat-agent flow — the single schema contract.
 *
 * Every input/state/feature/thinking-style schema the flow uses lives here so
 * the dependency direction stays one-way: `run/` and the root actions import
 * from `shared/`, and `shared/` never imports back from them. Centralizing the
 * schemas means a block imports only the slices it needs without reaching into
 * another action's file.
 */
import { z } from "zod";
import {
  KITCHEN_SINK_MODELS,
  DEFAULT_KITCHEN_SINK_MODEL,
} from "../../../lib/models";

// ---------------------------------------------------------------------------
// Mode + features
// ---------------------------------------------------------------------------

/** The four assistant modes. Drives the system-prompt selection. */
export const modeSchema = z
  .enum(["ask", "build", "interview", "debate"])
  .default("ask");

/** Resolved mode value. */
export type Mode = z.infer<typeof modeSchema>;

/** Per-request feature toggles (bias check + web tool gates). */
export const featuresSchema = z.object({
  biasCheck: z.boolean().default(false),
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
  crawl: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Thinking styles
//
// `thinkingStyleSchema` is the set of resolved styles — what eventually runs in
// the router and what's stored on session state after Tier-1 / Tier-2
// classification.
//
// `thinkingStyleInputSchema` is the set of values a caller can request on the
// action input. It's a superset: the same resolved styles plus `"auto"`, which
// triggers the keyword + LLM classifier pipeline before the router dispatches.
// ---------------------------------------------------------------------------

/** Concrete, resolved thinking styles the router can dispatch. */
export const RESOLVED_THINKING_STYLES = [
  "plan-and-execute",
  "supervisor",
  "routed-specialists",
  "evented-actors",
  "moderated-debate",
  "default",
] as const;

export const thinkingStyleSchema = z.enum(RESOLVED_THINKING_STYLES);

export type ThinkingStyle = z.infer<typeof thinkingStyleSchema>;

/** Caller-requested styles on action input. Superset of resolved styles + `"auto"`. */
export const THINKING_STYLE_INPUTS = [
  "auto",
  ...RESOLVED_THINKING_STYLES,
] as const;

export const thinkingStyleInputSchema = z
  .enum(THINKING_STYLE_INPUTS)
  .default("default");

export type ThinkingStyleInput = z.infer<typeof thinkingStyleInputSchema>;

export const thinkingStyleSessionStateSchema = z.object({
  thinkingStyle: thinkingStyleSchema.optional(),
});

// ---------------------------------------------------------------------------
// Flow-level input + state
// ---------------------------------------------------------------------------

/** The `run` action's caller input. */
export const inputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema,
  thinkingStyle: thinkingStyleInputSchema,
  features: featuresSchema.default({}),
});

/** Session state owned by the chat turn. */
export const sessionStateSchema = z.object({
  mode: modeSchema,
  thinkingStyle: thinkingStyleSchema.optional(),
  requestCount: z.number().default(0),
  lastAction: z.string().optional(),
  features: featuresSchema.default({}),
});

/**
 * Schema for the kitchen-sink model selector input. Only models that appear
 * in the catalog are accepted by `setSelectedModel`.
 */
export const selectedModelSchema = z
  .enum(KITCHEN_SINK_MODELS)
  .default(DEFAULT_KITCHEN_SINK_MODEL);

/** Per-user state: display name, selected model, extended-thinking toggle. */
export const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  selectedModel: selectedModelSchema,
  thinkingEnabled: z.boolean().default(false),
});
