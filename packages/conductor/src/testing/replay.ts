/**
 * The replay harness — a canned sequence of signals driven through `decide`
 * against a fixture world, with a stub dispatcher standing in for layer 3.
 *
 * This is what makes the process iterable. A change to a phase, a gate, or a
 * brief is exercised against the *whole* issue lifecycle in milliseconds, and
 * the assertion is the sequence of actions and dispatches — the same thing a
 * real run would produce, minus the issue, the PR, and the twenty minutes.
 *
 * It is a faithful miniature of the tick, not a simplification of it. Three
 * behaviours it reproduces on purpose, because leaving any of them out would
 * make the fast loop agree with a system that does not exist:
 *
 * - **`enterPhase` is followed by `phase_entered`.** Entering a phase is what
 *   dispatches that phase's entry work; a harness that just moved the phase
 *   would silently drop every `draftSpec` and `implement`.
 * - **A settled dispatch feeds its signal back in.** That is how a failed
 *   dispatch reaches the escalation `decide` has for it.
 * - **A step that leaves the work owing a proof derives the signal that asks for
 *   one.** Re-proving is driven by the *state* rather than by an event
 *   (`runtime/tick`'s `proofGap`), so a harness that only replayed scripted
 *   signals would show an approved, unproved PR sitting still — which is the
 *   defect the derivation exists to remove, reproduced in the fast loop.
 * - **The world is re-materialized per step.** Gates are predicates over a
 *   snapshot, so a step supplies the snapshot as it stood when that signal
 *   arrived, exactly as the tick's read-world step would.
 */

import { decide } from "../driver/decide";
import {
  deriveGate,
  outstandingProof,
  type ConductorEntity,
} from "../driver/derive-gate";
import { isDispatch, MUTATES_WORK, type Action } from "../model/actions";
import type { Gate, Phase } from "../model/phases";
import type { Signal, SignalKind } from "../model/signals";
import type { World } from "../model/world";
import { branchNameFor, worktreePath } from "../dispatch/branch";
import { briefFor } from "../dispatch/brief";
import type { DispatchResult, Dispatcher, PhaseBrief } from "../dispatch/types";
import { fakeDispatcher } from "./fake";

/** One tick of the script: a world as it then stood, and the signal that arrived. */
export interface ReplayStep {
  readonly signal: Signal;
  /**
   * The world materialized for this tick, either whole or as a patch on the
   * previous one. Omit when nothing about the world changed.
   */
  readonly world?: World | ((previous: World) => World);
}

export interface ReplayScript {
  /** The entity as it stands before the first signal. */
  readonly entity: ConductorEntity;
  /** The world before the first step. */
  readonly world: World;
  readonly steps: readonly ReplayStep[];
  /** Layer 3 stand-in. Defaults to a fresh {@link fakeDispatcher}. */
  readonly dispatcher?: Dispatcher;
  /** Repo root used to derive worktree paths for briefs. Default `"/repo"`. */
  readonly repoRoot?: string;
  /** Guidance paths stamped onto every brief. */
  readonly guidancePaths?: readonly string[];
  /** Work-item summary stamped onto every brief. */
  readonly summary?: string;
}

/** What one reduction did. The harness's equivalent of a ledger entry. */
export interface ReplayRecord {
  readonly signal: SignalKind;
  /** True when the signal was produced by the harness rather than by the script. */
  readonly derived: boolean;
  readonly phaseBefore: Phase;
  /** The gate the entity was on when the signal arrived. */
  readonly gate: Gate | null;
  readonly actions: readonly Action[];
  readonly phaseAfter: Phase;
}

export interface ReplayResult {
  /** The entity after the last signal — principally, the phase it ended in. */
  readonly entity: ConductorEntity;
  readonly records: readonly ReplayRecord[];
  /** Every action produced, flattened in order. */
  readonly actions: readonly Action[];
  /** Every brief handed to the dispatcher, in order. */
  readonly dispatches: readonly PhaseBrief[];
  readonly results: readonly DispatchResult[];
}

function nextWorld(step: ReplayStep, previous: World): World {
  if (step.world === undefined) return previous;
  return typeof step.world === "function" ? step.world(previous) : step.world;
}

/**
 * Run a script and report what the driver did.
 *
 * @returns The final entity, one record per reduction, and the dispatcher traffic.
 */
export async function replay(script: ReplayScript): Promise<ReplayResult> {
  const dispatcher = script.dispatcher ?? fakeDispatcher();
  const repoRoot = script.repoRoot ?? "/repo";

  let entity = script.entity;
  let world = script.world;

  const records: ReplayRecord[] = [];
  /** Phases a human has already been asked about. */
  const escalated = new Set<Phase>();
  const actions: Action[] = [];
  const dispatches: PhaseBrief[] = [];
  const results: DispatchResult[] = [];

  for (const step of script.steps) {
    world = nextWorld(step, world);

    // Signals the harness itself produces (`phase_entered`, and a dispatch
    // settling) drain in the same pass, ahead of the next scripted signal —
    // which is the ordering a real tick's queue gives them.
    const queue: { signal: Signal; derived: boolean }[] = [
      { signal: step.signal, derived: false },
    ];

    /** Work bought in this step, which may already have moved the code. */
    let boughtWork = false;
    /** Derived once per step, when the queue first empties — as the tick does. */
    let proofChecked = false;

    for (;;) {
      if (queue.length === 0 && !proofChecked) {
        proofChecked = true;
        const gap =
          boughtWork || escalated.has(entity.phase)
            ? null
            : outstandingProof(entity, world);
        if (gap !== null) {
          queue.push({
            signal: { kind: gap, entityId: entity.id, at: step.signal.at },
            derived: true,
          });
        }
      }
      const next = queue.shift();
      if (!next) break;
      const { signal, derived } = next;

      const phaseBefore = entity.phase;
      const gate = deriveGate(entity, world);
      const produced = decide(entity, signal, world);
      actions.push(...produced);

      for (const action of produced) {
        // An outstanding ask is something to wait for, so it converges the
        // derived proof signal exactly as it does in the tick.
        if (action.kind === "escalate") escalated.add(entity.phase);
        if (action.kind === "enterPhase") {
          entity = { ...entity, phase: action.phase };
          queue.push({
            signal: { kind: "phase_entered", entityId: entity.id, at: signal.at },
            derived: true,
          });
          continue;
        }
        if (!isDispatch(action)) continue;
        if (MUTATES_WORK[action.kind]) boughtWork = true;

        const branch = branchNameFor(entity);
        const brief = briefFor(entity, action, {
          dispatchId: `${entity.id}#${dispatches.length + 1}`,
          branch,
          workspacePath:
            dispatcher.isolation === "remote"
              ? null
              : dispatcher.isolation === "cwd"
                ? repoRoot
                : worktreePath(repoRoot, entity.id),
          guidancePaths: script.guidancePaths,
          summary: script.summary,
        });
        dispatches.push(brief);

        const result = await dispatcher.run(brief);
        results.push(result);
        queue.push({
          signal: {
            kind: result.outcome === "completed" ? "dispatch_completed" : "dispatch_failed",
            entityId: entity.id,
            at: signal.at,
            dispatchId: brief.dispatchId,
            // Carried for the same reason the tick carries it: an escalation
            // names the cause, so a replay that dropped it would produce a
            // different transition from the runtime it stands in for.
            detail: result.error,
          },
          derived: true,
        });
      }

      records.push({
        signal: signal.kind,
        derived,
        phaseBefore,
        gate,
        actions: produced,
        phaseAfter: entity.phase,
      });
    }
  }

  return { entity, records, actions, dispatches, results };
}
