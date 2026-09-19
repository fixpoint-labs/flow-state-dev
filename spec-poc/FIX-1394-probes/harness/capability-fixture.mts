/**
 * The pieces every candidate builds out of, and the tree every candidate
 * builds into.
 *
 * Shared so the columns are comparable: the same tool block, the same three
 * seats, the same two prompt layers. What differs between columns is only how
 * the capability is PACKAGED, which is the thing under comparison.
 *
 * **Three seats, not two.** Round 1 had a holder and a bystander, and P5 read
 * the bystander — a seat the package was never attached to. Its empty tool list
 * proved only that an unattached seat has no tools, so a reader that widened
 * the fence for every package-holding seat would have passed. The FENCED seat
 * closes that: it holds the package exactly as the holder does and differs in
 * one line, the `tools:` grant.
 *
 *   holder     holds the package, names its tool          -> may call it
 *   fenced     holds the package, names nothing           -> may not
 *   bystander  holds nothing                              -> the leak control
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { CAPABILITY } from "./contract.mts";

/**
 * The package's tool, for candidates that do not author their own module.
 *
 * Writes the same `FIX1394_MARKER` the authored source does, so "did the block
 * run" is one observation everywhere rather than two.
 */
export const ledgerAppend = handler({
  name: CAPABILITY.toolName,
  description: "Appends one handover line to the ledger.",
  inputSchema: z.object({}),
  outputSchema: z.object({ appended: z.boolean() }),
  execute: async () => {
    const marker = process.env["FIX1394_MARKER"];
    if (marker !== undefined) fs.appendFileSync(marker, "ran\n");
    return { appended: true };
  },
}) as BlockDefinition;

/** Seat ids every candidate uses, so probes never have to ask a candidate for them. */
export const HOLDER = "support.holder";
export const FENCED = "support.fenced";
export const BYSTANDER = "support.bystander";

/** What a candidate's reader writes into each seat's frontmatter. */
export interface SeatFrontmatter {
  holder: string;
  fenced: string;
  bystander: string;
}

/** Nothing attached to anybody — variant A's shape, and the P6 baseline's. */
export const NO_ATTACHMENT: SeatFrontmatter = { holder: "", fenced: "", bystander: "" };

/**
 * Write the three seats and their team.
 *
 * The frontmatter is the only thing a candidate varies: it is where an
 * attachment is spelled. The three seats are otherwise identical, which is what
 * makes P1's leak check and P5's fence check read as the same experiment run on
 * different rows.
 */
export function writeBaseTree(root: string, frontmatter: SeatFrontmatter): void {
  fs.mkdirSync(path.join(root, "teams/support"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "teams/support/TEAM.md"),
    "---\ndescription: Support.\n---\n\nTEAM CHARTER: answer the customer, then log what you did.\n",
  );
  const write = (name: string, own: string) => {
    const dir = path.join(root, "teams/support/workers", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "WORKER.md"),
      `---\ndescription: ${name}.\n${own}---\n\nSEAT CHARTER: you are the ${name}.\n`,
    );
  };
  write("holder", frontmatter.holder);
  write("fenced", frontmatter.fenced);
  write("bystander", frontmatter.bystander);
}

/** Write one file under the tree, creating parents. Returns its bytes. */
export function writeFile(root: string, relative: string, contents: string): string {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return contents;
}

/** The package's `SKILL.md`, used by every candidate that reaches a library mode. */
export function skillMd(): string {
  return (
    `---\nname: handover\ndescription: Hand a customer to another team.\n` +
    `allowed-tools: [${CAPABILITY.toolName}]\n---\n\n` +
    `${CAPABILITY.instructions}\n\n${CAPABILITY.documentBody}\n`
  );
}
