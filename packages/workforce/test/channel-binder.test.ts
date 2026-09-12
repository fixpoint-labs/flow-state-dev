/**
 * Registration and binding — the two phases, and the closed door in front of
 * them.
 *
 * `channelInstances` is build time and synchronous; `openChannels` needs a
 * running host. They are separate because those are two different moments, not
 * because the work divides neatly.
 *
 * The refusals matter more than the happy path here. The session route parses
 * caller state against the flow's `stateSchema` but falls back to the caller's
 * RAW state when the parse fails — validation happens at action-execution time,
 * not session-create time — so the schema refuses nothing at open. Every
 * refusal a `configSchema` used to give for free is the binder's job now.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  CHANNEL_KIND,
  channelInstances,
  createChannelFlow,
  openChannels,
  type ChannelManifest
} from "../src/index";

function record(
  id: string,
  declared: Record<string, unknown> = {},
  body = "Say what you finished."
): ChannelManifest {
  return { id, declared, body };
}

/** A custom kind under the same contract the built-in carries. */
function customKind(kind: string) {
  return defineFlow({
    kind,
    cardinality: "singleton",
    session: {
      stateSchema: z.object({
        members: z.array(z.string()),
        instructions: z.string(),
        transcript: z.array(z.unknown()).default([])
      })
    },
    actions: {
      post: {
        block: handler({
          name: `${kind}-post`,
          inputSchema: z.object({ body: z.string() }),
          outputSchema: z.object({}),
          execute: () => ({})
        })
      }
    }
  });
}

describe("channelInstances", () => {
  it("seeds the built-in, so a roster that names no kind yields exactly one instance", () => {
    const instances = channelInstances([
      record("engineering.standup", { members: ["engineering.lead"] }),
      record("engineering.triage", { members: ["engineering.lead"] })
    ]);

    expect(instances).toHaveLength(1);
    expect(instances[0]?.id).toBe(CHANNEL_KIND);
    expect(instances[0]?.kind).toBe(CHANNEL_KIND);
    expect(instances[0]?.cardinality).toBe("singleton");
  });

  it("gives two records naming one custom kind a single shared instance", () => {
    const instances = channelInstances(
      [
        record("eng.a", { flow: "my-channel" }),
        record("eng.b", { flow: "my-channel" })
      ],
      { kinds: { "my-channel": customKind("my-channel") } }
    );

    expect(instances.map((i) => i.id)).toEqual(["my-channel"]);
  });

  it("yields one instance per distinct kind, the built-in included", () => {
    const instances = channelInstances(
      [record("eng.a"), record("eng.b", { flow: "my-channel" })],
      { kinds: { "my-channel": customKind("my-channel") } }
    );

    expect(instances.map((i) => i.id).sort()).toEqual(["channel", "my-channel"]);
  });

  it("lets a caller replace the built-in wholesale under its own key", () => {
    const replacement = createChannelFlow({
      notify: handler({
        name: "notify",
        inputSchema: z.unknown(),
        outputSchema: z.object({}),
        execute: () => ({})
      })
    });
    const instances = channelInstances([record("eng.a")], { kinds: { channel: replacement } });

    expect(instances).toHaveLength(1);
    expect(instances[0]?.internal?.actions.onPosted).toBeDefined();
  });

  it("refuses a named-but-unregistered kind by name, never falling back to the built-in", () => {
    expect(() => channelInstances([record("eng.a", { flow: "nope" })])).toThrow(/"nope"/);
    expect(() => channelInstances([record("eng.a", { flow: "nope" })])).toThrow(
      /not passed to channelInstances/
    );
  });

  it("refuses a factory filed under a key that is not its own kind", () => {
    expect(() =>
      channelInstances([record("eng.a", { flow: "mine" })], {
        kinds: { mine: customKind("actually-other") }
      })
    ).toThrow(/run a different channel's graph/);
  });

  it("refuses a duplicate id: a channel's id is its session id", () => {
    expect(() => channelInstances([record("eng.a"), record("eng.a")])).toThrow(/declared twice/);
  });

  it("names every bad record in one run rather than the first", () => {
    let message = "";
    try {
      channelInstances([
        record("eng.b", { flow: "nope" }),
        record("eng.a", { system: true }),
        record("eng.c", { colour: "blue" })
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("eng.a");
    expect(message).toContain("eng.b");
    expect(message).toContain("eng.c");
    expect(message).toContain("refused 3 of 3");
  });
});

describe("what a channel record may declare (the closed key list)", () => {
  it("refuses a frontmatter `id:` — a channel's id is its identity, not a setting", () => {
    expect(() => channelInstances([record("eng.a", { id: "somewhere.else" })])).toThrow(/`id:`/);
  });

  it("consumes and strips `flow:` rather than refusing it", () => {
    expect(() => channelInstances([record("eng.a", { flow: CHANNEL_KIND })])).not.toThrow();
  });

  it("refuses `instructions:` alongside a body — two sources, no precedence rule", () => {
    expect(() =>
      channelInstances([record("eng.a", { instructions: "from frontmatter" }, "from the body")])
    ).toThrow(/two sources/);
  });

  it("refuses `system:`", () => {
    expect(() => channelInstances([record("eng.a", { system: true })])).toThrow(/`system:`/);
  });

  it("refuses a key the kind never declared", () => {
    expect(() => channelInstances([record("eng.a", { colour: "blue" })])).toThrow(/`colour`/);
  });

  it("refuses a `members:` that is not a list of names", () => {
    expect(() => channelInstances([record("eng.a", { members: "engineering.lead" })])).toThrow(
      /members/
    );
  });
});

describe("openChannels", () => {
  function sessionClient() {
    const created: Array<Record<string, unknown>> = [];
    const existing = new Set<string>();
    const createSession = vi.fn(async (options: Record<string, unknown>) => {
      const id = String(options.sessionId);
      if (existing.has(id)) {
        throw Object.assign(new Error(`Request failed (409)`), { status: 409 });
      }
      existing.add(id);
      created.push(options);
      return { id };
    });
    return { client: { createSession }, created, existing };
  }

  it("opens one named session per record, carrying that channel's members and charter", async () => {
    const { client, created } = sessionClient();

    await openChannels(
      [
        record(
          "engineering.standup",
          { members: ["engineering.lead", "engineering.analyst"], description: "Daily status." },
          "Post what you finished."
        )
      ],
      { client, userId: "u_42" }
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      flowKind: CHANNEL_KIND,
      sessionId: "engineering.standup",
      userId: "u_42",
      description: "Daily status.",
      state: {
        members: ["engineering.lead", "engineering.analyst"],
        instructions: "Post what you finished.",
        transcript: []
      }
    });
  });

  it("opens a custom kind's channel on that kind's own instance", async () => {
    const { client, created } = sessionClient();
    await openChannels([record("eng.a", { flow: "my-channel" })], { client, userId: "u_42" });
    expect(created[0]).toMatchObject({ flowKind: "my-channel", sessionId: "eng.a" });
  });

  it("treats a 409 as already open, so re-running over an unchanged roster changes nothing", async () => {
    const { client, created } = sessionClient();
    const roster = [record("engineering.standup", { members: ["a"] })];

    await openChannels(roster, { client, userId: "u_42" });
    await expect(openChannels(roster, { client, userId: "u_42" })).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(1);
  });

  it("does not swallow a failure that is not a 409", async () => {
    const client = {
      createSession: vi.fn(async () => {
        throw Object.assign(new Error("Request failed (500)"), { status: 500 });
      })
    };
    await expect(
      openChannels([record("engineering.standup")], { client, userId: "u_42" })
    ).rejects.toThrow(/500/);
  });
});
