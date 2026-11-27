/**
 * One dispatch id, written in core and read here.
 *
 * Core's `formatScheduleId` is what the engine's schedule tick dispatches
 * by; this package's `defaultParseScheduleId` is what the endpoint reads it
 * back with. A change to one that the other does not share fails this test
 * instead of a dispatch.
 */
import { describe, expect, it } from "vitest";
import { formatScheduleId } from "@flow-state-dev/core/types";
import { defaultParseScheduleId } from "../src";

const tricky: Array<[string, string, string]> = [
  ["acme", "alice", "daily"],
  ["Acme/EU", "u/1", "nested/key"],
  ["100%", "a%2Fb", "k%"],
  ["Ünïcødé", "é", "日本"],
  ["a:b", "c\\d", "x:y"],
  ["__fsd_default_org__", "auth0|abc", "k?#&= +"],
];

describe("the dispatch id contract", () => {
  it.each(tricky)("formats (%j, %j, %j) and parses back", (orgId, userId, key) => {
    expect(defaultParseScheduleId(formatScheduleId(orgId, userId, key))).toEqual({ orgId, userId, collectionKey: key });
  });
});
