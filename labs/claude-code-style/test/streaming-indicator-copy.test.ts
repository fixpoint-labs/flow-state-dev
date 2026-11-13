/**
 * This lab's installed copy of the registry's `streaming-indicator` stays
 * byte-identical to its source in `@flow-state-dev/ui`, so the live line at
 * the end of a task's feed is the one every host draws, and a fix to it
 * reaches here. Red: any edit to either copy alone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("streaming-indicator copy", () => {
  it("is the registry's component, byte for byte", () => {
    expect(read("../src/components/flow-state/streaming-indicator.tsx")).toBe(read("../../../packages/ui/registry/components/streaming-indicator.tsx"));
  });
});
