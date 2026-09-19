/**
 * The unattended-board warning: a channel holds a ledger nobody drains.
 *
 * A warning and never a refusal, because the evidence is incomplete by
 * construction — a seat may legitimately live in another process, where this
 * check is blind. What it buys is that the silence stops being silent: rows
 * still sit `pending`, but somebody is told why.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { channelBoard, hireWorkforce, workerConfigSchema } from "../src/index";
import type { WorkerManifest } from "../src/manifest";

const work = handler({
  name: "attend-work",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input
});

/** A seat kind declaring one channel board as a flow resource — an attended board. */
function seatKindHolding(boardIds: string[]) {
  return defineFlow({
    kind: "coder",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: Object.fromEntries(
      boardIds.map((id) => [id, channelBoard(...(id.split(/\.(?=[^.]+$)/) as [string, string]))])
    ),
    actions: { run: { block: work } }
  });
}

function seat(id: string): WorkerManifest {
  return { id, declared: { flow: "coder" }, body: "Do the work." };
}

describe("a channel board nobody declared", () => {
  it("warns at hire, names the channel and the id, and still hires", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const seats = hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding(["eng.feature.work"]) as never },
        channelBoards: ["eng.feature.work", "eng.feature.review"]
      });

      // The hire succeeded — this is not a refusal, and a roster that boots
      // short would be a far worse answer than a line on stderr.
      expect(seats).toHaveLength(1);

      const said = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(said).toContain("eng.feature.review");
      expect(said).toContain("eng.feature");
      // The attended one is NOT named. Without this, a check that warned about
      // every board would pass the assertion above and tell an operator
      // nothing.
      expect(said).not.toContain("eng.feature.work");
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing when every board a roster minted is declared somewhere", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding(["eng.feature.work"]) as never },
        channelBoards: ["eng.feature.work"]
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing at all when the caller passes no board ids", () => {
    // Every existing caller. The check is opt-in by construction: it cannot
    // invent the roster's ids, and a hire with none is the shape it had before
    // boards existed.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding([]) as never }
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
