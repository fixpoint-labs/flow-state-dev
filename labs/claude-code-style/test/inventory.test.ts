/**
 * The inventory check: the lab has no *other* row, and the check catches one.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script with no types.
import { inventory } from "../scripts/inventory.mjs";

const script = fileURLToPath(new URL("../scripts/inventory.mjs", import.meta.url));
const run = (...args: string[]) => execFileSync("node", [script, ...args], { encoding: "utf8" });

describe("the inventory", () => {
  it("passes on the lab as it is", () => {
    expect(run()).toMatch(/PASS/);
  });

  it("fails on a file that is not config, UI, a flow, a check or a fixture", () => {
    expect(run("--control")).toMatch(/FAIL as required/);
    const { problems } = inventory(["src/glue.ts", "src/App.tsx"], { linesOf: () => 1 });
    expect(problems).toEqual([expect.stringContaining("other: src/glue.ts")]);
  });

  it("fails on a flow over 200 lines, and on a fixture left after wiring", () => {
    const { problems } = inventory(["workforce/flows/turn.mts", "src/fixtures.ts"], { wired: true, linesOf: () => 201 });
    expect(problems).toEqual([expect.stringContaining("flow over 200"), expect.stringContaining("fixture left")]);
  });
});
