/**
 * Throwaway characterization for FIX-1356: does a `WORKER.md` that declares
 * `skills:` already reach its hired seat today, with no framework change?
 *
 * Nothing here is a proposal. Every assertion describes current `main`.
 * Scoped to that one question — `hireWorkforce`'s own refusal contract is
 * covered by the package's `test/hire.test.ts` and is not re-pinned here.
 *
 * Set `FIX1356_LOG=1` to print what each case observed.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readWorkforceDirectory } from "../../src/loader/read-workforce-directory";
import { hireWorkforce } from "../../src/hire";

const log = (...args: unknown[]) => {
  if (process.env["FIX1356_LOG"]) console.log(...args);
};

const inputSchema = z.object({ note: z.string() });
const work = handler({
  name: "w",
  inputSchema,
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input,
});

/** A flow kind that claims a `skills:` list as one of its own settings. */
const seatFlow = defineFlow({
  kind: "seat",
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string(),
    skills: z.array(z.string()).default([]),
  }),
  actions: { run: { inputSchema, block: work } },
});

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fix1356-w-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeSeat() {
  const dir = path.join(tmp, "teams", "pentest", "workers", "recon");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "WORKER.md"),
    `---\ndescription: Recon seat.\nflow: seat\nskills: [port-scan, triage]\n---\nFind things.`,
  );
}

describe("P1 - a WORKER.md `skills:` list survives the loader verbatim", () => {
  it("carries an unclaimed `skills:` key into the manifest's declared bag", async () => {
    await writeSeat();
    const { workers, errors } = await readWorkforceDirectory(tmp);
    log("P1 errors:", errors);
    log("P1 declared:", JSON.stringify(workers[0]!.declared));
    expect(errors).toEqual([]);
    expect(workers[0]!.id).toBe("pentest.recon");
    expect(workers[0]!.declared["skills"]).toEqual(["port-scan", "triage"]);
  });
});

describe("P2 - that list reaches the hired seat as ordinary flow settings", () => {
  it("hires with no framework change and no new reader", async () => {
    await writeSeat();
    const { workers } = await readWorkforceDirectory(tmp);
    const seats = hireWorkforce(workers, { kinds: { seat: seatFlow } });
    log("P2 seat id:", seats[0]!.id);
    log("P2 seat config:", JSON.stringify((seats[0] as { config?: unknown }).config));
    expect(seats).toHaveLength(1);
    expect(seats[0]!.id).toBe("pentest.recon");
    // The flow's own configSchema validated `skills` — the factory never saw it
    // as anything but an ordinary setting.
    expect((seats[0] as unknown as { config: { skills: string[] } }).config.skills).toEqual([
      "port-scan",
      "triage",
    ]);
  });
});
