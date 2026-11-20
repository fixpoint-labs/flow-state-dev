/**
 * This lab's installed copies of the registry's conversation lines stay
 * byte-identical to their source in `@flow-state-dev/ui`, with what they
 * import: the lab configures the registry's failed, stopped, approval, steps
 * and workforce lines through their line context, and a fix to one reaches
 * here by refreshing the copy. Red: any edit to either copy alone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the conversation-line copies", () => {
  for (const file of ["conversation-lines.tsx", "workforce-lines.tsx", "approval.tsx", "session-items-context.tsx", "request-recovery.tsx", "tool-grouping.ts", "tool-naming.ts"]) {
    it(`${file} is the registry's, byte for byte`, () => {
      expect(read(`../src/components/flow-state/${file}`)).toBe(read(`../../../packages/ui/registry/components/${file}`));
    });
  }
});
