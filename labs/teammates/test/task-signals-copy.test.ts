/**
 * This lab's installed copy of the registry's `task-signals` item stays
 * byte-identical to its source in `@flow-state-dev/ui`, so a fix to the
 * item reaches every lab that draws it. Red: any edit to either copy alone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("task-signals copy", () => {
  it("is the registry's item, byte for byte", () => {
    expect(read("../src/components/flow-state/task-signals.tsx")).toBe(read("../../../packages/ui/registry/components/task-signals.tsx"));
  });
});
