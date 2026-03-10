import { describe, expect, it } from "vitest";
import { defineFlow, generator, handler, router, sequencer } from "../src";

describe("@flow-state-dev/core test harness", () => {
  it("exports canonical block builders", () => {
    expect(typeof handler).toBe("function");
    expect(typeof generator).toBe("function");
    expect(typeof sequencer).toBe("function");
    expect(typeof router).toBe("function");
    expect(typeof defineFlow).toBe("function");
  });
});

describe("transient block config", () => {
  it("defaults transient to false when not configured", () => {
    const block = handler({
      name: "non-transient",
      execute: async () => "ok"
    });
    expect(block.transient).toBe(false);
  });

  it("sets transient to true when configured", () => {
    const block = handler({
      name: "transient-handler",
      transient: true,
      execute: async () => "ok"
    });
    expect(block.transient).toBe(true);
  });

  it("supports transient on handler blocks", () => {
    const block = handler({
      name: "t-handler",
      transient: true,
      execute: async () => "ok"
    });
    expect(block.kind).toBe("handler");
    expect(block.transient).toBe(true);
  });

  it("supports transient on generator blocks", () => {
    const block = generator({
      name: "t-generator",
      transient: true,
      execute: async () => "ok"
    });
    expect(block.kind).toBe("generator");
    expect(block.transient).toBe(true);
  });

  it("supports transient on sequencer blocks", () => {
    const block = sequencer({
      name: "t-sequencer",
      transient: true,
      execute: async () => "ok"
    });
    expect(block.kind).toBe("sequencer");
    expect(block.transient).toBe(true);
  });

  it("supports transient on router blocks", () => {
    const block = router({
      name: "t-router",
      transient: true,
      execute: async () => "ok"
    });
    expect(block.kind).toBe("router");
    expect(block.transient).toBe(true);
  });

  it("explicitly sets transient to false", () => {
    const block = handler({
      name: "explicit-false",
      transient: false,
      execute: async () => "ok"
    });
    expect(block.transient).toBe(false);
  });
});
