/**
 * In-memory harness state for a single `fsdev chat` run: which target is driving,
 * one engine session id per flow kind, and the turn counter. Pure — no I/O.
 */
import type { FlowActionTarget } from "./targets";

export interface HarnessState {
  /** The target free text routes to, or undefined when nothing is bound. */
  defaultTarget: FlowActionTarget | undefined;
  /**
   * One session id per flow kind within this run. Engine session records aren't
   * flow-bound (history loads by session id alone), so sharing one id across
   * `/use` switches would bleed flow A's history into flow B's context — keep
   * them separate.
   */
  sessions: Map<string, string>;
  /** Number of turns dispatched (successful or not) this run. */
  turns: number;
}

/** Fresh, unbound harness state. */
export function createHarnessState(): HarnessState {
  return { defaultTarget: undefined, sessions: new Map(), turns: 0 };
}

/** Mint a stable engine session id — the same `sess_…` shape `fsdev run` uses. */
export function newSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Bind `target` as the default and ensure its flow kind has a stable session id,
 * minting one on first use. Seeding here — not at turn time — guarantees a turn
 * never runs under an engine-minted `ephemeral_…` id (which would not persist
 * history across turns). Returns the active session id and whether it was freshly
 * minted (vs resumed from an earlier `/use` of the same flow).
 */
export function bindTarget(
  state: HarnessState,
  target: FlowActionTarget,
): { sessionId: string; fresh: boolean } {
  state.defaultTarget = target;
  const existing = state.sessions.get(target.flowKind);
  if (existing !== undefined) return { sessionId: existing, fresh: false };
  const sessionId = newSessionId();
  state.sessions.set(target.flowKind, sessionId);
  return { sessionId, fresh: true };
}

/** The session id the active target's flow is bound to, if any. */
export function activeSessionId(state: HarnessState): string | undefined {
  if (state.defaultTarget === undefined) return undefined;
  return state.sessions.get(state.defaultTarget.flowKind);
}
