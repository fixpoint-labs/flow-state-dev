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
  channelBoardId,
  channelBoardIds,
  channelInstances,
  defineChannelFlow,
  type ChannelKind,
  type ChannelManifest
} from "../src/index";

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
    const instances = channelInstances([record("eng.feature", { boards: ["work"] })]);

    expect(instances).toHaveLength(1);
    const resources = instances[0]!.resources as Record<string, { pattern: string; scope: string }>;
    expect(Object.keys(resources)).toContain("eng.feature.work");
    expect(resources["eng.feature.work"]!.scope).toBe("org");
    // `<id>/**`, not `<id>/*` — a task id may carry a slash.
    expect(resources["eng.feature.work"]!.pattern).toBe("eng.feature.work/**");
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
        record("eng.a", { boards: { id: "work" } }),
        record("eng.b", { boards: [{ name: "work" }] }),
        record("eng.c", { boards: 3 })
      ])
    ).toThrow(/eng\.a[\s\S]*eng\.b[\s\S]*eng\.c/);
    // Not the closed-key refusal wearing a disguise: `boards` IS declarable,
    // so what must be named is the shape rule.
    expect(() => channelInstances([record("eng.a", { boards: { id: "work" } })])).toThrow(
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

  it("refuses two channels that would mint one id, naming both", () => {
    // Only reachable because a board name may not carry a dot; the pair below
    // is the collision that is left — the same channel declared twice is
    // already refused one rule earlier.
    expect(() =>
      channelInstances([
        record("eng.feature", { boards: ["work", "work"] })
      ])
    ).toThrow(/eng\.feature\.work/);
  });

  it("refuses `boards:` on a kind the framework did not build, by name", () => {
    let thrown: unknown;
    try {
      channelInstances([record("eng.feature", { boards: ["work"], flow: "custom-channel" })], {
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
    expect(() => channelInstances([record("eng.a", { board: ["work"] })])).toThrow(/`board`/);
  });
});

describe("the minted ledger", () => {
  it("is ONE declaration object, shared by the channel and by a seat's helper", () => {
    // The assignee freeze is a WeakSet on the declaration, so two objects
    // sharing an id share rows and not policy. Give the seat helper its own
    // `defineTaskCollection` call and this is the assertion that goes red.
    const instances = channelInstances([record("eng.feature", { boards: ["work"] })]);
    const declared = (instances[0]!.resources as Record<string, unknown>)["eng.feature.work"];
    expect(declared).toBe(channelBoard("eng.feature", "work"));
  });

  it("carries its own minted id, so a caller declares one thing", () => {
    const work = channelBoard("eng.feature", "work");
    expect(work.id).toBe(channelBoardId("eng.feature", "work"));
    expect(work.id).toBe("eng.feature.work");
  });

  it("refuses a bad name at the seat helper too, not only at bind", () => {
    expect(() => channelBoard("eng.feature", "has.dot")).toThrow(/board name/i);
  });
});

describe("the roster's minted ids", () => {
  it("are what a hire-time check is handed, one per declared board", () => {
    expect(
      channelBoardIds([
        record("eng.feature", { boards: ["work", "review"] }),
        record("eng.quiet"),
        record("mkt.launch", { boards: ["work"] })
      ])
    ).toEqual(["eng.feature.review", "eng.feature.work", "mkt.launch.work"]);
  });
});

describe("the built-in kind's own surface", () => {
  it("adds the board actions only when it was built holding one", () => {
    const boardless = defineChannelFlow()();
    expect(Object.keys(boardless.actions)).toEqual(["post", "read"]);

    const holding = defineChannelFlow({ boards: ["eng.feature.work"] })();
    expect(Object.keys(holding.actions)).toContain("fileTask");
    expect(Object.keys(holding.actions)).toContain("readBoard");
  });

  it("is still the singleton kind, whatever it holds", () => {
    const holding = defineChannelFlow({ boards: ["eng.feature.work"] })();
    expect(holding.kind).toBe(CHANNEL_KIND);
    expect(holding.id).toBe(CHANNEL_KIND);
  });
});
