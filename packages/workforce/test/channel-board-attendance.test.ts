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

const noop = handler({
  name: "attend-triage",
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
    actions: { run: { block: noop } }
  });
}

function seat(id: string): WorkerManifest {
  return { id, declared: { flow: "coder" }, body: "Do the work." };
}

describe("a channel folder that was renamed", () => {
  it("re-keys its boards and warns, because the seat still declares the old id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // The channel moved from `eng.feature` to `eng.renamed`. A board id is a
      // storage key derived from where the channel folder sits, so the board
      // moved with it and the rows filed under the old id are still sitting at
      // the old key. Nothing migrates them and nothing refuses (BR-23) — the
      // seat below is the one that did not move.
      hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding(["eng.feature.triage"]) as never },
        channelBoards: ["eng.renamed.triage"]
      });

      const said = warn.mock.calls.map((call) => String(call[0])).join("\n");
      // The warning is the whole of what makes the stranding visible: it names
      // the board the RENAMED channel now holds, which nothing drains.
      expect(said).toContain("eng.renamed.triage");
      expect(said).toMatch(/channel "eng\.renamed"/);
      // And it does not claim the seat's old board is fine — that id is simply
      // not on the roster any more, so nothing reports on it at all. This is
      // the line that says the old rows are unreachable rather than migrated.
      expect(said).not.toContain("eng.feature.triage");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a channel board nobody declared", () => {
  it("warns at hire, names the channel and the id, and still hires", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const seats = hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding(["eng.feature.triage"]) as never },
        channelBoards: ["eng.feature.triage", "eng.feature.review"]
      });

      // The hire succeeded — this is not a refusal, and a roster that boots
      // short would be a far worse answer than a line on stderr.
      expect(seats).toHaveLength(1);

      const said = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(said).toContain("eng.feature.review");
      // The CHANNEL, said as a channel. A bare `toContain("eng.feature")`
      // cannot fail once the line above has passed, since the board id
      // contains the channel id — so it asserted nothing.
      expect(said).toMatch(/channel "eng\.feature"/);
      // The attended one is NOT named. Without this, a check that warned about
      // every board would pass the assertion above and tell an operator
      // nothing.
      expect(said).not.toContain("eng.feature.triage");
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing when every board a roster minted is declared somewhere", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding(["eng.feature.triage"]) as never },
        channelBoards: ["eng.feature.triage"]
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
