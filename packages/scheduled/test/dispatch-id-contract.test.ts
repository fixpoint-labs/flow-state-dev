/**
 * One dispatch id, three implementations.
 *
 * `formatScheduleId` is canonical. The Vercel tick and the BullMQ worker keep
 * their own copy: this package is an optional peer of both, and the Vercel
 * schedules module has no runtime imports. Each copy is a dependency-free
 * module, imported here by path, so a change to one that the others do not
 * share fails this test instead of a dispatch.
 */
import { describe, expect, it } from "vitest";
import { defaultParseScheduleId, formatScheduleId } from "../src";
import { dynamicScheduleId as vercelScheduleId } from "../../vercel/src/schedule-id";
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
  it.each(tricky)("formats (%j, %j, %j) the same in all three, and parses back", (orgId, userId, key) => {
    const canonical = formatScheduleId(orgId, userId, key);
    expect(vercelScheduleId(orgId, userId, key)).toBe(canonical);
    expect(bullmqScheduleId(orgId, userId, key)).toBe(canonical);
    expect(defaultParseScheduleId(canonical)).toEqual({ orgId, userId, collectionKey: key });
  });
});
