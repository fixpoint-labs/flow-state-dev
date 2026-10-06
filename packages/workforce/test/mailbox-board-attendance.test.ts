/**
 * The unattended-board warning: a mailbox holds a ledger nobody drains.
 *
 * A warning and never a refusal, because the evidence is incomplete by
 * construction — a seat may legitimately live in another process, where this
 * check is blind. What it buys is that the silence stops being silent: rows
 * still sit `pending`, but somebody is told why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { __resetDeprecationWarningsForTests, defineFlow, handler } from "@flow-state-dev/core";
import { mailboxBoard, hireWorkforce, workerConfigSchema } from "../src/index";
import type { WorkerManifest } from "../src/manifest";

const noop = handler({
  name: "attend-triage",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input
});

/** A seat kind declaring one mailbox board as a flow resource — an attended board. */
function seatKindHolding(boardIds: string[]) {
  return defineFlow({
    kind: "coder",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: Object.fromEntries(
      boardIds.map((id) => [id, mailboxBoard(...(id.split(/\.(?=[^.]+$)/) as [string, string]))])
    ),
    actions: { run: { block: noop } }
  });
}

function seat(id: string): WorkerManifest {
  return { id, declared: { flow: "coder" }, body: "Do the work." };
}

// The warning prints once per process per sentence, so each test starts as a
// fresh process would.
beforeEach(() => {
  __resetDeprecationWarningsForTests();
});

describe("a mailbox folder that was renamed", () => {
  it("re-keys its boards and warns, because the seat still declares the old id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // The mailbox moved from `eng.feature` to `eng.renamed`. A board id is a
      // storage key derived from where the mailbox folder sits, so the board
      // moved with it and the rows filed under the old id are still sitting at
      // the old key. Nothing migrates them and nothing refuses (BR-23) — the
      // seat below is the one that did not move.
      hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding(["eng.feature.triage"]) as never },
        mailboxBoards: ["eng.renamed.triage"]
      });

      const said = warn.mock.calls.map((call) => String(call[0])).join("\n");
      // The warning is the whole of what makes the stranding visible: it names
      // the board the RENAMED mailbox now holds, which nothing drains.
      expect(said).toContain("eng.renamed.triage");
      expect(said).toMatch(/mailbox "eng\.renamed"/);
      // And it does not claim the seat's old board is fine — that id is simply
      // not on the roster any more, so nothing reports on it at all. This is
      // the line that says the old rows are unreachable rather than migrated.
      expect(said).not.toContain("eng.feature.triage");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a mailbox board nobody declared", () => {
  it("warns at hire, names the mailbox and the id, and still hires", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const seats = hireWorkforce([seat("eng.coder")], {
        kinds: { coder: seatKindHolding(["eng.feature.triage"]) as never },
        mailboxBoards: ["eng.feature.triage", "eng.feature.review"]
      });

      // The hire succeeded — this is not a refusal, and a roster that boots
      // short would be a far worse answer than a line on stderr.
      expect(seats).toHaveLength(1);

      const said = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(said).toContain("eng.feature.review");
      // The MAILBOX, said as a mailbox. A bare `toContain("eng.feature")`
      // cannot fail once the line above has passed, since the board id
      // contains the mailbox id — so it asserted nothing.
      expect(said).toMatch(/mailbox "eng\.feature"/);
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
        mailboxBoards: ["eng.feature.triage"]
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says it once per process, not once per hire, and still names a board that newly goes unattended", () => {
    // `next dev` re-runs an app's module-scope hire on every hot reload. The
    // board unattended at boot is still unattended after an edit, and a
    // developer who sees the sentence fifty times cannot tell a repeat from a
    // fresh problem. So a repeat is silent — but a DIFFERENT unattended board
    // is a fresh problem, and must still be said.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hire = (mailboxBoards: string[]) =>
        hireWorkforce([seat("eng.coder")], {
          kinds: { coder: seatKindHolding(["eng.feature.triage"]) as never },
          mailboxBoards
        });

      hire(["eng.feature.triage", "eng.feature.review"]);
      hire(["eng.feature.triage", "eng.feature.review"]);
      hire(["eng.feature.triage", "eng.feature.review"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("eng.feature.review");

      hire(["eng.feature.triage", "eng.feature.review", "eng.feature.escalations"]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1]?.[0])).toContain("eng.feature.escalations");
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
