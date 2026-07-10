// Pure mailroom specs (FIX-882, behaviour 9): normalization idempotence and
// fingerprint sensitivity to every element of the capture tuple. These are the
// deterministic guarantees the capture path leans on — no store, no model.

import { describe, expect, it } from "vitest";
import { computeFingerprint, normalizeForFingerprint } from "../src/mailroom";

const base = {
  kind: "task",
  content: "Book dentist appointment",
  context: "Planning the week in a Claude conversation",
  occurredAt: null,
  source: null,
} as const;

describe("normalizeForFingerprint", () => {
  it("lowercases, collapses whitespace, and trims", () => {
    expect(normalizeForFingerprint("  Book   the\tDentist\nAppointment  ")).toBe(
      "book the dentist appointment"
    );
  });

  it("is idempotent — normalizing an already-normalized string is a no-op", () => {
    const once = normalizeForFingerprint("  Mixed   CASE  and\tspacing ");
    expect(normalizeForFingerprint(once)).toBe(once);
  });
});

describe("computeFingerprint", () => {
  it("is stable for an identical tuple", () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base }));
  });

  it("ignores whitespace/case differences the normalizer collapses", () => {
    expect(computeFingerprint({ ...base, content: "  book   DENTIST appointment " }))
      .toBe(computeFingerprint({ ...base, content: "Book Dentist Appointment" }));
  });

  it("changes when the kind differs", () => {
    expect(computeFingerprint({ ...base, kind: "memory" })).not.toBe(computeFingerprint(base));
  });

  it("changes when the content differs", () => {
    expect(computeFingerprint({ ...base, content: "Book doctor appointment" })).not.toBe(
      computeFingerprint(base)
    );
  });

  it("changes when the context differs", () => {
    expect(computeFingerprint({ ...base, context: "A different conversation" })).not.toBe(
      computeFingerprint(base)
    );
  });

  it("changes when occurredAt differs", () => {
    expect(computeFingerprint({ ...base, occurredAt: "2026-07-01T00:00:00Z" })).not.toBe(
      computeFingerprint(base)
    );
  });

  it("changes when source differs", () => {
    expect(computeFingerprint({ ...base, source: "Claude Desktop" })).not.toBe(
      computeFingerprint(base)
    );
  });
});
