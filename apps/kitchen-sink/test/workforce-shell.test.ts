/**
 * The names the shell writes down, held to the tree they describe.
 *
 * The rail's kind lists, the seats' descriptions and the panel's board ids are
 * literals in `lib/workforce-shell.ts`, because a browser cannot read
 * `workforce/`. That makes them a second copy, and a copy drifts: add a worker
 * kind, reword a `description:`, or add a board to a `CHANNEL.md`, and the
 * rail or the panel silently shows the old one. These cases fail on that drift.
 *
 * Red states produced before these were trusted:
 *   - add a kind to the tree and not to `SEAT_KINDS`: the seat-kind case fails.
 *   - drop `agent`'s entry from `SEAT_ASKS`: the answering-action case fails,
 *     naming the kind with no entry.
 *   - misname `agent`'s field `message`: the answering-action case fails,
 *     naming the field the kind actually takes.
 *   - reword one `description:` in a `WORKER.md`, or drop one entry from
 *     `SEAT_DESCRIPTIONS`: the description case fails, naming the seat.
 *   - drop the board from `SHELL_BOARDS`: the board case fails.
 *   - remove `workforcePanelResources` from the chat-agent flow: the
 *     declaration case fails, which is the state in which every panel read
 *     answers "unknown resource".
 */
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { CHANNEL_KIND, channelBoard, channelBoardIds, HIRED_ROSTER_RESOURCE } from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";

import chatAgentFlow from "../flows/chat-agent/flow";
import { kitchenSinkKinds, workforceRoot } from "../workforce/hire";
import { channelKinds } from "../workforce/workforce.gen";
import {
  CHANNEL_KINDS,
  defaultConversation,
  ROSTER_BOOT_REPORT_REF,
  SEAT_ASKS,
  SEAT_DESCRIPTIONS,
  SEAT_KINDS,
  SHELL_BOARDS,
  SHELL_CHANNELS,
  seatAskFor,
} from "../lib/workforce-shell";

describe("the shell's names match the workforce tree", () => {
  it("lists every seat kind the app can hire into", () => {
    expect([...SEAT_KINDS].sort()).toEqual(Object.keys(kitchenSinkKinds).sort());
  });

  it("carries every declared seat's description as its WORKER.md has it, and no other seat's", async () => {
    const { workers, errors } = await readWorkforce(workforceRoot);
    expect(errors).toEqual([]);
    const declared = Object.fromEntries(
      workers.map((worker) => [worker.id, (worker.declared as { description?: string }).description]),
    );
    // Not vacuous: the tree does declare seats.
    expect(Object.keys(declared).length).toBeGreaterThan(0);
    expect(SEAT_DESCRIPTIONS).toEqual(declared);
  });

  it("lists every channel kind: the framework's own, plus the tree's", () => {
    expect([...CHANNEL_KINDS].sort()).toEqual(["channel", ...Object.keys(channelKinds)].sort());
  });

  it("draws every board the tree's channels declare, under the id the package mints", async () => {
    const { channels, errors } = await readChannelsDirectory(workforceRoot);
    expect(errors).toEqual([]);
    const declared = channelBoardIds(channels);
    // Not vacuous: the tree does declare boards.
    expect(declared.length).toBeGreaterThan(0);
    expect(SHELL_BOARDS.map((board) => board.ref).sort()).toEqual(declared);
    for (const board of SHELL_BOARDS) {
      expect(channelBoard(board.channelId, board.board).id).toBe(board.ref);
    }
  });

  it("lists every channel the tree declares, under the kind its file selects", async () => {
    const { channels, errors } = await readChannelsDirectory(workforceRoot);
    expect(errors).toEqual([]);
    // Not vacuous: the tree does declare channels.
    expect(channels.length).toBeGreaterThan(0);
    // A file with no `flow:` line selects the built-in kind.
    const declared = channels.map((channel) => ({
      id: channel.id,
      kind: (channel.declared as { flow?: string }).flow ?? CHANNEL_KIND,
    }));
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect(SHELL_CHANNELS.map(({ id, kind }) => ({ id, kind })).sort(byId)).toEqual(declared.sort(byId));
  });
});

/**
 * The actions of a kind a person could answer through: the public ones whose
 * input is exactly one required string field. Keyed by action, valued by that
 * field's name.
 */
function oneStringActions(kind: string): Record<string, string> {
  const factory = (kitchenSinkKinds as Record<string, unknown>)[kind] as {
    actions: Record<string, { inputSchema?: ZodTypeAny; block: { inputSchema?: ZodTypeAny } }>;
  };
  const found: Record<string, string> = {};
  for (const [name, action] of Object.entries(factory.actions)) {
    const schema = action.inputSchema ?? action.block.inputSchema;
    if (!(schema instanceof z.ZodObject)) continue;
    const fields = Object.entries(schema.shape as Record<string, ZodTypeAny>);
    if (fields.length === 1 && fields[0]![1] instanceof z.ZodString) found[name] = fields[0]![0];
  }
  return found;
}

describe("each seat kind's composer sends to an action the kind declares", () => {
  it("names every seat kind, and no other", () => {
    expect(Object.keys(SEAT_ASKS).sort()).toEqual([...SEAT_KINDS].sort());
  });

  it.each([...SEAT_KINDS])("%s: the named action takes exactly the named one string field, or it has none", (kind) => {
    const ask = seatAskFor(kind);
    if (ask === undefined) throw new Error(`SEAT_ASKS has no entry for "${kind}"`);
    const actions = oneStringActions(kind);
    if ("none" in ask) {
      // "None" is only honest where there is truly nothing to answer through.
      expect(actions, `"${kind}" is written down as taking no messages`).toEqual({});
      expect(ask.none.length).toBeGreaterThan(0);
    } else {
      expect(actions[ask.action], `"${kind}"'s one-string actions: ${JSON.stringify(actions)}`).toBe(ask.field);
    }
  });
});

describe("the shell's flow declares what the panel reads", () => {
  const resources = (chatAgentFlow as unknown as { resources?: Record<string, unknown> })
    .resources ?? {};

  const cases: [label: string, ref: string][] = [
    ["the roster", HIRED_ROSTER_RESOURCE],
    ["the boot report", ROSTER_BOOT_REPORT_REF],
    ...SHELL_BOARDS.map((board): [string, string] => [`board ${board.ref}`, board.ref]),
  ];

  it.each(cases)("%s, readable by a browser", (_label, ref) => {
    const declared = resources[ref] as { client?: { state?: { read?: boolean } } } | undefined;
    expect(declared, `chat-agent declares no resource "${ref}"`).toBeDefined();
    expect(declared!.client?.state?.read).toBe(true);
  });

  it("uses refs the collection route can address: one path segment each", () => {
    for (const ref of [HIRED_ROSTER_RESOURCE, ROSTER_BOOT_REPORT_REF, ...SHELL_BOARDS.map((b) => b.ref)]) {
      expect(ref).not.toContain("/");
    }
  });
});

describe("the conversation the page opens on", () => {
  // A store kept across the upgrade still holds the session an earlier page's
  // "Hire another" ran on, tagged `seat-hires`. Opening it by default would
  // put the person's turns in that administrative session.
  it("is the most recent, passing over the session an earlier page's hire ran on", () => {
    const hires = { id: "sess-hires", tags: ["seat-hires"] };
    const chat = { id: "sess-chat", tags: [] };
    expect(defaultConversation([hires, chat])?.id).toBe("sess-chat");
    expect(defaultConversation([chat, hires])?.id).toBe("sess-chat");
  });

  it("is none when the hire session is all there is, so the page starts one", () => {
    expect(defaultConversation([{ id: "sess-hires", tags: ["seat-hires"] }])).toBeUndefined();
    expect(defaultConversation([])).toBeUndefined();
  });
});
