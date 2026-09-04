import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TALK_HISTORY_CAP,
  lastTalkPath,
  readTalk,
  talkLinesFromActivity,
  writeTalk,
} from "../src/conductor/talk-history";

describe("lastTalkPath", () => {
  it("puts the sidecar next to the config's .fsdev store", () => {
    expect(lastTalkPath("/lab/fsdev.config.ts", "conductor-operator")).toBe(
      "/lab/.fsdev/tui-talk-conductor-operator",
    );
  });

  it("scopes the sidecar to the epic so two boards do not share a transcript", () => {
    expect(lastTalkPath("/lab/fsdev.config.ts", "conductor-operator", "harness-manager")).toBe(
      "/lab/.fsdev/tui-talk-conductor-operator__harness-manager",
    );
  });
});

describe("talkLinesFromActivity", () => {
  it("keeps only board talk, not a child request or a status poll", () => {
    expect(
      talkLinesFromActivity([
        { at: 1, text: "you · what's on the board?" },
        { at: 2, text: "coord · No rows yet." },
        { at: 3, text: "status · claiming" },
        { at: 4, text: "seeded LIVE-1 → live-1--implement" },
        { at: 5, text: "tool · Write src/a.ts", requestId: "req-1" },
        { at: 6, text: "message · two rows, both pending" },
      ]),
    ).toEqual([
      { at: 1, text: "you · what's on the board?" },
      { at: 2, text: "coord · No rows yet." },
      { at: 6, text: "message · two rows, both pending" },
    ]);
  });
});

describe("readTalk / writeTalk", () => {
  it("returns empty when the sidecar is missing", () => {
    expect(readTalk(join(tmpdir(), "conductor-no-such-talk"))).toEqual([]);
  });

  it("round-trips talk lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-talk-"));
    const path = join(dir, ".fsdev", "tui-talk-conductor-operator");
    writeTalk(path, [
      { at: 1, text: "you · what's on the board?" },
      { at: 2, text: "coord · No rows yet." },
    ]);
    expect(readTalk(path)).toEqual([
      { at: 1, text: "you · what's on the board?" },
      { at: 2, text: "coord · No rows yet." },
    ]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([
      { at: 1, text: "you · what's on the board?" },
      { at: 2, text: "coord · No rows yet." },
    ]);
  });

  it("does not write an empty history", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-talk-"));
    const path = join(dir, "tui-talk");
    writeTalk(path, [{ at: 1, text: "status · claiming" }]);
    expect(readTalk(path)).toEqual([]);
  });

  it("treats invalid JSON as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-talk-"));
    const path = join(dir, "tui-talk");
    writeFileSync(path, "not-json\n");
    expect(readTalk(path)).toEqual([]);
  });

  it("skips a string array so a drafts sidecar cannot be read as talk", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-talk-"));
    const path = join(dir, "tui-talk");
    writeFileSync(path, `${JSON.stringify(["you · leftover"])}\n`);
    expect(readTalk(path)).toEqual([]);
  });

  it("keeps only the newest cap on read and write", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-talk-"));
    const path = join(dir, "tui-talk");
    const extra = Array.from({ length: TALK_HISTORY_CAP + 2 }, (_, i) => ({
      at: i,
      text: `you · line-${i}`,
    }));
    writeTalk(path, extra);
    const kept = readTalk(path);
    expect(kept).toHaveLength(TALK_HISTORY_CAP);
    expect(kept[0]?.text).toBe("you · line-2");
    expect(kept.at(-1)?.text).toBe(`you · line-${TALK_HISTORY_CAP + 1}`);
  });
});
