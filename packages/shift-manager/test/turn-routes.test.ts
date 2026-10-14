/**
 * Where a user's line can go (V6; BR-18): the door a session's own flow
 * publishes. A pure read of the snapshot, so each case is staged exactly.
 */
import { describe, expect, it } from "vitest";
import { doorOf } from "../src/lib/derive";
import type { Worker } from "../src/lib/reads";

const worker = (id: string, door: string | null = "message", flow = "coder"): Worker => ({
  id,
  kind: flow,
  door,
  rules: false,
  team: id.split(".")[0]!,
  teamName: id.split(".")[0]!,
  name: id.split(".")[1]!,
  displayName: id,
});

const workers = [worker("eng.coder"), worker("eng.em", null, "em"), worker("ops.coder")];

describe("a session's door (BR-18)", () => {
  it("is the one the session's own flow publishes, or none", () => {
    expect(doorOf(workers, "coder")).toBe("message");
    expect(doorOf(workers, "em")).toBeNull();
    // A flow no worker runs on, and a worker's id, which names no flow.
    expect(doorOf(workers, "reviewer")).toBeNull();
    expect(doorOf(workers, "eng.coder")).toBeNull();
  });
});
