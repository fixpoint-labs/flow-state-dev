import { describe, expect, it } from "vitest";
import { decideReply, parseAddress } from "../src/policy";

describe("parseAddress", () => {
  it("reads the first @name token", () => {
    expect(parseAddress("hey @alice can you look")).toBe("alice");
    expect(parseAddress("@bob")).toBe("bob");
    expect(parseAddress("no mention here")).toBeUndefined();
  });
});

describe("decideReply — wake is not a turn", () => {
  it("stays quiet on an unaddressed post (default)", () => {
    expect(
      decideReply({ subscriberId: "alice", addressedTo: undefined })
    ).toEqual({ action: "quiet", reason: "unaddressed" });
  });

  it("lets only the addressed subscriber attempt a claim", () => {
    expect(
      decideReply({ subscriberId: "alice", addressedTo: "alice" })
    ).toEqual({ action: "claim", reason: "addressed-to-me" });
    expect(
      decideReply({ subscriberId: "bob", addressedTo: "alice" })
    ).toEqual({ action: "quiet", reason: "not-addressed-to-me" });
  });

  it("opens a claim on an unaddressed post that needs a reply", () => {
    expect(
      decideReply({
        subscriberId: "alice",
        addressedTo: undefined,
        needsReply: true,
      })
    ).toEqual({ action: "claim", reason: "open-claim" });
  });
});
