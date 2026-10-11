/**
 * Where a person's line can go (V6; BR-18): the door a session's own flow
 * publishes. A pure read of the snapshot, so each case is staged exactly.
 */
import { describe, expect, it } from "vitest";
import { doorOf } from "../src/lib/derive";
import type { Seat } from "../src/lib/reads";

const seat = (id: string, door: string | null = "message", kind = "coder"): Seat => ({
  id,
  kind,
  door,
  team: id.split(".")[0]!,
  name: id.split(".")[1]!,
});

const seats = [seat("eng.coder"), seat("eng.em", null, "em"), seat("ops.coder")];

describe("a session's door (BR-18)", () => {
  it("is the one the session's own flow publishes, or none", () => {
    expect(doorOf(seats, "coder")).toBe("message");
    expect(doorOf(seats, "em")).toBeNull();
    // A flow no seat runs on, and a worker's id, which names no flow.
    expect(doorOf(seats, "reviewer")).toBeNull();
    expect(doorOf(seats, "eng.coder")).toBeNull();
  });
});
