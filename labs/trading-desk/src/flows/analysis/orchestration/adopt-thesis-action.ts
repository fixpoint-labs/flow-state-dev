/**
 * The `adoptThesis` action (FIX-760) — one click at report completion that turns
 * a finished analysis into the standing thesis for the position.
 *
 * Lives in the analysis flow because it reads that flow's session-scoped decision
 * snapshot + the trader memo; it writes the durable thesis through the SHARED
 * portfolio repository (`getRepository()` is not flow-scoped — `seedSession`
 * already reads it). The complementary hand-edit path is `saveThesis` /
 * `deleteThesis` in the portfolio flow.
 *
 * v1 is DERIVE-ONLY (approved scope): the thesis fields are mapped server-side
 * from the stored decision — never trusted from the client — capturing the
 * `sourceSessionId` link automatically. The user edits afterward via the
 * portfolio UI (`saveThesis`). A run with no completed decision (stopped /
 * in-progress) has nothing to adopt, so the action throws; the UI only offers the
 * button on a finished report (`runComplete`).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import type { Tripwire } from "../../portfolio/thesis-schema";
import { decisionSnapshotResource } from "../decision-snapshot-resource";
import type { DecisionSnapshotState } from "../decision-snapshot-resource";
import { PHASE_3_MEMO_KEYS } from "../registry";
import { memosCollection } from "../resources";
import { sessionStateSchema } from "../state";

/** The caller's resolved household key (the `portfolio-actions.ts` helper). */
function userId(ctx: { request: { identity: { userId?: string } } }): string {
  return ctx.request.identity.userId ?? "unknown_user";
}

export const adoptThesis = handler({
  name: "adopt-thesis",
  // Derive-only v1 — no caller fields; the action reads the stored decision.
  inputSchema: z.object({}),
  outputSchema: z.object({ ticker: z.string() }),
  sessionStateSchema,
  resources: {
    decisionSnapshot: decisionSnapshotResource,
    memos: memosCollection,
  },
  execute: async (_input, ctx) => {
    // A stopped / in-progress run has no decision to adopt. An unwritten single
    // resource can surface as `{}`, so gate on the required `finalRating`.
    const snapshot = ctx.resources.decisionSnapshot.state as DecisionSnapshotState | null;
    if (snapshot == null || typeof snapshot.finalRating !== "string") {
      throw new Error("no-decision: cannot adopt a thesis before the run produces a decision.");
    }

    // Invalidation conditions come from the trader memo's typed
    // `invalidationCriteria` — an ARRAY of short strings (see the trader output
    // schema). The thesis stores invalidation as freeform text, so join the
    // array into a bullet list; absent / empty → null.
    const traderMemo = await ctx.resources.memos.getOptional(
      PHASE_3_MEMO_KEYS.trader.collectionKey,
    );
    const criteria = (
      traderMemo?.state as { invalidationCriteria?: string[] | null } | undefined
    )?.invalidationCriteria;
    const invalidationConditions =
      Array.isArray(criteria) && criteria.length > 0
        ? criteria.map((c) => `- ${c}`).join("\n")
        : null;

    // A price tripwire from the stop level gives FIX-763's deterministic check a
    // machine-readable falsifier out of the box; the user adds richer tripwires
    // later via the editor.
    const tripwires: Tripwire[] =
      snapshot.stopPrice != null
        ? [{ kind: "price", note: "Price through the stop level", level: snapshot.stopPrice, byDate: null }]
        : [];

    const entryRationale = [
      `Adopted from the ${snapshot.finalRating} decision on ${snapshot.ticker} (${snapshot.asOfDate}).`,
      snapshot.decisionSummary,
    ]
      .filter((s) => s != null && s !== "")
      .join(" ");

    const repo = await getRepository();
    const saved = await repo.upsertThesis({
      userId: userId(ctx),
      ticker: snapshot.ticker.trim().toUpperCase(),
      entryRationale,
      invalidationConditions,
      tripwires,
      // The snapshot's holdingPeriod enum is a subset of the thesis horizon.
      timeHorizon: snapshot.holdingPeriod,
      targetPrice: snapshot.targetPrice,
      stopPrice: snapshot.stopPrice,
      // Capture the originating report automatically (the FIX-763 read).
      sourceSessionId: ctx.session.identity.id,
    });
    return { ticker: saved.ticker };
  },
});
