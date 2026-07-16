/**
 * Per-position thesis write actions (FIX-760) — `saveThesis`, `deleteThesis`.
 *
 * The portfolio-UI editing path. A thesis is a user-scoped resource collection
 * keyed `theses/{ticker}` (NOT a relational table — it is a flat household ×
 * ticker document with no relational needs), so these actions mutate the
 * `thesesCollection` resource. Being a resource gives the client a live read path
 * (`useResourceCollectionList`) with no bespoke route — `live: true` streams the
 * change back, so there is no manual refetch.
 *
 * Each is a SINGLE handler (BP-011-safe: a resource mutation is not a block
 * call), keyed at the household level (`userId` is the resource scope, resolved
 * from the caller identity — never trusted from the client). `saveThesis` returns
 * the ticker so the UI can re-read; the delete is state-mutation-only (BP-012, no
 * `return input` per BP-014). Tickers are canonicalized to trimmed upper-case so
 * the key matches the holdings rows.
 *
 * The complementary write path — `adoptThesis`, which DERIVES a thesis from a
 * finished analysis report — lives in the analysis flow (it reads that flow's
 * session-scoped decision snapshot) and writes the same cross-flow collection.
 *
 * No generator output schemas here — `thesisInputSchema` is a deterministic input
 * shape, so BP-016 has no surface (mirrors `portfolio-writes.ts`).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { thesesCollection, thesisKey } from "./portfolio-resources";
import { thesisInputSchema } from "@/domain/portfolio/schema/thesis-schema";

/**
 * Create or update the thesis for a held name. Overwrites in place on
 * `theses/{ticker}` — no revision history in v1; the originating analysis stays
 * preserved via the linked `sourceSessionId`. `createdAt` and `sourceSessionId`
 * are preserved across an edit that omits them (read from the existing item);
 * `updatedAt` is stamped now. Returns the canonical ticker.
 */
export const saveThesis = handler({
  name: "save-thesis",
  inputSchema: thesisInputSchema,
  outputSchema: z.object({ ticker: z.string() }),
  resources: { theses: thesesCollection },
  execute: async (input, ctx) => {
    const ticker = input.ticker.trim().toUpperCase();
    const key = thesisKey(ticker);
    const existing = await ctx.resources.theses.getOptional(key);
    const now = new Date().toISOString();
    await ctx.resources.theses.upsert(key, {
      ...input,
      ticker,
      // Preserve the originating-report link across an edit that omits it. The UI
      // carries it through, but a direct `saveThesis` caller defaults
      // `sourceSessionId` to null (schema default), and a bare spread would erase
      // an adopted thesis's provenance. Only `adoptThesis` sets it; a hand-edit
      // never clears it — so fall back to the existing value.
      sourceSessionId: input.sourceSessionId ?? existing?.state.sourceSessionId ?? null,
      createdAt: existing?.state.createdAt ?? now,
      updatedAt: now,
    });
    return { ticker };
  },
});

/**
 * Delete the household's thesis for one ticker. State-mutation-only (BP-012); a
 * no-op when absent (`delete` on a missing collection key is idempotent).
 */
export const deleteThesis = handler({
  name: "delete-thesis",
  inputSchema: z.object({ ticker: z.string() }),
  outputSchema: z.void(),
  resources: { theses: thesesCollection },
  execute: async (input, ctx) => {
    await ctx.resources.theses.delete(thesisKey(input.ticker));
  },
});
