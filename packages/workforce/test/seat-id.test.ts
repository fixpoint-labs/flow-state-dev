/**
 * `seatId` — every hired seat knows its own id.
 *
 * A block inside a seat cannot see which seat it runs in: core keeps the flow's
 * id off the block context. The seat's settings are the one per-seat fact a
 * block can read, and only the hire step writes them, so the hire step stamps
 * the record's id there, on every record, from every mint path.
 *
 * Why it matters: a seat that files onto a board or posts to a channel signs
 * with this value. A seat hired without it would file unattributed; a record
 * that could author it could sign as any other seat.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext } from "@flow-state-dev/testing";
import { hireWorkforce } from "../src/hire";
import { readWorkforceDirectory } from "../src/loader/read-workforce-directory";
import type { WorkerManifest } from "../src/manifest";
import { SEAT_ID_KEY } from "../src/manifest";
import { reloadHiredSeats } from "../src/roster";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { defineSeatInventoryCollection } from "../src/inventory/collections";
import { createSeatHireBlocks } from "../src/seat-hire-blocks";
import { HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } from "../src/seat-hire-capability";
import { workerConfigSchema } from "../src/worker-config";

const inputSchema = z.object({ note: z.string() });
const work = handler({
  name: "clerk-work",
  inputSchema,
  outputSchema: inputSchema,
  execute: (input) => input,
});

const deskClerk = defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: { answer: { inputSchema, block: work } },
});
const kinds = { "desk-clerk": deskClerk };

function record(id: string, declared: Record<string, unknown> = {}): WorkerManifest {
  return { id, declared: { flow: "desk-clerk", ...declared }, body: "" };
}

function refusalOf(manifests: WorkerManifest[]): string {
  try {
    hireWorkforce(manifests, { kinds });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal");
}

describe("every hired seat carries its own id as `seatId`", () => {
  it("is the contract key, spelled once", () => {
    expect(SEAT_ID_KEY).toBe("seatId");
    expect(Object.keys(workerConfigSchema().shape)).toContain(SEAT_ID_KEY);
  });

  it("from files: each seat's `seatId` is its own record id, not a sibling's", () => {
    const seats = hireWorkforce([record("support.ada"), record("support.grace")], { kinds });
    expect(seats.map((seat) => [seat.id, seat.config[SEAT_ID_KEY]])).toEqual([
      ["support.ada", "support.ada"],
      ["support.grace", "support.grace"],
    ]);
  });

  it("from the runtime `hire` tool: the seat it registers carries its record id", async () => {
    const registered: FlowInstance[] = [];
    const { hire } = createSeatHireBlocks({
      kinds,
      register: (seat) => {
        registered.push(seat);
      },
      unregister: () => true,
    });
    const { ctx } = await createTestContext({
      orgId: "acme",
      sessionId: "test-session",
      declaredResources: {
        [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
        [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
      },
    });

    const result = await executeBlock({
      block: hire,
      input: { seatId: "support.otto", flow: "desk-clerk" },
      ctx,
    });
    expect(result.error).toBeUndefined();
    expect(registered.map((seat) => [seat.id, seat.config[SEAT_ID_KEY]])).toEqual([
      ["acme.support.otto", "acme.support.otto"],
    ]);
  });

  it("from the boot reload: a stored row written before the key existed still gets it", async () => {
    const stores = {
      resourceState: {
        async getByPrefix() {
          return {
            "workforce/roster/support.ada": {
              state: { seatId: "support.ada", flow: "desk-clerk", settings: { desk: "front" } },
            },
          };
        },
      },
    };
    const { seats, problems } = await reloadHiredSeats({ stores, orgIds: ["acme"], kinds });
    expect(problems).toEqual([]);
    expect(seats.map((seat) => [seat.id, seat.config[SEAT_ID_KEY]])).toEqual([
      ["acme.support.ada", "acme.support.ada"],
    ]);
  });
});

describe("a record may not author `seatId`", () => {
  it("is refused by name at the hire, even though every composed kind declares the key", () => {
    // Control: the same record without the key hires.
    expect(hireWorkforce([record("support.ada")], { kinds })).toHaveLength(1);

    const message = refusalOf([record("support.ada", { seatId: "support.grace" })]);
    expect(message).toContain('worker "support.ada"');
    expect(message).toContain("`seatId:`");
    expect(message).toContain("not a setting a worker declares");
  });

  it("is refused by name at the loader", async () => {
    const root = mkdtempSync(join(tmpdir(), "fsd-seat-id-"));
    const file = join(root, "teams/support/workers/ada/WORKER.md");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(
      file,
      "---\ndescription: The front desk.\nflow: desk-clerk\nseatId: support.grace\n---\nBody.\n",
    );
    const { workers, errors } = await readWorkforceDirectory(root);
    rmSync(root, { recursive: true, force: true });
    expect(workers).toEqual([]);
    expect(errors.map((e) => e.path)).toEqual(["teams/support/workers/ada"]);
    expect(errors[0]!.error.message).toContain("`seatId:`");
    expect(errors[0]!.error.message).toContain("not a setting a worker declares");
  });
});

describe("a hand-written kind schema that omits `seatId`", () => {
  it("refuses at the hire, naming the key", () => {
    const handWritten = defineFlow({
      kind: "hand-written",
      cardinality: "collection",
      configSchema: z.object({
        instructions: z.string().optional(),
        teamInstructions: z.string().optional(),
        seatSkills: z.array(z.any()).optional(),
        seatTools: z.array(z.any()).optional(),
        seatPackages: z.array(z.any()).optional(),
      }),
      actions: { answer: { inputSchema, block: work } },
    });
    let message = "";
    try {
      hireWorkforce([{ id: "support.ada", declared: { flow: "hand-written" }, body: "" }], {
        kinds: { "hand-written": handWritten as never },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('"seatId" is not a declared setting');
    expect(message).toContain("`seatId`");
  });
});
