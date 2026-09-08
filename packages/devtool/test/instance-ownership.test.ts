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
  isConclusiveRefusal,
  isMigrationRequiredError,
  recordBelongsTo,
  suspensionOwnerId,
} from "../src/react/lib/instance-ownership";

const collectionMember = {
  id: "engineer-b",
  kind: "engineer",
  cardinality: "collection" as const,
};
const singleton = { id: "reports", kind: "reports", cardinality: "singleton" as const };

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

  it("refuses an attributed record whose two facts disagree", () => {
    // Reachable when an id is re-registered under a different kind: the record
    // still names `reports` as its owner, but the instance answering to that id
    // is now a different flow, and its sessions are not this one's to show.
    // The engine's `ownsRecord` refuses the same pair, and a presentation rule
    // that disagreed with the admission rule would display what the server
    // would then refuse to read.
    expect(
      recordBelongsTo({ flowId: "reports", flowKind: "engineer" }, singleton),
    ).toBe(false);
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

describe("isConclusiveRefusal", () => {
  const http = (status: number, body?: unknown) =>
    new ClientHttpError("refused", { status, body });

  // Only these may be acted on destructively — discarding a saved selection.
  it("treats a definite answer as conclusive", () => {
    expect(isConclusiveRefusal(http(404))).toBe(true);
    expect(isConclusiveRefusal(http(410))).toBe(true);
    expect(isConclusiveRefusal(http(403))).toBe(true);
    expect(
      isConclusiveRefusal(http(409, { error: "migration-required" })),
    ).toBe(true);
  });

  // A server that never rendered a verdict has not said the record is gone.
  // Throwing state away on one of these makes a blip permanent.
  it("treats a failure to answer as inconclusive", () => {
    expect(isConclusiveRefusal(http(500))).toBe(false);
    expect(isConclusiveRefusal(http(503))).toBe(false);
    expect(isConclusiveRefusal(new Error("network down"))).toBe(false);
    expect(isConclusiveRefusal(undefined)).toBe(false);
  });

  it("treats an expired credential as inconclusive", () => {
    // A token that can be refreshed is not the same answer as "not yours", and
    // a panel whose session lapsed must not delete every saved selection on the
    // way out.
    expect(isConclusiveRefusal(http(401))).toBe(false);
  });

  it("does not treat an unrelated 409 as conclusive", () => {
    expect(isConclusiveRefusal(http(409, { error: "lease-held" }))).toBe(false);
  });
});
