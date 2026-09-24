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
 *   - drop one board from `SHELL_BOARDS`: the board case fails.
 *   - remove `workforcePanelResources` from the chat-agent flow: the
 *     declaration case fails, which is the state in which every panel read
 *     answers "unknown resource".
 */
import { describe, expect, it } from "vitest";
import { channelBoard, channelBoardIds, HIRED_ROSTER_RESOURCE } from "@flow-state-dev/workforce";
import { readChannelsDirectory } from "@flow-state-dev/workforce/loader";

import chatAgentFlow from "../flows/chat-agent/flow";
import { kitchenSinkKinds, workforceRoot } from "../workforce/hire";
import { channelKinds } from "../workforce/workforce.gen";
import {
  CHANNEL_KINDS,
  ROSTER_BOOT_REPORT_REF,
  SEAT_KINDS,
  SHELL_BOARDS,
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
