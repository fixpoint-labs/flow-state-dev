/**
 * One dispatch id, two implementations.
 *
 * `formatScheduleId` is canonical, and the shared tick (`runScheduleTick`,
 * which the Vercel tick runs) dispatches by it. The BullMQ worker keeps its
 * own copy: this package is an optional peer of it. That copy is a
 * dependency-free module, imported here by path, so a change to one that the
 * other does not share fails this test instead of a dispatch.
 */
import { describe, expect, it } from "vitest";
import { defaultParseScheduleId, formatScheduleId } from "../src";
import { dynamicScheduleId as bullmqScheduleId } from "../../bullmq/src/schedule-id";

const tricky: Array<[string, string, string]> = [
  ["acme", "alice", "daily"],
  ["Acme/EU", "u/1", "nested/key"],
  ["100%", "a%2Fb", "k%"],
  ["Ünïcødé", "é", "日本"],
  ["a:b", "c\\d", "x:y"],
  ["__fsd_default_org__", "auth0|abc", "k?#&= +"],
];

describe("the dispatch id contract", () => {
  it.each(tricky)("formats (%j, %j, %j) the same in both, and parses back", (orgId, userId, key) => {
    const canonical = formatScheduleId(orgId, userId, key);
    expect(bullmqScheduleId(orgId, userId, key)).toBe(canonical);
    expect(defaultParseScheduleId(canonical)).toEqual({ orgId, userId, collectionKey: key });
  });
});
