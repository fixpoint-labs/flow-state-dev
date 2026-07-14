/**
 * The `adoptThesis` action (FIX-760) — one click at report completion that turns
 * a finished analysis into the standing thesis for the position.
 *
 * Lives in the analysis flow because it reads that flow's session-scoped decision
 * snapshot + the trader memo; it writes the durable thesis into the user-scoped
 * `theses` collection (flowIsolation:false → the same cross-flow items the
 * portfolio flow's `saveThesis`/`deleteThesis` and the analysis seed use). The
 * collection is user-scoped, so the write is automatically the caller's household
 * — no explicit userId.
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
import { thesesCollection, thesisKey } from "../../portfolio/portfolio-resources";
import type { Tripwire } from "@/domain/portfolio/schema/thesis-schema";
import { decisionSnapshotResource } from "../decision-snapshot-resource";
import type { DecisionSnapshotState } from "../decision-snapshot-resource";
import { PHASE_3_MEMO_KEYS } from "../registry";
import { memosCollection } from "../resources";
import { sessionStateSchema } from "../state";

export const adoptThesis = handler({
  name: "adopt-thesis",
  // Derive-only v1 — no caller fields; the action reads the stored decision.
  inputSchema: z.object({}),
  outputSchema: z.object({ ticker: z.string() }),
  sessionStateSchema,
  resources: {
    decisionSnapshot: decisionSnapshotResource,
    memos: memosCollection,
    theses: thesesCollection,
  },
  execute: async (_input, ctx) => {
    // A stopped / in-progress run has no decision to adopt. An unwritten single
    // resource can surface as `{}`, so gate on the required `finalRating`.
    // `seedSession` resets the snapshot to null at the start of every run, so a
    // present `finalRating` means the CURRENT run committed a decision — never a
    // stale prior-run one.
    const snapshot = ctx.resources.decisionSnapshot.state as DecisionSnapshotState | null;
    if (snapshot == null || typeof snapshot.finalRating !== "string") {
      throw new Error("no-decision: cannot adopt a thesis before the run produces a decision.");
    }
    // Defense in depth: the snapshot's ticker must match the session's current
    // ticker. The seed reset already prevents a stale cross-ticker snapshot; this
    // guard makes a mismatch fail loudly rather than silently adopt the wrong name.
    if (snapshot.ticker.toUpperCase() !== ctx.session.state.ticker.toUpperCase()) {
      throw new Error(
        `stale-decision: snapshot ticker ${snapshot.ticker} does not match the session ticker ${ctx.session.state.ticker}.`,
      );
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

    const ticker = snapshot.ticker.trim().toUpperCase();
    const key = thesisKey(ticker);
    const existing = await ctx.resources.theses.getOptional(key);
    const now = new Date().toISOString();
    await ctx.resources.theses.upsert(key, {
      ticker,
      entryRationale,
      invalidationConditions,
      tripwires,
      // The snapshot's holdingPeriod enum is a subset of the thesis horizon.
      timeHorizon: snapshot.holdingPeriod,
      targetPrice: snapshot.targetPrice,
      stopPrice: snapshot.stopPrice,
      // Capture the originating report automatically (the FIX-763 read).
      sourceSessionId: ctx.session.identity.id,
      createdAt: existing?.state.createdAt ?? now,
      updatedAt: now,
    });
    return { ticker };
  },
});
