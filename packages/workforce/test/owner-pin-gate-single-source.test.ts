/**
 * Guard: the hired-seat owner-pin gate has exactly one implementation.
 *
 * The gate is what refuses to register a hired seat without an owner pin taken
 * from its hire row. It is security-relevant, and it is reachable from several
 * modules: the package root, the seat-hire capability, the hire blocks and the
 * roster. If two of those held separate copies, an edit to one (a new guard, a
 * reworded refusal, a wider pin) would pass every test while the other copy
 * stayed as it was. Two checks back the single source:
 *
 *   1. Every module that exports `registerHiredSeat` or
 *      `hiredSeatOwnerPinFromRosterOwner` exports the same function object.
 *      This catches a second exported copy.
 *   2. The gate's refusal sentence appears in exactly one source file, the
 *      roster module that owns the gate. This catches a private copy pasted in
 *      with its message.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as root from "../src/index";
import * as capability from "../src/seat-hire-capability";
import * as blocks from "../src/seat-hire-blocks";
import * as rosterBarrel from "../src/roster";
import * as gate from "../src/roster/register-hired-seat";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..", "src");

/** The start of the gate's refusal message; the gate's fingerprint in source. */
const REFUSAL = "A hired seat cannot be registered without an owner pin";

/** Recursively collect every `.ts` file under a directory. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

describe("the hired-seat owner-pin gate has one implementation", () => {
  const exporters = { root, capability, blocks, rosterBarrel };

  it.each(Object.entries(exporters))(
    "%s exports the roster module's gate, not a copy",
    (_name, mod) => {
      expect(mod.registerHiredSeat).toBe(gate.registerHiredSeat);
      expect(mod.hiredSeatOwnerPinFromRosterOwner).toBe(gate.hiredSeatOwnerPinFromRosterOwner);
    },
  );

  it("states the refusal in exactly one source file, the roster gate", () => {
    const holders = collectSourceFiles(srcDir)
      .filter((file) => readFileSync(file, "utf8").includes(REFUSAL))
      .map((file) => path.relative(srcDir, file));
    expect(holders).toEqual([path.join("roster", "register-hired-seat.ts")]);
  });
});
