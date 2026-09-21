/**
 * Declaring a board on a channel: the key, the minted id, and every way a
 * declaration is refused.
 *
 * The negative controls matter more than the positives here. A bind-time
 * refusal that is never watched go red is a check you could delete without
 * noticing, so each block below says what it would take to make it pass
 * hollowly.
 */
import { describe, expect, it } from "vitest";
import {
  CHANNEL_KIND,
  channelBoard,
  channelBoardIds,
  channelInstances,
  defineChannelFlow,
  type ChannelKind,
  type ChannelManifest
} from "../src/index";
// Package-internal, deliberately: `channelBoardId` is the join the framework
// mints with, not a call an app makes.
import { channelBoardId, channelBoardNamesFor } from "../src/channel/channel-board";

function record(id: string, declared: Record<string, unknown> = {}): ChannelManifest {
  return { id, declared, body: "Charter." };
}

/** A channel kind that is NOT `defineChannelFlow`'s — the BR-6 subject. */
const customKind = Object.assign(
  () => defineChannelFlow()(),
  { kind: "custom-channel" }
) as unknown as ChannelKind;

describe("declaring a board", () => {
  it("mints `<channelId>.<name>` and declares it on the built-in kind, at org scope", () => {
    const instances = channelInstances([record("eng.feature", { boards: ["triage"] })]);

    expect(instances).toHaveLength(1);
    const resources = instances[0]!.resources as Record<string, { pattern: string; scope: string }>;
    expect(Object.keys(resources)).toContain("eng.feature.triage");
    expect(resources["eng.feature.triage"]!.scope).toBe("org");
    // `<id>/**`, not `<id>/*` — a task id may carry a slash.
    expect(resources["eng.feature.triage"]!.pattern).toBe("eng.feature.triage/**");
  });

  it("holds none, and declares no board resource, when the file names no board", () => {
    const instances = channelInstances([record("eng.quiet")]);
    const resources = (instances[0]!.resources ?? {}) as Record<string, unknown>;
    expect(Object.keys(resources)).toEqual([]);
  });

  it("refuses a `boards:` that is not a list of plain names, naming the channel", () => {
    // Three shapes in one roster: one run must name all three, because a
    // roster that boots short is a team missing a board with nothing said.
    expect(() =>
      channelInstances([
        record("eng.a", { boards: { id: "triage" } }),
        record("eng.b", { boards: [{ name: "triage" }] }),
        record("eng.c", { boards: 3 })
      ])
    ).toThrow(/eng\.a[\s\S]*eng\.b[\s\S]*eng\.c/);
    // Not the closed-key refusal wearing a disguise: `boards` IS declarable,
    // so what must be named is the shape rule.
    expect(() => channelInstances([record("eng.a", { boards: { id: "triage" } })])).toThrow(
      /list of plain names/
    );
  });

  it("refuses a board name that is unusable as a collection id, with the rule", () => {
    for (const bad of ["", "with space", "deep/name", "star*", "has.dot", "__proto__"]) {
      expect(() => channelInstances([record("eng.a", { boards: [bad] })])).toThrow(
        /board name/i
      );
    }
  });

  it("refuses one channel that declares the same board name twice, naming the minted id", () => {
    // Named for what it checks. The cross-channel arm of the same guard is NOT
    // exercised here and cannot be from a roster this package builds: channel
    // ids are unique and a board name carries no dot, so two different
    // channels cannot mint one id. See the note at that arm.
    expect(() =>
      channelInstances([record("eng.feature", { boards: ["triage", "triage"] })])
    ).toThrow(/eng\.feature\.triage/);
  });

  it("keeps one channel's boards out of another's, when one id prefixes the other", () => {
    // `eng` holding `feature` mints `eng.feature`, which is also the PREFIX of
    // `eng.feature`'s own boards. The filter that keeps them apart rejects a
    // remainder carrying a dot; without it `eng` would report `feature.triage`
    // as one of its own boards and resolve a ledger belonging to a different
    // channel. Hand-built ids, because a file tree cannot produce this pair.
    const ids = channelBoardIds([
      { id: "eng", declared: { members: [], boards: ["feature"] }, body: "b" },
      { id: "eng.feature", declared: { members: [], boards: ["triage"] }, body: "b" }
    ]);
    expect(ids).toEqual(["eng.feature", "eng.feature.triage"]);

    expect(channelBoardNamesFor("eng", ids)).toEqual(["feature"]);
    expect(channelBoardNamesFor("eng.feature", ids)).toEqual(["triage"]);
  });


  it("refuses `boards:` on a kind the framework did not build, by name", () => {
    let thrown: unknown;
    try {
      channelInstances([record("eng.feature", { boards: ["triage"], flow: "custom-channel" })], {
        kinds: { "custom-channel": customKind }
      });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain("eng.feature");
    expect(String(thrown)).toContain("custom-channel");
    expect(String(thrown)).toMatch(/board/i);
  });

  it("still refuses a key that is not declarable, now that the list has grown", () => {
    // The closed list gained one member; it did not stop being closed.
    expect(() => channelInstances([record("eng.a", { board: ["triage"] })])).toThrow(/`board`/);
  });
});

describe("the minted ledger", () => {
  it("is ONE declaration object, shared by the channel and by a seat's helper", () => {
    // The assignee freeze is a WeakSet on the declaration, so two objects
    // sharing an id share rows and not policy. Give the seat helper its own
    // `defineTaskCollection` call and this is the assertion that goes red.
    const instances = channelInstances([record("eng.feature", { boards: ["triage"] })]);
    const declared = (instances[0]!.resources as Record<string, unknown>)["eng.feature.triage"];
    expect(declared).toBe(channelBoard("eng.feature", "triage"));
  });

  it("carries its own minted id, so a caller declares one thing", () => {
    const board = channelBoard("eng.feature", "triage");
    expect(board.id).toBe(channelBoardId("eng.feature", "triage"));
    expect(board.id).toBe("eng.feature.triage");
  });

  it("refuses a bad name at the seat helper too, not only at bind", () => {
    expect(() => channelBoard("eng.feature", "has.dot")).toThrow(/board name/i);
  });
});

describe("the roster's minted ids", () => {
  it("are what a hire-time check is handed, one per declared board", () => {
    expect(
      channelBoardIds([
        record("eng.feature", { boards: ["triage", "review"] }),
        record("eng.quiet"),
        record("mkt.launch", { boards: ["triage"] })
      ])
    ).toEqual(["eng.feature.review", "eng.feature.triage", "mkt.launch.triage"]);
  });
});

describe("the built-in kind's own surface", () => {
  it("adds the board actions only when it was built holding one", () => {
    const boardless = defineChannelFlow()();
    expect(Object.keys(boardless.actions)).toEqual(["post", "read"]);

    const holding = defineChannelFlow({ boards: ["eng.feature.triage"] })();
    expect(Object.keys(holding.actions)).toContain("fileTask");
    expect(Object.keys(holding.actions)).toContain("readBoard");
  });

  it("is still the singleton kind, whatever it holds", () => {
    const holding = defineChannelFlow({ boards: ["eng.feature.triage"] })();
    expect(holding.kind).toBe(CHANNEL_KIND);
    expect(holding.id).toBe(CHANNEL_KIND);
  });
});
