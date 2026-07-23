/**
 * Per-execution memoization of the delegation build (FIX-928).
 *
 * `createSkillsLibrary`'s tool/guidance resolvers are async functions the
 * generator re-resolves before EVERY step of the tool loop. Materializing
 * every bound agent into a board worker (and rebuilding the roster string)
 * on every step is wasted work when the resolved source list hasn't
 * changed. This module memoizes that build per execution; the actual build
 * (`buildTools`/`buildGuidance`) stays in `delegation-surface.ts` — that's
 * the surface's concern, this is purely the caching concern.
 *
 * Keying: the memo is keyed on the generator's execution `BlockContext` — a
 * single object closed over by the tools/guidance resolvers and reused
 * across every step of one execution, and freshly created per execution
 * (see `core/src/blocks/generator.ts` prepareStep). Keying on it gives
 * per-execution memoization that GCs with the execution and never leaks
 * across executions — NOT `DelegationSurfaceDeps`, which is per-binding-config
 * and shared across executions.
 *
 * Cache validity: `collectAgentSources` (the surface's per-step eligibility
 * walk, including its live-manifest disable read) runs on every call — this
 * module never skips it. Its OUTPUT is projected into a `SourceSnapshot`
 * (structural identity: which skills are live, each `$ARGUMENTS` input, each
 * agent-key set — NOT each agent's full spec body) and only the expensive
 * downstream build (board workers, task tools, roster string) is rebuilt
 * when that snapshot changes. A mid-turn skill disable shrinks the snapshot
 * and busts the cache; a same-key edit to an existing agent's body under an
 * unchanged key does not (accepted staleness, FIX-928 §6 decision 2). Both
 * the tools resolver and the guidance resolver call `resolveDelegationBuild`,
 * so the roster is walked and built once per snapshot and shared between
 * them (D1).
 */
import { deepEqual } from "@flow-state-dev/core/helpers";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  buildGuidance,
  buildTools,
  collectAgentSources,
  type DelegationAgentSource,
  type DelegationSurfaceDeps,
} from "../delegation-surface";

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
export function snapshotSources(sources: DelegationAgentSource[]): SourceSnapshot {
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
 * Resolve (and memoize) the delegation build for this execution step. The
 * per-step eligibility walk (`collectAgentSources`, including its
 * live-manifest disable read) runs every call — matching `binding-reader.ts`'s
 * deliberate never-memoize policy on the same activation store — and its
 * OUTPUT is snapshotted. The expensive downstream build (the
 * `materializeWorker` loop, the task tools, the board, the `runBoard`
 * sequencer, and the roster string) is rebuilt only when that snapshot
 * changes.
 */
export async function resolveDelegationBuild(
  ctx: BlockContext,
  deps: DelegationSurfaceDeps,
): Promise<{ tools: GeneratorTool[]; guidance: string | null }> {
  const sources = await collectAgentSources(ctx, deps); // per-step eligibility (unchanged)
  const snapshot = snapshotSources(sources);
  const cached = delegationMemo.get(ctx as object);
  if (cached && deepEqual(cached.snapshot, snapshot)) {
    return { tools: cached.tools, guidance: cached.guidance };
  }
  const tools = sources.length === 0 ? [] : await buildTools(ctx, deps, sources);
  const guidance = buildGuidance(sources);
  delegationMemo.set(ctx as object, { snapshot, tools, guidance });
  return { tools, guidance };
}
