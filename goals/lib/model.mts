/**
 * Model ids for goal checks — one convention, written down.
 *
 * The corpus had spelled the same model five ways: `openai/gpt-5.4-mini`,
 * `vercel/openai/gpt-5.4-mini`, `process.env.GOAL_MODEL ?? …`,
 * `process.env.FSDEV_DEFAULT_MODEL ?? …`, and bare literals repeated inline.
 * The `vercel/` prefix is load-bearing — it routes through the Vercel AI
 * Gateway — but that was documented nowhere.
 *
 * The rule:
 *   - {@link DEFAULT_MODEL} — the PORTABLE id. Use it when the model is
 *     resolved by an app's configured resolver, which applies its own gateway.
 *   - {@link gatewayModel} — the GATEWAY-QUALIFIED id. Use it when the goal
 *     builds its own `createModelResolver({ gateways: { vercel } })` and must
 *     name the gateway itself.
 *   - {@link goalModel} — either of the above, overridable per-run via
 *     `GOAL_MODEL` so a different gateway's naming can be substituted without
 *     editing the goal.
 *
 * A goal that needs a SPECIFIC model to reproduce a bug (structured-output
 * pins GLM 5.2) names it literally and says why — those are not defaults.
 */

/** The default cheap model for a model-backed goal, in portable form. */
export const DEFAULT_MODEL = "openai/gpt-5.4-mini";

/** The gateway this repo's containers resolve. */
export const DEFAULT_GATEWAY = "vercel";

/**
 * Qualify a portable model id with a gateway prefix, for goals that construct
 * their own resolver. Already-qualified ids pass through unchanged.
 */
export function gatewayModel(id: string = DEFAULT_MODEL, gateway = DEFAULT_GATEWAY): string {
  return id.startsWith(`${gateway}/`) ? id : `${gateway}/${id}`;
}

/**
 * The model this run should use: `GOAL_MODEL` if set, else `fallback`. Lets a
 * run target a differently-named gateway without editing the goal.
 */
export function goalModel(fallback: string = DEFAULT_MODEL): string {
  return process.env.GOAL_MODEL ?? fallback;
}

/**
 * How many times to retry a model-flakiness-tolerant goal. Model judgment is
 * probabilistic; a goal that retries is retrying the MODEL's call, never the
 * mechanism under test. Override per-run with `GOAL_ATTEMPTS`.
 */
export function goalAttempts(fallback = 3): number {
  const parsed = Number(process.env.GOAL_ATTEMPTS ?? fallback);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}
