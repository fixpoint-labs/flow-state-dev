/**
 * This lab's installed copy of the registry's `conversation` item stays
 * byte-identical to its source in `@flow-state-dev/ui`, so the jump-to-latest
 * button the lab draws is the registry's one, and a fix to it reaches here.
 * Red: any edit to either copy alone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("conversation copy", () => {
  it("is the registry's item, byte for byte", () => {
    expect(read("../src/components/flow-state/conversation.tsx")).toBe(read("../../../packages/ui/registry/components/conversation.tsx"));
  });
});
