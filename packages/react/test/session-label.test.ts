/**
 * What a session line reads when nothing names it better (FIX-2875): its
 * title, else its flow's label, else its id shortened. A derived id (`wks_…`,
 * `dsx_…`) is a hash with no time in it, and shortens like a minted one.
 */
import { describe, expect, it } from "vitest";
import { sessionLabel } from "../src/components/flow-navigator/session-row";

describe("sessionLabel", () => {
  it("reads the title first, then the flow's label", () => {
    expect(sessionLabel({ id: "wks_9b744c6dbc4e", title: "Plan the launch", label: "Amy" })).toBe("Plan the launch");
    expect(sessionLabel({ id: "wks_9b744c6dbc4e", title: " ", label: "Amy" })).toBe("Amy");
  });

  it("shortens a minted id and a derived one to prefix and tail", () => {
    expect(sessionLabel({ id: "sess_1763800000000_7c1a2b3df102" })).toBe("sess_…3df102");
    expect(sessionLabel({ id: "dsx_82668ab49c0d1e2f3a4b" })).toBe("dsx_…2f3a4b");
  });

  it("reads any other id whole", () => {
    expect(sessionLabel({ id: "conversation-amy" })).toBe("conversation-amy");
  });
});
