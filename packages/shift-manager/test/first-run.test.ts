/**
 * The Shift Coordinator's starter lines come from the delegates read for the
 * conversation, never from a Lab's workers written into Shift Manager. Two
 * rosters with different delegates must give different lines, each naming
 * only its own delegates; lines written for one Lab would fail both.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { starterLines } from "../src/lib/first-run";

const devTeam = [
  { worker: "eng.em", name: "Engineering Manager" },
  { worker: "eng.reviewer", name: "Reviewer" },
];
const support = [
  { worker: "desk.triage", name: "Triage" },
  { worker: "desk.billing", name: "Billing Specialist" },
];

describe("the Shift Coordinator's starter lines", () => {
  it("differ between two rosters, each naming only its own delegates", () => {
    const a = starterLines(devTeam);
    const b = starterLines(support);
    expect(a).not.toEqual(b);
    expect(a.some((line) => line.includes("Engineering Manager"))).toBe(true);
    expect(b.some((line) => line.includes("Triage"))).toBe(true);
    for (const line of a) for (const { name } of support) expect(line).not.toContain(name);
    for (const line of b) for (const { name } of devTeam) expect(line).not.toContain(name);
  });

  it("name nobody when no delegates were read", () => {
    for (const line of starterLines([])) for (const { name } of [...devTeam, ...support]) expect(line).not.toContain(name);
  });

  it("hold no Lab's worker name in their source", () => {
    const source = readFileSync(new URL("../src/lib/first-run.ts", import.meta.url), "utf8");
    for (const name of ["Engineering Manager", "Reviewer", "eng.", "Chief of Staff"]) expect(source).not.toContain(name); // retired-name-refusal: the Teammates lab's name, asserted absent
  });
});
