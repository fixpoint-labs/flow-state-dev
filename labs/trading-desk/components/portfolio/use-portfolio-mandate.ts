"use client";

import { useCallback } from "react";
import { useResource, type SessionView } from "@flow-state-dev/react";
import type { PortfolioMandate } from "@/domain/portfolio/schema/portfolio-mandate-schema";
import type { MandateSavePayload } from "./mandate-form";

/**
 * Read + write the durable household portfolio mandate (FIX-761) from the
 * user-scoped `portfolioMandate` resource.
 *
 * A mandate is an FSD single resource (`client: { exclude: [], live: true }`), so
 * the read is `useResource` and a `savePortfolioMandate` / `clearPortfolioMandate`
 * mutation streams back as a `resource_change` — the summary chip + editor update
 * with no manual refetch (the `use-theses` live-read precedent).
 *
 * PRESENCE is a required field, not `!= null`: the engine normalizes an
 * absent/cleared single resource to `{}`, so a bare null check would read an empty
 * object as a present mandate. `mandate` is the record only when it carries a
 * `createdAt`; otherwise null (mandate-blind, exactly as before any was set).
 *
 * The writes are flow actions (a reactive cross-flow resource), so they need a
 * bound session — the caller gates the affordance on a session existing.
 */
export function usePortfolioMandate(session: SessionView): {
  mandate: PortfolioMandate | null;
  /** False until the session snapshot (and thus the mandate projection) has
   *  loaded. `clientData: null` means "no mandate" only once ready — before that
   *  it is indistinguishable from a not-yet-loaded read, so the editor must stay
   *  non-destructive (else an existing IPS could be overwritten by a blank save
   *  during the cold-start window). */
  ready: boolean;
  saveMandate: (payload: MandateSavePayload) => Promise<void>;
  clearMandate: () => Promise<void>;
} {
  const { clientData } = useResource<PortfolioMandate | null>(session, "portfolioMandate");
  // The snapshot arrives as one payload; its presence means the user-scope
  // resource projection (this mandate) has loaded. Until then, treat the read as
  // not-ready rather than "absent".
  const ready = session.snapshot != null;
  const mandate =
    clientData != null && typeof (clientData as PortfolioMandate).createdAt === "string"
      ? (clientData as PortfolioMandate)
      : null;

  const saveMandate = useCallback(
    async (payload: MandateSavePayload) => {
      try {
        await session.sendAction("savePortfolioMandate", payload);
      } catch (err) {
        console.error("[trading-desk] savePortfolioMandate failed", err);
      }
    },
    [session],
  );

  const clearMandate = useCallback(async () => {
    try {
      await session.sendAction("clearPortfolioMandate", {});
    } catch (err) {
      console.error("[trading-desk] clearPortfolioMandate failed", err);
    }
  }, [session]);

  return { mandate, ready, saveMandate, clearMandate };
}
