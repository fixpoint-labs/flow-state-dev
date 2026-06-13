/**
 * Mode dispatcher for the tool catalog. Every data tool's `execute` funnels
 * through `resolveToolPayload`, the single place the three `dataSource`
 * modes branch: fixture replays the corpus, live runs the provider chain
 * behind the shared TTL cache, and record runs the live path then persists
 * the consumer-visible payload back into the corpus. Tool files keep only
 * their provider-chain closures; mode logic lives here.
 */
import { getOrFetch } from "./cache";
import { loadFixture } from "./fixtures";
import { recordFixture } from "./recorder";
import { pickMode, type ToolInput, type ToolName, type ToolOutput } from "../schemas";

/**
 * Single dispatch point for the three dataSource modes. Fixture: load from
 * corpus. Live: provider chain behind the shared cache. Record: live path,
 * then persist the consumer-visible payload to the corpus before returning.
 *
 * `args` is the tool's full input and flows unchanged into `getOrFetch` so
 * cache keys keep their fidelity (e.g. `range` on price history); the
 * recorder reads only `ticker`/`date` from it. The record decision is
 * per-call via `ctx` — no module-level mode state, so concurrent sessions
 * with mixed modes never cross-contaminate. A record-mode cache hit still
 * records (rewrites identical bytes — idempotent), and a recorder failure
 * propagates: an unrecorded payload is a failed run, not a warning.
 */
export async function resolveToolPayload<T extends ToolName>(
  tool: T,
  args: ToolInput<T>,
  ctx: { session: { state: Record<string, unknown> } },
  fetchLive: () => Promise<ToolOutput<T>>,
): Promise<ToolOutput<T>> {
  const mode = pickMode(ctx);
  if (mode === "fixture") return loadFixture(tool, args);
  const payload = await getOrFetch(tool, args, fetchLive);
  if (mode === "record") await recordFixture(tool, args, payload);
  return payload;
}
