/**
 * Per-execution memoization of the delegation build (FIX-928).
 *
 * `createSkillsLibrary`'s tool/guidance resolvers are async functions the
 * generator re-resolves before EVERY step of the tool loop. Materializing
 * every bound agent into a board worker (and rebuilding the roster string)
 * on every step is wasted work when the resolved source list hasn't
 * changed. This module memoizes that build per execution.
 *
 * This is a LEAF module — it has no knowledge of `delegation-surface.ts`.
 * It owns only "when to rebuild" (the `WeakMap`, the snapshot compare); the
 * actual build (`buildTools`/`buildGuidance`, materializing board workers)
 * is the surface's concern and is passed in as the `build` callback, the
 * same way `seeding.ts`'s `ensureSeeded(obj, seedFn)` takes its work as a
 * parameter rather than importing it.
 *
 * Keying: the memo is keyed on the generator's execution `BlockContext` — a
 * single object closed over by the tools/guidance resolvers and reused
 * across every step of one execution, and freshly created per execution
 * (see `core/src/blocks/generator.ts` prepareStep). Keying on it gives
 * per-execution memoization that GCs with the execution and never leaks
 * across executions — NOT the surface's binding config, which is
 * per-binding and shared across executions.
 *
 * Cache validity: callers are expected to re-walk eligibility (the
 * live-manifest disable read, in `delegation-surface.ts`'s
 * `collectAgentSources`) on every call and pass the freshly resolved
 * `sources` in — this module never skips that walk itself. The sources are
 * projected into a `SourceSnapshot` (structural identity: which skills are
 * live, each `$ARGUMENTS` input, each agent-key set — NOT each agent's full
 * spec body) and the `build` callback is only invoked when that snapshot
 * changes. A mid-turn skill disable shrinks the snapshot and busts the
 * cache; a same-key edit to an existing agent's body under an unchanged key
 * does not (accepted staleness, FIX-928 §6 decision 2).
 */
import { deepEqual } from "@flow-state-dev/core/helpers";
import type { GeneratorTool } from "@flow-state-dev/core";

/** The minimal shape `snapshotSources` needs — structurally compatible with
 *  `delegation-surface.ts`'s `DelegationAgentSource` without importing it. */
interface SnapshotSourceLike {
  skillName: string;
  input?: string;
  agents: Record<string, unknown>;
}

/**
 * Structural projection of the resolved source list — the memo key. Captures
 * source IDENTITY (which skills are live, each `$ARGUMENTS` input, each
 * agent-key set), NOT each agent's full spec body. That draws the accepted-
 * staleness line: a mid-turn edit to an existing agent's body under an
 * unchanged key on a live skill is not observed until identity changes
 * (FIX-928, §6 decision 2).
 */
type SourceSnapshot = Array<{
  skill: string;
  input: string | undefined;
  agentKeys: string[];
}>;

/** Canonical, order-independent projection compared with `deepEqual`. */
export function snapshotSources(sources: readonly SnapshotSourceLike[]): SourceSnapshot {
  return sources
    .map((s) => ({
      skill: s.skillName,
      input: s.input,
      agentKeys: Object.keys(s.agents).sort(),
    }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

interface DelegationMemoEntry {
  /** Snapshot of the resolved source list this build was keyed on. */
  snapshot: SourceSnapshot;
  tools: GeneratorTool[];
  /** Roster text, or null when the roster contributes nothing. */
  guidance: string | null;
}

/**
 * Per-execution, module-scoped memo. See the file header for keying and
 * cache-validity rules.
 */
const delegationMemo = new WeakMap<object, DelegationMemoEntry>();

/**
 * Resolve (and memoize) the delegation build for this execution step, given
 * the caller's freshly resolved `sources`. When `sources` projects to the
 * same `SourceSnapshot` as the cached entry, the cached result is returned
 * without invoking `build`. Otherwise `build` runs exactly once and its result
 * is cached under the new snapshot.
 *
 * `build` runs for EVERY changed snapshot, including an empty one — this module
 * has no opinion about what an empty roster means, which is the surface's call.
 *
 * The standing caution: `build` is invoked when the snapshot changes and on no
 * other schedule, so anything needing a DIFFERENT schedule does not belong
 * inside the closure. The surface's rejected-agent-key warning is keyed on its
 * own identity for exactly that reason — a roster can gain an illegal key while
 * filtering to a byte-identical snapshot here.
 */
export async function resolveDelegationBuild(
  ctx: object,
  sources: readonly SnapshotSourceLike[],
  build: () => Promise<{ tools: GeneratorTool[]; guidance: string | null }>,
): Promise<{ tools: GeneratorTool[]; guidance: string | null }> {
  const snapshot = snapshotSources(sources);
  const cached = delegationMemo.get(ctx);
  if (cached && deepEqual(cached.snapshot, snapshot)) {
    return { tools: cached.tools, guidance: cached.guidance };
  }
  const result = await build();
  delegationMemo.set(ctx, { snapshot, tools: result.tools, guidance: result.guidance });
  return result;
}
