/**
 * The pieces every candidate builds out of, and the tree every candidate
 * builds into.
 *
 * Shared so the columns are comparable: the same tool block, the same two
 * seats, the same two prompt layers. What differs between columns is only how
 * the capability is PACKAGED, which is the thing under comparison.
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
export const BYSTANDER = "support.bystander";

/**
 * Write the two seats and their team.
 *
 * `holderFrontmatter` is the only thing a candidate varies: it is where an
 * attachment is spelled. The bystander is identical minus that line, which is
 * what makes P1's leak check and P5's fence check read as the same experiment
 * run twice.
 */
export function writeBaseTree(
  root: string,
  holderFrontmatter: string,
  bystanderFrontmatter = "",
): void {
  fs.mkdirSync(path.join(root, "teams/support"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "teams/support/TEAM.md"),
    "---\ndescription: Support.\n---\n\nTEAM CHARTER: answer the customer, then log what you did.\n",
  );
  const write = (name: string, frontmatter: string) => {
    const dir = path.join(root, "teams/support/workers", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "WORKER.md"),
      `---\ndescription: ${name}.\n${frontmatter}---\n\nSEAT CHARTER: you are the ${name}.\n`,
    );
  };
  write("holder", holderFrontmatter);
  write("bystander", bystanderFrontmatter);
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
