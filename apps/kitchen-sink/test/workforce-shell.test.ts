/**
 * The names the shell writes down, held to the tree they describe.
 *
 * The rail's kind lists and the panel's board ids are literals in
 * `lib/workforce-shell.ts`, because a browser cannot read `workforce/`. That
 * makes them a second copy, and a copy drifts: add a worker kind, or a board
 * to a `CHANNEL.md`, and the rail or the panel silently stops showing it.
 * These cases fail on that drift.
 *
 * Red states produced before these were trusted:
 *   - drop `followup-runner` from `SEAT_KINDS`: the seat-kind case fails.
 *   - drop `followup-runner`'s entry from `SEAT_ASKS`: the answering-action
 *     case fails, naming the kind with no entry.
 *   - misname `desk-clerk`'s field `note`: the answering-action case fails,
 *     naming the field the kind actually takes.
 *   - drop one board from `SHELL_BOARDS`: the board case fails.
 *   - remove `workforcePanelResources` from the chat-agent flow: the
 *     declaration case fails, which is the state in which every panel read
 *     answers "unknown resource".
 *   - misname `agent`'s wake `onChannelPost`: the wake case fails, naming the
 *     receiver the kind actually declares.
 *   - drop `followup-runner`'s wake: the wake case fails, naming the kind.
 */
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import {
  channelBoard,
  channelBoardIds,
  channelNotifyInputSchema,
  HIRED_ROSTER_RESOURCE,
} from "@flow-state-dev/workforce";
import { readChannelsDirectory } from "@flow-state-dev/workforce/loader";

import chatAgentFlow from "../flows/chat-agent/flow";
import { kitchenSinkKinds, workforceRoot } from "../workforce/hire";
import { channelKinds } from "../workforce/workforce.gen";
import {
  CHANNEL_KINDS,
  ROSTER_BOOT_REPORT_REF,
  SEAT_ASKS,
  SEAT_KINDS,
  SHELL_BOARDS,
  seatAskFor,
  seatWakeFor,
} from "../lib/workforce-shell";

describe("the shell's names match the workforce tree", () => {
  it("lists every seat kind the app can hire into", () => {
    expect([...SEAT_KINDS].sort()).toEqual(Object.keys(kitchenSinkKinds).sort());
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

/**
 * The internal entries of a kind that take a channel's delivery: the ones a
 * notify block can wake a seat of that kind through.
 */
function channelReceivers(kind: string): string[] {
  const factory = (kitchenSinkKinds as Record<string, unknown>)[kind] as {
    internal?: { actions: Record<string, { inputSchema?: ZodTypeAny }> };
  };
  return Object.entries(factory.internal?.actions ?? {})
    .filter(([, entry]) => entry.inputSchema === channelNotifyInputSchema)
    .map(([name]) => name);
}

describe("each seat kind's wake names a channel receiver the kind declares", () => {
  it.each([...SEAT_KINDS])("%s: the wake is one of its receivers, or none only where it has none", (kind) => {
    const wake = seatWakeFor(kind);
    if (wake === undefined) throw new Error(`SEAT_ASKS gives "${kind}" no wake; write its receiver, or null`);
    const receivers = channelReceivers(kind);
    if (wake === null) {
      // "None" is only honest where there is truly no receiver to wake.
      expect(receivers, `"${kind}" is written down as waking on nothing`).toEqual([]);
    } else {
      expect(receivers, `"${kind}"'s channel receivers`).toContain(wake);
    }
  });

  it("is not vacuous: some kind wakes", () => {
    expect(SEAT_KINDS.some((kind) => seatWakeFor(kind) != null)).toBe(true);
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
