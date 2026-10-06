/**
 * The per-row check the boot reload and `brokenSeats` share.
 *
 * Each reason maps from the refusal the reload already made, and a row whose
 * kind is gone is decided before anything is minted: the hire is never asked
 * about a kind the app no longer carries.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { workerConfigSchema } from "../src/worker-config";
import { toHiredSeatRow } from "../src/roster/rows";

const hires = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("../src/hire", async () => {
  const actual = await vi.importActual<typeof import("../src/hire")>("../src/hire");
  return {
    ...actual,
    hireWorkforce: (...args: Parameters<typeof actual.hireWorkforce>) => {
      hires.calls.push(...args[0].map((manifest) => manifest.id));
      return actual.hireWorkforce(...args);
    },
  };
});

const { checkHiredSeatRow } = await import("../src/roster/check");
const { reloadHiredSeats } = await import("../src/roster/reload");

const noop = handler({
  name: "noop",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: () => ({}),
});

/** A kind whose settings require `queue`. */
const desk = defineFlow({
  kind: "desk",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ queue: z.string() }),
  actions: { run: { inputSchema: z.object({}), block: noop } },
});

const kinds = { desk };

function stored(over: Parameters<typeof toHiredSeatRow>[0]) {
  return toHiredSeatRow({ owningOrgId: "acme", ...over });
}

describe("checkHiredSeatRow", () => {
  it("a row that would start is a seat", () => {
    const checked = checkHiredSeatRow("acme", stored({ seatId: "support.ada", flow: "desk", settings: { queue: "q" } }), kinds);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.seat.id).toBe("acme.support.ada");
  });

  it("kind-gone is decided before any mint, and names the kinds the app carries", () => {
    hires.calls.length = 0;
    const checked = checkHiredSeatRow("acme", stored({ seatId: "support.joe", flow: "desk-clerk" }), kinds);
    expect(checked).toMatchObject({ ok: false, reason: "kind-gone", row: { seatId: "support.joe", flow: "desk-clerk" } });
    if (!checked.ok) expect(checked.detail).toContain('Kinds passed: "agent", "desk"');
    expect(hires.calls, "the hire was asked about a cut kind").toEqual([]);
  });

  it("kind-gone's detail is the sentence the hire itself would throw", async () => {
    const { hireWorkforce } = await vi.importActual<typeof import("../src/hire")>("../src/hire");
    const checked = checkHiredSeatRow("acme", stored({ seatId: "support.joe", flow: "desk-clerk" }), kinds);
    let thrown = "";
    try {
      hireWorkforce(
        [{ id: "acme.support.joe", declared: { flow: "desk-clerk" }, body: "", seatId: "support.joe" }],
        { kinds },
      );
    } catch (error) {
      thrown = (error as Error).message;
    }
    expect(thrown).not.toBe("");
    expect(checked.ok ? "" : checked.detail).toBe(thrown);
  });

  it("refused: the kind is carried and refuses the settings, with the kind's own refusal", () => {
    const checked = checkHiredSeatRow("acme", stored({ seatId: "support.lin", flow: "desk" }), kinds);
    expect(checked).toMatchObject({ ok: false, reason: "refused" });
    if (!checked.ok) expect(checked.detail).toMatch(/queue/);
  });

  it("unreadable: a row that doesn't parse, a row stamped for another org; any org id addresses", () => {
    const shapeless = checkHiredSeatRow("acme", { seatId: "support.x" }, kinds);
    expect(shapeless).toMatchObject({ ok: false, reason: "unreadable" });
    expect(shapeless.ok ? undefined : shapeless.row).toBeUndefined();

    const foreign = checkHiredSeatRow("acme", stored({ seatId: "support.y", flow: "desk", owningOrgId: "globex" }), kinds);
    expect(foreign).toMatchObject({ ok: false, reason: "unreadable" });
    if (!foreign.ok) expect(foreign.detail).toMatch(/cannot be registered under "acme"/);

    // An org id outside lowercase-hyphen is escaped into the address, not refused.
    const spacedOrg = checkHiredSeatRow("Not An Org", stored({ seatId: "support.z", flow: "desk", settings: { queue: "q" }, owningOrgId: null }), kinds);
    expect(spacedOrg).toMatchObject({ ok: true });
  });

  it("the reload names each skipped row with the check's detail, unchanged", async () => {
    const rows: Record<string, { state: Record<string, unknown> }> = {
      "workforce/roster/support.joe": { state: stored({ seatId: "support.joe", flow: "desk-clerk" }) },
      "workforce/roster/support.lin": { state: stored({ seatId: "support.lin", flow: "desk" }) },
      "workforce/roster/support.ada": { state: stored({ seatId: "support.ada", flow: "desk", settings: { queue: "q" } }) },
    };
    const reload = await reloadHiredSeats({
      stores: { resourceState: { getByPrefix: async () => rows } },
      orgIds: ["acme"],
      kinds,
    });
    expect(reload.seats.map((seat) => seat.id)).toEqual(["acme.support.ada"]);
    const expected = ["support.joe", "support.lin"].map((seatId) => {
      const checked = checkHiredSeatRow("acme", rows[`workforce/roster/${seatId}`]!.state, kinds);
      return `organization "acme", row "workforce/roster/${seatId}" — ${checked.ok ? "" : checked.detail}`;
    });
    expect(reload.problems).toEqual(expected);
  });
});
