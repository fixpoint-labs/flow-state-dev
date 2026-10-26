/**
 * Usage's labels: what a window, an age and a harness are called on screen.
 * The rows themselves are the Lab's; these only name them.
 */
import { describe, expect, it } from "vitest";
import { ClientHttpError } from "@flow-state-dev/client";
import type { Client } from "@flow-state-dev/client";
import { readerSessionId } from "../src/lib/reads";
import { ageLabel, harnessName, levelLabel, percentLabel, runUsageQuery, toHarnessUsage, windowName } from "../src/lib/usage";

describe("Usage labels", () => {
  it("names a window by its length, after its limit's name when it has one", () => {
    expect(windowName({ id: "codex:primary", label: null, minutes: 300 })).toBe("5-hour");
    expect(windowName({ id: "codex:secondary", label: null, minutes: 10_080 })).toBe("Weekly");
    expect(windowName({ id: "codex_other:primary", label: "GPT-6 Spark", minutes: 300 })).toBe("GPT-6 Spark · 5-hour");
    expect(windowName({ id: "codex:primary", label: null, minutes: 45 })).toBe("45-minute");
  });

  it("falls back to the limit and its slot when the vendor gave no length", () => {
    expect(windowName({ id: "codex:primary", label: null, minutes: null })).toBe("codex · primary");
    expect(windowName({ id: "codex_other:secondary", label: "GPT-6 Spark", minutes: null })).toBe("GPT-6 Spark · secondary");
    expect(windowName({ id: "five_hour", label: null, minutes: null })).toBe("five_hour");
  });

  it("says how old a reading is in words", () => {
    expect(ageLabel(4_000)).toBe("a few seconds ago");
    expect(ageLabel(3 * 60_000)).toBe("3 min ago");
    expect(ageLabel(3 * 3_600_000)).toBe("3 h ago");
    expect(ageLabel(3 * 86_400_000)).toBe("3 days ago");
  });

  it("shows a percent as the vendor gave it, fraction and all", () => {
    expect(percentLabel(7.5)).toBe("7.5% used");
    expect(percentLabel(42)).toBe("42% used");
  });

  it("says how close a window with no percent is, never as a number", () => {
    expect(levelLabel("ok", "claude-code")).toBe("under Claude Code's warning line");
    expect(levelLabel("warning", "claude-code")).toBe("near its limit");
    expect(levelLabel("reached", "claude-code")).toBe("limit reached");
    expect(levelLabel(null, "claude-code")).not.toMatch(/\d/);
  });

  it("names harnesses for the user, and keeps only rows that are rows", () => {
    expect(harnessName("codex")).toBe("Codex");
    expect(harnessName("claude-code")).toBe("Claude Code");
    expect(toHarnessUsage({ harnesses: [{ harness: "codex" }, null, "x"] })).toEqual([{ harness: "codex" }]);
    expect(toHarnessUsage(undefined)).toEqual([]);
  });
});

/**
 * A connection whose Lab refuses `refused` (an id another organization holds,
 * which this one can't see) and answers the query on any other session.
 * `listed` is this organization's listing.
 */
function fakeLab(refused: string | null, listed: Array<{ id: string; flowKind: string }>) {
  const sent: string[] = [];
  const client = {
    userId: "alice",
    flow: () => ({
      send: async (_action: string, _input: unknown, options: { sessionId: string }) => {
        sent.push(options.sessionId);
        if (options.sessionId === refused) throw new ClientHttpError("unknown session", { status: 404, body: "" });
        return { id: `r${sent.length}` };
      },
      request: () => ({ status: async () => ({ status: "completed" }) }),
    }),
    sessions: {
      list: async () => listed.map((session) => ({ ...session, parentSessionId: null })),
      requests: async () => [{ id: `r${sent.length}`, result: { output: { harnesses: [{ harness: "codex" }] } } }],
    },
  } as unknown as Client;
  return { client, sent };
}

describe("the usage query's session", () => {
  const reader = readerSessionId("alice", "projects");

  it("runs on the user's one reading id when this organization holds it", async () => {
    const { client, sent } = fakeLab(null, []);
    expect(await runUsageQuery(client, "projects")).toEqual({ harnesses: [{ harness: "codex" }] });
    expect(sent).toEqual([reader]);
  });

  it("runs on this organization's own session when another organization holds the one id", async () => {
    const first = fakeLab(reader, []);
    expect(await runUsageQuery(first.client, "projects")).toEqual({ harnesses: [{ harness: "codex" }] });
    expect(first.sent[1]).toMatch(/^usage-own-[0-9a-f]{32}$/);
    // Once opened, this organization lists it, and the next read finds it rather than opening another.
    const again = fakeLab(reader, [{ id: first.sent[1]!, flowKind: "projects" }]);
    await runUsageQuery(again.client, "projects");
    expect(again.sent).toEqual([reader, first.sent[1]]);
  });

  it("passes a refusal on when this organization holds the one id: nothing else is opened", async () => {
    const { client, sent } = fakeLab(reader, [{ id: reader, flowKind: "projects" }]);
    await expect(runUsageQuery(client, "projects")).rejects.toThrow(/unknown session/);
    expect(sent).toEqual([reader]);
  });
});
