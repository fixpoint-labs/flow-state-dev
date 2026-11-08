/**
 * This lab's installed copy of the registry's `session-overlay` item stays
 * byte-identical to its source in `@flow-state-dev/ui`, so a fix to how a
 * session overlay closes or scrolls reaches every lab that draws one. Red:
 * any edit to either copy alone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("session-overlay copy", () => {
  it("is the registry's item, byte for byte", () => {
    expect(read("../src/components/flow-state/session-overlay.tsx")).toBe(read("../../../packages/ui/registry/components/session-overlay.tsx"));
  });
});
