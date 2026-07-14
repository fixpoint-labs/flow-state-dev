/**
 * Tests for the holding asset-taxonomy schemas (FIX-773 Slice A).
 *
 * These pin the domain contract the persistence layer and (later) the importer /
 * valuation slices depend on: the per-type `attributes` discriminated union
 * accepts each well-formed instrument shape and REJECTS a malformed one — most
 * importantly a bare `{}`, which carries no `kind` discriminator and would throw
 * when `mapHolding` parses a backfilled row whose JSONB default was mis-set.
 */
import { describe, expect, it } from "vitest";
import { holdingAttributesSchema } from "@/domain/portfolio/schema/portfolio-schema";

describe("holdingAttributesSchema", () => {
  it("accepts a valid bond, option, cash_equivalent, and none shape", () => {
    expect(
      holdingAttributesSchema.safeParse({
        kind: "bond",
        cusip: "912828YK0",
        coupon: 4.25,
        maturity: "2030-05-15",
        yield: 4.1,
      }).success,
    ).toBe(true);
    expect(
      holdingAttributesSchema.safeParse({
        kind: "option",
        underlying: "AAPL",
        strike: 200,
        expiry: "2026-12-18",
        right: "call",
        multiplier: 100,
      }).success,
    ).toBe(true);
    expect(
      holdingAttributesSchema.safeParse({ kind: "cash_equivalent", yield: 5.1 }).success,
    ).toBe(true);
    expect(holdingAttributesSchema.safeParse({ kind: "none" }).success).toBe(true);
  });

  it("rejects a malformed shape with no discriminator or a missing required field", () => {
    // A bare {} has no `kind` — the exact value a mis-generated JSONB default
    // would carry, which must NOT parse (it would throw on every backfilled row).
    expect(holdingAttributesSchema.safeParse({}).success).toBe(false);
    // An option missing its required `underlying`/`strike`/`expiry`/`right`.
    expect(holdingAttributesSchema.safeParse({ kind: "option", strike: 5 }).success).toBe(false);
    // An unknown discriminator.
    expect(holdingAttributesSchema.safeParse({ kind: "future" }).success).toBe(false);
  });
});
