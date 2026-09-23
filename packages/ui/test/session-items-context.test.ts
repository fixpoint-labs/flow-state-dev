/**
 * Copied registry components must share `@flow-state-dev/react`'s session
 * item context (FIX-1498). A local createContext here would be a different
 * provider than the one ItemsRenderer mounts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../registry/components/session-items-context.tsx");

describe("session-items-context", () => {
  it("re-exports SessionItemsProvider and useSessionItems from @flow-state-dev/react", () => {
    const src = readFileSync(SOURCE, "utf8");
    expect(src).toContain('from "@flow-state-dev/react"');
    expect(src).toContain("SessionItemsProvider");
    expect(src).toContain("useSessionItems");
    expect(src).not.toMatch(/createContext/);
  });
});
