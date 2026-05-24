/**
 * `defineMemoSetup` — per-phase factory for the `setupPhaseNMemos` handler.
 *
 * Every phase pre-creates its memo resources in `pending` so the navigator
 * can render the slots before any generator runs. The shape is identical
 * across phases — iterate the memo-key registry, parse a scaffold into
 * `memoStateSchema` (Zod fills nullable defaults), create or reset the
 * resource, then mirror the seed onto `session.memoStatus` and stamp
 * `activePhase`.
 *
 * Uses `memoHandler` (from `./memo-writer`) for the shared scaffolding —
 * setup is a memo-touching block like commits, so the same defaults apply.
 *
 * The memoStatus seed is derived from the keys registry so adding a new
 * memo to a phase doesn't require touching this file.
 */
import { z } from "zod";
import type { AgentName, AgentTeam } from "../agents";
import { memoStateSchema } from "../resources";
import type { SessionState } from "../state";
import { memoHandler } from "./memo-writer";

type KeyEntry = { agentName: AgentName; collectionKey: string };

export interface MemoSetupConfig<Keys extends Record<string, KeyEntry>> {
  /** Phase id stamped onto new memo scaffolds (e.g. `"p1"`). */
  phaseId: string;
  /** Agent team stamped onto every memo this setup creates. */
  agentTeam: AgentTeam;
  /** The phase's memo-key registry. */
  keys: Keys;
  /** Value patched into `session.activePhase` (`"phase-1"`, `"phase-2"`, …). */
  activePhase: SessionState["activePhase"];
}

/**
 * Build the phase's setup handler. On re-run with existing memo state,
 * `setState(initial)` replaces the memo entirely so prior `body` /
 * `headline` / etc. don't bleed through.
 */
export function defineMemoSetup<Keys extends Record<string, KeyEntry>>(
  config: MemoSetupConfig<Keys>,
) {
  const { phaseId, agentTeam, keys, activePhase } = config;
  return memoHandler({
    name: `setup-${phaseId}-memos`,
    inputSchema: z.any(),
    execute: async (_input, ctx) => {
      const { ticker, date } = ctx.session.state;
      for (const [, mapping] of Object.entries(keys)) {
        const initial = memoStateSchema.parse({
          status: "pending",
          agentName: mapping.agentName,
          agentTeam,
          phaseId,
          ticker,
          date,
        });
        const existing = ctx.resources.memos.getOptional(mapping.collectionKey);
        if (existing === undefined) {
          await ctx.resources.memos.create(mapping.collectionKey, initial);
        } else {
          await existing.setState(initial);
        }
      }
      const memoStatusSeed = Object.fromEntries(
        Object.keys(keys).map((shortName) => [shortName, "pending" as const]),
      );
      await ctx.session.patchState({
        activePhase,
        memoStatus: { ...ctx.session.state.memoStatus, ...memoStatusSeed },
      });
    },
  });
}
