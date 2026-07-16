/**
 * Fresh-start rollout gate (FIX-895, §0 D6 / §7). The deploy migrator must refuse
 * to bring up the unconditional `|lk|ck|` fingerprint against un-wiped legacy data,
 * and pass on a fresh or post-wipe ledger. This pins the gate's decision logic.
 */
import { describe, expect, it } from "vitest";
import { assertFreshStartRollout } from "@/db/fresh-start-gate";

describe("assertFreshStartRollout (FIX-895 rollout gate)", () => {
  it("passes a genuinely fresh deploy (empty ledger, no marker)", () => {
    expect(() => assertFreshStartRollout(0, false)).not.toThrow();
  });

  it("passes a post-wipe ledger (rows present, marker stamped)", () => {
    expect(() => assertFreshStartRollout(42, true)).not.toThrow();
  });

  it("REFUSES an un-wiped legacy ledger (rows present, marker absent)", () => {
    expect(() => assertFreshStartRollout(42, false)).toThrow(/un-wiped ledger/);
    expect(() => assertFreshStartRollout(42, false)).toThrow(/ledger-reset/);
  });

  it("passes an empty ledger even with the marker already present (idempotent re-deploy)", () => {
    expect(() => assertFreshStartRollout(0, true)).not.toThrow();
  });
});
