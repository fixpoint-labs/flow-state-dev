/**
 * Blinding for the LLM-judge layer (FIX-790).
 *
 * A judge must not see run PROVENANCE — the session id, the wall-clock
 * timestamps, or capture paths — so its score can't latch onto identity instead
 * of substance (self-preference / provenance bias, spec §4.5). `blindBundle`
 * deep-strips those fields from a `RunArtifactsBundle` and returns a plain object
 * the rubric slices serialize.
 *
 * What stays: the persona ROLE labels (`agentName` — `bullResearcher`, etc.),
 * every memo body / typed field, the computed valuation + reward-to-risk +
 * mandate records, and the subject ticker/date the judge needs to weigh
 * evidence. What goes: `sessionId`, all ISO timestamps, capture paths, snapshot
 * as-of. Length-neutrality is instructed in the rubric preamble, not here.
 */
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";

/** Keys stripped everywhere they appear — session id, provenance timestamps,
 *  capture paths. These are identity, never substance. */
const STRIP_KEYS = new Set<string>([
  "sessionId",
  "ranAt",
  "evaluatedAt",
  "capturePath",
  "decidedAt",
  "startedAt",
  "completedAt",
  "snapshotAsOf",
]);

/** A JSON-safe value with the strip keys removed at every depth. */
export type Blinded = unknown;

function stripIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdentity);
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = stripIdentity(v);
    }
    return out;
  }
  return value;
}

/** The blinded shape the rubric dimensions read. */
export type BlindedBundle = {
  status: string;
  ticker: unknown;
  date: unknown;
  costPreset: unknown;
  finalRating: unknown;
  decisionConfidence: unknown;
  decision: unknown;
  valuationSpine: unknown;
  rewardToRisk: unknown;
  riskMandate: unknown;
  citationIntegrity: unknown;
  transcript: Array<{ round: number; agentName: string; text: string }> | null;
  memos: Array<{ key: string; state: unknown }>;
};

/**
 * Produce the blinded judge input for a run. Deep-strips identity/timestamp
 * fields and keeps only the substrate the rubrics grade.
 */
export function blindBundle(bundle: RunArtifactsBundle): BlindedBundle {
  return {
    status: bundle.summary.status,
    ticker: bundle.summary.ticker,
    date: bundle.summary.date,
    costPreset: bundle.summary.costPreset,
    finalRating: bundle.summary.finalRating,
    decisionConfidence: bundle.summary.decisionConfidence,
    decision: stripIdentity(bundle.decisionSnapshot),
    valuationSpine: stripIdentity(bundle.valuationSpine),
    rewardToRisk: stripIdentity(bundle.rewardToRisk),
    riskMandate: stripIdentity(bundle.riskMandate),
    citationIntegrity: stripIdentity(bundle.citationIntegrity),
    // The debate transcript keeps its persona role labels (bull/bear); those are
    // roles the debate-engagement rubric needs, not provenance.
    transcript: bundle.p2Contributions?.entries ?? null,
    memos: bundle.memos.map((m) => ({ key: m.key, state: stripIdentity(m.state) })),
  };
}

/** The memos in a blinded bundle whose key starts with a prefix (e.g. `p1/`). */
export function blindedMemosByPrefix(
  blinded: BlindedBundle,
  prefix: string,
): Array<{ key: string; state: unknown }> {
  return blinded.memos.filter((m) => m.key.startsWith(prefix) && m.state != null);
}

/** One blinded memo by its exact collection key. */
export function blindedMemo(blinded: BlindedBundle, key: string): unknown {
  return blinded.memos.find((m) => m.key === key)?.state ?? null;
}
