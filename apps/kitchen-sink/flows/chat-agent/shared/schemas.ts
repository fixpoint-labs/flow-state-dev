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
  coalesceKitchenSinkModel,
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
// One set, not two. `thinkingStyleSchema` is what a caller may request, what
// the router dispatches on, and what's stored on session state.
//
// It used to be two sets: an input superset carrying `"auto"`, which ran a
// keyword + LLM classifier to pick one of five in-request coordination
// routes. Those routes and the classifier were removed (FIX-1478) — with one
// answering style left besides the durable hand-off, `"auto"` could only ever
// resolve to `"default"`, after paying for a model call to get there.
// ---------------------------------------------------------------------------

/** The thinking styles the router can dispatch. */
export const RESOLVED_THINKING_STYLES = [
  // Files the turn's message as background work and returns without answering
  // it: the work outlives the reply, and the result arrives on a later turn.
  "background-work",
  "default",
] as const;

export const thinkingStyleSchema = z.enum(RESOLVED_THINKING_STYLES);

export type ThinkingStyle = z.infer<typeof thinkingStyleSchema>;

/**
 * Caller-requested style on action input. The same set as the resolved
 * styles, defaulted — a caller that names a style this app no longer has is
 * refused here rather than coalesced, because an input is a live claim
 * (BP-031). A *stored* style is the other case; see
 * {@link coalesceThinkingStyle}.
 */
export const thinkingStyleInputSchema = thinkingStyleSchema.default("default");

export type ThinkingStyleInput = ThinkingStyle;

/**
 * Fold a persisted thinking style to one this app still has an option for.
 *
 * The mirror image of {@link thinkingStyleInputSchema}: history is tolerated
 * where a live claim is refused (BP-030). A session written before FIX-1478
 * holds a style name that no longer exists, and nothing parses session state
 * on load — the engine adopts the stored record with a bare cast — so the one
 * place that value is read raw is the `modeStatus` client-data projection in
 * `flow.ts`. It is folded there, before it leaves the server, so the browser
 * never sees a style it has no entry for.
 *
 * Unlike {@link persistedSelectedModelSchema} this coalesces rather than
 * throws on a non-string: it runs on every session read, and a corrupt value
 * should not make an old conversation unopenable.
 *
 * Returns `null` for an absent value, which is what a session that has never
 * run a turn holds.
 */
export function coalesceThinkingStyle(value: unknown): ThinkingStyle | null {
  if (value == null) return null;
  return thinkingStyleSchema.safeParse(value).success
    ? (value as ThinkingStyle)
    : "default";
}

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

/**
 * User-state field for `selectedModel`. Coalesces stale persisted ids before
 * enum validation so explicit parses (and any future load-time validation)
 * match generator read-time behavior. Writes still go through
 * {@link selectedModelSchema} on `setSelectedModel`.
 */
export const persistedSelectedModelSchema = z.preprocess(
  (value) =>
    typeof value === "string" || value == null
      ? coalesceKitchenSinkModel(value)
      : value,
  z.enum(KITCHEN_SINK_MODELS),
);

/** Per-user state: display name, selected model, extended-thinking toggle. */
export const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  selectedModel: persistedSelectedModelSchema.default(DEFAULT_KITCHEN_SINK_MODEL),
  thinkingEnabled: z.boolean().default(false),
});
