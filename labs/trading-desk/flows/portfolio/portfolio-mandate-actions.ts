/**
 * Durable portfolio-mandate write actions (FIX-761) — `savePortfolioMandate`,
 * `clearPortfolioMandate`.
 *
 * The Portfolio-UI editing path for the household IPS. The mandate is a
 * user-scoped single resource (`portfolioMandateResource`, `flowIsolation:
 * false`), so these actions mutate that resource. Being a resource gives the
 * client a live read path (`useResource` + `resource_change`) with no bespoke
 * route — `live: true` streams the change back, so the editor + summary chip
 * update with no manual refetch (the `saveThesis` precedent).
 *
 * Each is a SINGLE handler (BP-011-safe: a resource mutation is not a block
 * call), keyed at the household level (`userId` is the resource scope, resolved
 * from the caller identity — never trusted from the client).
 *
 * **Validation-message channel.** `sendAction` resolves to a status envelope, not
 * handler output, so the action can't surface `{ ok, issues }` to the editor
 * post-dispatch. The editor therefore runs `validatePortfolioMandate` client-side
 * to show issues BEFORE dispatch (the `import-csv-dialog` live-preview
 * precedent), and the server action re-runs it as a THROWING trust-boundary
 * guard (never trusts the client, never persists invalid policy) — so the
 * action's return is `void`, not a readable issues bag.
 *
 * No generator output schemas here — the mandate schema is a deterministic input
 * shape, so BP-016 has no surface (the `thesis-actions.ts` precedent).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { portfolioMandateResource } from "./portfolio-resources";
import {
  portfolioMandateSchema,
  validatePortfolioMandate,
  type PortfolioMandate,
} from "@/domain/portfolio/schema/portfolio-mandate-schema";
import { resolveMandate } from "../analysis/lib/risk-mandate";

/** The user-suppliable mandate fields — the action owns the timestamps. */
const mandateInputSchema = portfolioMandateSchema.omit({ createdAt: true, updatedAt: true });

/**
 * Create or update the household's durable portfolio mandate. Overwrites in
 * place — no revision history in v1. `createdAt` is stamped on first write and
 * preserved on edit; `updatedAt` is bumped every write. Exclusions are
 * canonicalized to trimmed upper-case (deduped) so the hard exclusion gate's
 * exact match can't miss on `"nvda"` / `" NVDA "`.
 */
export const savePortfolioMandate = handler({
  name: "save-portfolio-mandate",
  inputSchema: mandateInputSchema,
  outputSchema: z.void(),
  resources: { portfolioMandate: portfolioMandateResource },
  execute: async (input, ctx) => {
    const exclusions = [
      ...new Set(
        input.constraints.exclusions
          .map((e) => e.trim().toUpperCase())
          .filter((e) => e.length > 0),
      ),
    ];
    const now = new Date().toISOString();
    const existing = ctx.resources.portfolioMandate.state as
      | PortfolioMandate
      | null
      | undefined;
    // Preserve the creation stamp across an edit (presence gate on a required
    // field, the null-boundary discipline: a cleared record reads back as `{}`).
    const createdAt = existing?.createdAt ?? now;
    const record: PortfolioMandate = {
      ...input,
      constraints: { ...input.constraints, exclusions },
      createdAt,
      updatedAt: now,
    };

    // SAVE-ONLY guard: an explicit but UNKNOWN `riskAppetite` id is a typo —
    // reject on a NEW write. Deliberately NOT in `validatePortfolioMandate`,
    // which seed re-runs on persisted records: a legacy record with a stale
    // appetite id must degrade ONLY the appetite to null (via `resolveMandate`),
    // never blank the whole IPS and drop still-valid constraints (§4.3).
    if (record.riskAppetite != null && resolveMandate(record.riskAppetite) == null) {
      throw new Error(`invalid-mandate: unknown riskAppetite id "${record.riskAppetite}"`);
    }

    // Trust-boundary guard: re-run business validation and THROW on any issue
    // (never persist invalid policy). The editor surfaces the specific issues
    // from its OWN client-side `validatePortfolioMandate` before dispatch — it
    // does not read them back from the action (the void/guard contract).
    const issues = validatePortfolioMandate(record);
    if (issues.length > 0) {
      throw new Error(`invalid-mandate: ${issues.join("; ")}`);
    }

    await ctx.resources.portfolioMandate.setState(record);
  },
});

/**
 * Clear the household's portfolio mandate — reset to null. State-mutation-only
 * (BP-012); no `return input` (BP-014). The run becomes mandate-blind, exactly
 * as before any mandate was set.
 */
export const clearPortfolioMandate = handler({
  name: "clear-portfolio-mandate",
  inputSchema: z.object({}),
  outputSchema: z.void(),
  resources: { portfolioMandate: portfolioMandateResource },
  execute: async (_input, ctx) => {
    await ctx.resources.portfolioMandate.setState(null);
  },
});
