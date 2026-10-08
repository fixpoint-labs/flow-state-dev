/**
 * The names the shell writes down, held to the tree they describe.
 *
 * The rail's kind lists and the panel's board ids are literals in
 * `lib/workforce-shell.ts`, because a browser cannot read `workforce/`. That
 * makes them a second copy, and a copy drifts: add a worker flow or a board to
 * a `MAILBOX.md`, and the rail or the panel silently shows the old one. These
 * cases fail on that drift.
 *
 * Red states produced before these were trusted:
 *   - add a kind to the tree and not to `SEAT_KINDS`: the seat-kind case fails.
 *   - drop `agent`'s entry from `SEAT_ASKS`: the answering-action case fails,
 *     naming the kind with no entry.
 *   - misname `agent`'s field `message`: the answering-action case fails,
 *     naming the field the kind actually takes.
 *   - drop the board from `SHELL_BOARDS`: the board case fails.
 *   - drop the board from `support.help`'s `MAILBOX.md`: the board case and
 *     the mailbox flow's declaration case both fail.
 */
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { MAILBOX_KIND, mailboxBoard, mailboxBoardIds } from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";

import { buildKitchenSinkWorkforce, workforceRoot } from "../workforce/hire";
import { mailboxKinds } from "../workforce/workforce.gen";
import {
  MAILBOX_KINDS,
  defaultConversation,
  SEAT_ASKS,
  SEAT_KINDS,
  SHELL_BOARDS,
  SHELL_MAILBOXES,
  seatAskFor,
} from "../lib/workforce-shell";

describe("the shell's names match the workforce tree", () => {
  it("lists every worker flow the app runs workers on", async () => {
    const { installation } = await buildKitchenSinkWorkforce();
    expect([...SEAT_KINDS].sort()).toEqual(Object.keys(installation.workerFlows()).sort());
  });

  it("lists every mailbox kind: the framework's own, plus the tree's", () => {
    expect([...MAILBOX_KINDS].sort()).toEqual(["mailbox", ...Object.keys(mailboxKinds)].sort());
  });

  it("draws every board the tree's mailboxes declare, under the id the package mints", async () => {
    const { mailboxes, errors } = await readMailboxesDirectory(workforceRoot);
    expect(errors).toEqual([]);
    const declared = mailboxBoardIds(mailboxes);
    // Not vacuous: the tree does declare boards.
    expect(declared.length).toBeGreaterThan(0);
    expect(SHELL_BOARDS.map((board) => board.ref).sort()).toEqual(declared);
    for (const board of SHELL_BOARDS) {
      expect(mailboxBoard(board.mailboxId, board.board).id).toBe(board.ref);
    }
  });

  it("lists every mailbox the tree declares, under the kind its file selects", async () => {
    const { mailboxes, errors } = await readMailboxesDirectory(workforceRoot);
    expect(errors).toEqual([]);
    // Not vacuous: the tree does declare mailboxes.
    expect(mailboxes.length).toBeGreaterThan(0);
    // A file with no `flow:` line selects the built-in kind.
    const declared = mailboxes.map((mailbox) => ({
      id: mailbox.id,
      kind: (mailbox.declared as { flow?: string }).flow ?? MAILBOX_KIND,
    }));
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect(SHELL_MAILBOXES.map(({ id, kind }) => ({ id, kind })).sort(byId)).toEqual(declared.sort(byId));
  });
});

/**
 * The actions of a kind a person could answer through: the public ones whose
 * input is exactly one required string field. Keyed by action, valued by that
 * field's name.
 */
async function oneStringActions(kind: string): Promise<Record<string, string>> {
  const { installation } = await buildKitchenSinkWorkforce();
  const factory = installation.workerFlows()[kind]!.flow as unknown as {
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

  it.each([...SEAT_KINDS])("%s: the named action takes exactly the named one string field, or it has none", async (kind) => {
    const ask = seatAskFor(kind);
    if (ask === undefined) throw new Error(`SEAT_ASKS has no entry for "${kind}"`);
    const actions = await oneStringActions(kind);
    if ("none" in ask) {
      // "None" is only honest where there is truly nothing to answer through.
      expect(actions, `"${kind}" is written down as taking no messages`).toEqual({});
      expect(ask.none.length).toBeGreaterThan(0);
    } else {
      expect(actions[ask.action], `"${kind}"'s one-string actions: ${JSON.stringify(actions)}`).toBe(ask.field);
    }
  });
});

/** Whether `resources` declares `ref` so a browser may read its rows. */
function expectBrowserReadable(resources: Record<string, unknown>, ref: string, flow: string): void {
  const declared = resources[ref] as { client?: { state?: { read?: boolean } } } | undefined;
  expect(declared, `${flow} declares no resource "${ref}"`).toBeDefined();
  expect(declared!.client?.state?.read).toBe(true);
}

describe("each board the panel reads is declared where it reads it", () => {
  // Each board is read through its mailbox's session, so it is the flow that
  // session runs on, the one the mailbox's file selects, that must declare it.
  it.each(SHELL_BOARDS.map((board) => [board.ref, board] as const))(
    "board %s, readable by a browser through its mailbox's session",
    async (_ref, board) => {
      const { mailboxFlows } = await buildKitchenSinkWorkforce();
      const mailbox = SHELL_MAILBOXES.find(({ id }) => id === board.mailboxId);
      expect(mailbox, `SHELL_MAILBOXES has no mailbox "${board.mailboxId}"`).toBeDefined();
      const flow = mailboxFlows.find(({ kind }) => kind === mailbox!.kind);
      expect(flow, `no mailbox flow of kind "${mailbox!.kind}"`).toBeDefined();
      expectBrowserReadable(
        (flow!.resources ?? {}) as Record<string, unknown>,
        board.ref,
        `the "${mailbox!.kind}" mailbox flow`,
      );
    },
  );

  it("uses refs the collection route can address: one path segment each", () => {
    for (const ref of SHELL_BOARDS.map((b) => b.ref)) {
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
