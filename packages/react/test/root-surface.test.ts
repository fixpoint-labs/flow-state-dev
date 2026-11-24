/**
 * The react root carries only what an app author reaches for: hooks,
 * renderers, `FlowNavigator` and the key helpers.
 *
 * These value names were on the root with no outside reader. `deriveSuspensions`
 * has one, Shift Manager, which is our own package, so it moves to
 * `@flow-state-dev/react/internal`. The other two have no reader beyond react
 * itself (`useSuspensionForm` reads the schema analysis; the interrupt keys
 * own their window), so they leave public surface. The voice primitives move
 * to `@flow-state-dev/react/voice` (`voice-subpath.test.ts`). No alias stays on
 * the root: an old import breaks on purpose. Their types follow the same
 * split; the export check (`scripts/check-root-exports.mjs`) holds those,
 * since a type has no runtime key to assert on here.
 */
import { describe, expect, it } from "vitest";
import * as internal from "../src/internal";
import * as root from "../src";

const OFF_ROOT = [
  "deriveSuspensions",
  "analyzeResumeSchema",
  "INTERRUPT_WINDOW_MS"
];

describe("@flow-state-dev/react root", () => {
  it("no longer exports the names only the framework reads", () => {
    expect(Object.keys(root).filter((name) => OFF_ROOT.includes(name))).toEqual([]);
  });

  it("serves deriveSuspensions, Shift Manager's one read, from /internal", () => {
    expect(typeof internal.deriveSuspensions).toBe("function");
  });

  it("keeps the hooks those names sit behind", () => {
    expect(typeof root.useSuspensions).toBe("function");
    expect(typeof root.useSuspensionForm).toBe("function");
    expect(typeof root.useInterruptKeys).toBe("function");
    expect(typeof root.useVoice).toBe("function");
  });
});
