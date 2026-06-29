/**
 * Per-position thesis write actions (FIX-760) — `saveThesis`, `deleteThesis`.
 *
 * The portfolio-UI editing path. Each is a SINGLE handler (BP-011-safe: it does
 * repository I/O, which a handler may do — that is not calling a block), keyed at
 * the household level (`userId` resolved from the caller identity, never trusted
 * from the client). `saveThesis` returns the ticker so the UI can re-read; the
 * delete is state-mutation-only and returns `void` (BP-012, no `return input`
 * per BP-014). Tickers are canonicalized to trimmed upper-case so the
 * household × ticker key matches the holdings rows (the `deleteHolding` /
 * `recordLedgerEvent` precedent).
 *
 * The complementary write path — `adoptThesis`, which DERIVES a thesis from a
 * finished analysis report — lives in the analysis flow (it reads that flow's
 * session-scoped decision snapshot). Both write through the same shared
 * repository.
 *
 * No generator output schemas here — `thesisInputSchema` is a deterministic input
 * shape, so BP-016 has no surface (mirrors `portfolio-actions.ts`).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import { thesisInputSchema } from "./thesis-schema";

/** The caller's resolved household key (the `portfolio-actions.ts` helper). */
function userId(ctx: { request: { identity: { userId?: string } } }): string {
  return ctx.request.identity.userId ?? "unknown_user";
}

/**
 * Create or update the thesis for a held name. Overwrites in place on
 * `(userId, ticker)` — no revision history in v1; the originating analysis stays
 * preserved via the linked `sourceSessionId`. Returns the canonical ticker.
 */
export const saveThesis = handler({
  name: "save-thesis",
  inputSchema: thesisInputSchema,
  outputSchema: z.object({ ticker: z.string() }),
  execute: async (input, ctx) => {
    const ticker = input.ticker.trim().toUpperCase();
    const repo = await getRepository();
    const saved = await repo.upsertThesis({ ...input, ticker, userId: userId(ctx) });
    return { ticker: saved.ticker };
  },
});

/**
 * Delete the household's thesis for one ticker. State-mutation-only (BP-012); a
 * no-op when absent or owned by another household (the repository scopes on
 * `userId`).
 */
export const deleteThesis = handler({
  name: "delete-thesis",
  inputSchema: z.object({ ticker: z.string() }),
  outputSchema: z.void(),
  execute: async (input, ctx) => {
    const repo = await getRepository();
    await repo.deleteThesis(userId(ctx), input.ticker.trim().toUpperCase());
  },
});
