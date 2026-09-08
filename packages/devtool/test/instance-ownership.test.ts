/**
 * The rule the instance navigator rests on: may this record be shown under this
 * copy?
 *
 * The asymmetry between an attributed record and one written before ownership
 * existed is the whole point, so it is pinned directly rather than only through
 * the surfaces that consume it.
 */
import { describe, it, expect } from "vitest";
import { ClientHttpError } from "@flow-state-dev/client";
import {
  describeReadError,
  isMigrationRequiredError,
  recordBelongsTo,
  suspensionOwnerId,
} from "../src/react/lib/instance-ownership";

const collectionMember = { id: "engineer-b", cardinality: "collection" as const };
const singleton = { id: "reports", cardinality: "singleton" as const };

describe("recordBelongsTo", () => {
  it("matches an attributed record to its exact owner", () => {
    expect(
      recordBelongsTo({ flowId: "engineer-b", flowKind: "engineer" }, collectionMember),
    ).toBe(true);
  });

  it("refuses a peer of the same kind", () => {
    // The defect in one line: `engineer` is both copies' kind, so a kind
    // comparison would say yes here.
    expect(
      recordBelongsTo({ flowId: "engineer-a", flowKind: "engineer" }, collectionMember),
    ).toBe(false);
  });

  it("never lets a collection member claim an unattributed record", () => {
    // Any peer of that kind could be the real owner, so claiming it is a guess.
    // The server refuses such a read for the same reason.
    expect(recordBelongsTo({ flowKind: "engineer" }, collectionMember)).toBe(false);
  });

  it("lets a singleton claim an unattributed record of its own kind", () => {
    // A singleton has exactly one possible owner, so nothing is guessed — and
    // this is what keeps a single-copy app's sessions visible.
    expect(recordBelongsTo({ flowKind: "reports" }, singleton)).toBe(true);
  });

  it("refuses an unattributed record of another kind", () => {
    expect(recordBelongsTo({ flowKind: "billing" }, singleton)).toBe(false);
  });

  it("ignores kind entirely once a record is attributed", () => {
    // An id may deliberately equal some other flow's kind. The owner field is
    // the answer; the kind is not consulted.
    expect(
      recordBelongsTo({ flowId: "reports", flowKind: "engineer" }, singleton),
    ).toBe(true);
  });
});

describe("suspensionOwnerId", () => {
  it("uses the record's owner when it has one", () => {
    expect(suspensionOwnerId({ flowId: "engineer-b", flowKind: "engineer" })).toBe(
      "engineer-b",
    );
  });

  it("falls back to the kind for a record from before owners were recorded", () => {
    expect(suspensionOwnerId({ flowKind: "reports" })).toBe("reports");
  });
});

describe("unattributable history", () => {
  const refusal = new ClientHttpError("conflict", {
    status: 409,
    body: { error: "migration-required" },
  });

  it("recognises the server's refusal", () => {
    expect(isMigrationRequiredError(refusal)).toBe(true);
  });

  it("does not mistake another conflict for it", () => {
    expect(
      isMigrationRequiredError(
        new ClientHttpError("conflict", { status: 409, body: { error: "lease-held" } }),
      ),
    ).toBe(false);
    expect(isMigrationRequiredError(new Error("network down"))).toBe(false);
  });

  it("explains what has to happen instead of surfacing a status code", () => {
    // Nothing the operator can do in the panel fixes this, so the message has
    // to name what actually will.
    const message = describeReadError(refusal, "Failed to fetch requests");
    expect(message).toMatch(/predates flow instance ownership/i);
    expect(message).not.toMatch(/409/);
  });

  it("keeps the caller's own wording for an ordinary failure", () => {
    expect(describeReadError(new Error("network down"), "Failed to fetch requests")).toBe(
      "network down",
    );
    expect(describeReadError("not an error", "Failed to fetch requests")).toBe(
      "Failed to fetch requests",
    );
  });
});
