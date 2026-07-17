// Inbox collection unit specs (FIX-882, sequence step 1): record-schema
// parse/reject cases, the kind-first key shape, and the key ↔ path round-trip.

import { describe, expect, it } from "vitest";
import {
  INBOX_PREFIX,
  inboxIdFromPath,
  inboxKey,
  inboxRecordSchema,
} from "../src/inbox";

describe("inboxRecordSchema", () => {
  const valid = {
    kind: "task",
    content: "Book dentist appointment",
    context: "Planning the week",
    contextId: "ctx_abc123",
    capturedAt: "2026-07-10T00:00:00.000Z",
    fingerprint: "abc123",
  };

  it("parses a minimal record and defaults the nullable/lifecycle fields", () => {
    const parsed = inboxRecordSchema.parse(valid);
    expect(parsed.occurredAt).toBeNull();
    expect(parsed.source).toBeNull();
    expect(parsed.status).toBe("pending");
  });

  it("rejects an unknown kind", () => {
    expect(() => inboxRecordSchema.parse({ ...valid, kind: "reminder" })).toThrow();
  });

  it("rejects a missing required field", () => {
    const { context: _omit, ...withoutContext } = valid;
    expect(() => inboxRecordSchema.parse(withoutContext)).toThrow();
  });
});

describe("inboxKey", () => {
  it("is kind-first so a per-kind list can filter at the source", () => {
    expect(inboxKey("task", "deadbeef")).toBe("task/deadbeef");
  });
});

describe("inboxIdFromPath", () => {
  it("strips the injected inbox/ prefix to recover the bare key", () => {
    const key = inboxKey("goal", "cafef00d");
    expect(inboxIdFromPath(`${INBOX_PREFIX}/${key}`)).toBe(key);
  });

  it("returns a bare (already-stripped) key unchanged", () => {
    const key = inboxKey("decision", "0ff1ce");
    expect(inboxIdFromPath(key)).toBe(key);
  });
});
