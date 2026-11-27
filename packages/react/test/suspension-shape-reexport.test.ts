// FIX-2770.
/**
 * `suspensionShape` moved to contracts so the server's pending-asks read
 * draws the card the browser draws. React keeps it public: an app that
 * imported it from `@flow-state-dev/react` must get the one function, not a
 * copy that could drift.
 */
import { describe, expect, it } from "vitest";
import * as contracts from "@flow-state-dev/contracts/types/suspension";
import * as root from "../src";

describe("@flow-state-dev/react suspensionShape", () => {
  it("is contracts' own function", () => {
    expect(root.suspensionShape).toBe(contracts.suspensionShape);
  });
});
