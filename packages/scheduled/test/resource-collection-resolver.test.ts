import { describe, it, expect } from "vitest";
import {
  createResourceCollectionScheduleResolver,
  defaultParseScheduleId,
  defaultFormatScheduleId
} from "../src";
import type { ScheduleResolutionContext } from "@flow-state-dev/core/types";

function buildCtx(
  records: Map<string, string>
): ScheduleResolutionContext {
  return {
    flowKind: "reminders",
    gatewayPrincipal: { userId: "system" },
    request: new Request("https://example.com/dispatch"),
    stores: {
      content: {
        async get(scopeType, scopeId, resourceKey) {
          return records.get(`${scopeType}:${scopeId}:${resourceKey}`);
        }
      }
    }
  };
}

describe("defaultParseScheduleId", () => {
  it("splits on the first slash", () => {
    expect(defaultParseScheduleId("u_1/weekly-digest")).toEqual({
      userId: "u_1",
      collectionKey: "weekly-digest"
    });
  });

  it("returns null when there is no slash", () => {
    expect(defaultParseScheduleId("monolith")).toBeNull();
  });

  it("returns null on a leading slash", () => {
    expect(defaultParseScheduleId("/weekly-digest")).toBeNull();
  });

  it("returns null on a trailing slash", () => {
    expect(defaultParseScheduleId("u_1/")).toBeNull();
  });

  it("preserves additional slashes in the collection key", () => {
    expect(defaultParseScheduleId("u_1/nested/key/path")).toEqual({
      userId: "u_1",
      collectionKey: "nested/key/path"
    });
  });
});

describe("defaultFormatScheduleId", () => {
  it("round-trips the parsed shape", () => {
    const id = defaultFormatScheduleId({ userId: "u_1", collectionKey: "weekly-digest" });
    expect(id).toBe("u_1/weekly-digest");
    expect(defaultParseScheduleId(id)).toEqual({
      userId: "u_1",
      collectionKey: "weekly-digest"
    });
  });
});

describe("createResourceCollectionScheduleResolver", () => {
  const collection = { pattern: "schedules/*" };

  it("reads a resource and synthesizes a principal from the parsed userId", async () => {
    const records = new Map([
      [
        "user:u_1:schedules/weekly-digest",
        JSON.stringify({ cron: "0 9 * * MON", action: "sendDigest", input: { topic: "weekly" } })
      ]
    ]);
    const resolve = createResourceCollectionScheduleResolver({ collection });
    const config = await resolve("u_1/weekly-digest", buildCtx(records));
    expect(config).not.toBeNull();
    expect(config?.cron).toBe("0 9 * * MON");
    expect(config?.action).toBe("sendDigest");
    expect(config?.principal).toEqual({ userId: "u_1" });
    expect(config?.input).toEqual({ topic: "weekly" });
  });

  it("returns null when the resource does not exist", async () => {
    const resolve = createResourceCollectionScheduleResolver({ collection });
    const config = await resolve("u_1/missing", buildCtx(new Map()));
    expect(config).toBeNull();
  });

  it("returns null when the parsed id is malformed", async () => {
    const resolve = createResourceCollectionScheduleResolver({ collection });
    const config = await resolve("monolith", buildCtx(new Map()));
    expect(config).toBeNull();
  });

  it("returns null when the resource is disabled", async () => {
    const records = new Map([
      [
        "user:u_1:schedules/weekly-digest",
        JSON.stringify({
          cron: "0 9 * * MON",
          action: "sendDigest",
          enabled: false
        })
      ]
    ]);
    const resolve = createResourceCollectionScheduleResolver({ collection });
    const config = await resolve("u_1/weekly-digest", buildCtx(records));
    expect(config).toBeNull();
  });

  it("returns null when the persisted state is not valid JSON", async () => {
    const records = new Map([["user:u_1:schedules/weekly-digest", "not json"]]);
    const resolve = createResourceCollectionScheduleResolver({ collection });
    const config = await resolve("u_1/weekly-digest", buildCtx(records));
    expect(config).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    const records = new Map([
      ["user:u_1:schedules/weekly-digest", JSON.stringify({ cron: "0 9 * * MON" })]
    ]);
    const resolve = createResourceCollectionScheduleResolver({ collection });
    const config = await resolve("u_1/weekly-digest", buildCtx(records));
    expect(config).toBeNull();
  });

  it("supports a custom parseId for richer composite keys", async () => {
    const records = new Map([
      [
        "user:u_42:schedules/lead-456",
        JSON.stringify({ cron: "0 9 * * MON", action: "followUp" })
      ]
    ]);
    const resolve = createResourceCollectionScheduleResolver({
      collection,
      parseId: (id) => {
        const match = id.match(/^agent-followup:([^:]+):(.+)$/);
        if (!match) return null;
        return { userId: match[1]!, collectionKey: match[2]! };
      }
    });
    const config = await resolve("agent-followup:u_42:lead-456", buildCtx(records));
    expect(config?.action).toBe("followUp");
    expect(config?.principal).toEqual({ userId: "u_42" });
  });

  it("propagates timezone, onOverlap, description on the synthesized config", async () => {
    const records = new Map([
      [
        "user:u_1:schedules/weekly-digest",
        JSON.stringify({
          cron: "0 9 * * MON",
          action: "sendDigest",
          timezone: "America/New_York",
          onOverlap: "allow",
          description: "Weekly Monday digest"
        })
      ]
    ]);
    const resolve = createResourceCollectionScheduleResolver({ collection });
    const config = await resolve("u_1/weekly-digest", buildCtx(records));
    expect(config?.timezone).toBe("America/New_York");
    expect(config?.onOverlap).toBe("allow");
    expect(config?.description).toBe("Weekly Monday digest");
  });
});
