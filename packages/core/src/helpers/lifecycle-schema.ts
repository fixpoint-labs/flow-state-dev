/**
 * `lifecycleSchema` — a status-bearing field set for a streamed artifact's
 * resource state schema.
 *
 * A resource that wants a UI to render its lifecycle (`pending → active →
 * done`) needs a `status` field, plus timestamps and an error slot. This
 * helper produces that field set so callers spread it into their
 * `stateSchema` instead of restating the quad per resource. It pairs with
 * `client: { live: true }`: the status field is what the live projection
 * streams as it transitions.
 *
 * Per BP-023, the optional fields are `.nullable().default(null)` so callers
 * pass only the non-null scaffold (the `status`) and let the framework's
 * `safeParse` fill the rest. Timestamps are ISO strings, matching the
 * established resource-state precedent. This is a plain schema-fragment helper
 * (data, not a body-callback factory) per BP-024.
 *
 * It belongs on resource state schemas only — not on generator outputs, which
 * forbid `.default()` under BP-016.
 */
import { z } from "zod";

/**
 * Returns `{ status, startedAt, completedAt, errorMessage }` to spread into a
 * resource `stateSchema`. `status` is a required enum over the caller's
 * `statuses`; the timestamp/error fields are nullable ISO-string slots
 * defaulting to `null`.
 *
 * @example
 * stateSchema: z.object({
 *   ...lifecycleSchema(["pending", "writing", "published"]),
 *   title: z.string(),
 * })
 */
export function lifecycleSchema<const S extends readonly [string, ...string[]]>(
  statuses: S
) {
  return {
    status: z.enum(statuses),
    startedAt: z.string().nullable().default(null),
    completedAt: z.string().nullable().default(null),
    errorMessage: z.string().nullable().default(null),
  };
}
