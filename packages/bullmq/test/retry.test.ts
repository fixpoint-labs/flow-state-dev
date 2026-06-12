import { describe, it, expect } from "vitest";
import { toJobOptions, resolveDlqName } from "../src/retry";

describe("toJobOptions", () => {
  it("returns defaults when no config is provided", () => {
    const opts = toJobOptions();
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({
      type: "exponential",
      delay: 1000,
      jitter: 0.5
    });
    expect(opts.removeOnComplete).toEqual({ age: 3600, count: 1000 });
    expect(opts.removeOnFail).toEqual({ age: 86400 });
  });

  it("overrides specific fields", () => {
    const opts = toJobOptions({ attempts: 5 });
    expect(opts.attempts).toBe(5);
    expect(opts.backoff).toEqual({
      type: "exponential",
      delay: 1000,
      jitter: 0.5
    });
  });

  it("supports fixed backoff", () => {
    const opts = toJobOptions({
      backoff: { type: "fixed", delay: 2000 }
    });
    expect(opts.backoff).toEqual({ type: "fixed", delay: 2000 });
  });

  it("handles boolean removeOnComplete", () => {
    const opts = toJobOptions({ removeOnComplete: true });
    expect(opts.removeOnComplete).toBe(true);
  });

  it("handles removeOnComplete with only count", () => {
    const opts = toJobOptions({ removeOnComplete: { count: 500 } });
    expect(opts.removeOnComplete).toEqual({ count: 500 });
  });
});

describe("resolveDlqName", () => {
  it("returns null when no deadLetter config", () => {
    expect(resolveDlqName("fsd-flows")).toBeNull();
    expect(resolveDlqName("fsd-flows", {})).toBeNull();
    expect(resolveDlqName("fsd-flows", { deadLetter: false })).toBeNull();
  });

  it("generates default DLQ name from queue name", () => {
    expect(resolveDlqName("fsd-flows", { deadLetter: true })).toBe(
      "fsd-flows-dlq"
    );
  });

  it("uses custom DLQ name when provided", () => {
    expect(
      resolveDlqName("fsd-flows", {
        deadLetter: { queueName: "my-dead-letters" }
      })
    ).toBe("my-dead-letters");
  });
});
