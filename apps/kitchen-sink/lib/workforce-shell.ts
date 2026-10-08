/**
 * The names the shell and its flow agree on — which kinds the rail groups,
 * what a worker's composer sends, and which boards the right panel reads.
 *
 * A leaf module on purpose (BP-019): the page is a client bundle and the flow
 * is server code, and both import these. Nothing here imports anything, so the
 * page gets the names without pulling the flow into the browser.
 *
 * The workers themselves are not here: the right panel reads the person's
 * roster through Workforce's client (`@flow-state-dev/workforce/browser`),
 * which answers with each worker's flow and description.
 *
 * The kind names and board ids are written down rather than derived, because
 * the only place that knows them at run time is the server-side tree under
 * `workforce/`, which a browser cannot read. `test/workforce-shell.test.ts`
 * holds them to that tree and fails when a kind or a board changes there and
 * not here.
 */

/** The flow the stream talks to. */
export const SHELL_FLOW_KIND = "chat-agent";

/**
 * The mailbox kinds: the framework's own `mailbox`, plus every kind under
 * `workforce/flows/mailboxes/`, of which this app has none.
 */
export const MAILBOX_KINDS = ["mailbox"] as const;

/** Whether a picked flow kind is a mailbox kind, whose panel shows a transcript rather than a conversation. */
export function isMailboxKind(kind: string): boolean {
  return (MAILBOX_KINDS as readonly string[]).includes(kind);
}

/**
 * The mailboxes the tree declares, each with the kind its `MAILBOX.md` selects:
 * what the rail lists under that kind. A store kept across an upgrade can still
 * hold the sessions of mailboxes the tree no longer declares, so the rail reads
 * these by id rather than listing the kind (`lib/rail-sessions.ts`).
 */
export const SHELL_MAILBOXES = [{ id: "support.help", kind: "mailbox" }] as const;

/**
 * The worker flows: the built-in `agent`, plus every flow under
 * `workforce/flows/workers/`, of which this app has none. Each runs as one
 * copy, holding every worker's conversations on it.
 */
export const SEAT_KINDS = ["agent"] as const;

/**
 * What a seat's composer sends: the one action its kind answers a person with,
 * and that action's one input field. A kind with nothing to answer with says
 * so instead, and its seats get no composer, only this reason.
 */
export type SeatAsk =
  | { readonly action: string; readonly field: string }
  | { readonly none: string };

/**
 * Each seat kind's answer, written down rather than picked from the served
 * schemas: a kind that grew a second one-string action would be picked from
 * silently, where a missing or wrong entry here fails
 * `test/workforce-shell.test.ts` instead.
 */
export const SEAT_ASKS = {
  agent: { action: "run", field: "message" },
} as const satisfies Record<(typeof SEAT_KINDS)[number], SeatAsk>;

/**
 * The worker a mailbox woke, read off the run's `topic`: the key Workforce's
 * wake derives each worker's conversation from, `mailbox:<mailbox>:<worker>`.
 * Every worker on a flow shares its copy, so the run's `flowId` names the
 * flow (`agent`), not the worker. `undefined` for any other run.
 */
export function wokenWorkerOf(run: { readonly topic?: string }): string | undefined {
  const match = /^mailbox:[^:]+:(.+)$/.exec(run.topic ?? "");
  return match?.[1];
}

/** A seat kind's answer, or `undefined` for a kind the shell does not know. */
export function seatAskFor(kind: string): SeatAsk | undefined {
  return (SEAT_ASKS as Record<string, SeatAsk | undefined>)[kind];
}

/**
 * The tag an earlier version of this page put on the assistant session its
 * "Hire another" ran on. The button is gone, but a store kept across the
 * upgrade still holds that session, and it must never be the conversation the
 * page opens by default (BP-030).
 */
export const LEGACY_SEAT_HIRES_TAG = "seat-hires";

/**
 * The conversation the page opens on: the most recent of the assistant's
 * sessions, passing over one an earlier page's hire ran on. `undefined` when
 * there is none, and the page starts a new one.
 *
 * @param sessions The assistant's sessions, newest first.
 */
export function defaultConversation<T extends { readonly tags?: readonly string[] }>(
  sessions: readonly T[],
): T | undefined {
  return sessions.find((session) => !(session.tags?.includes(LEGACY_SEAT_HIRES_TAG) ?? false));
}

/**
 * The boards the right panel draws, one per `boards:` entry in the tree's
 * `MAILBOX.md` files.
 *
 * `ref` is the ledger id the workforce package mints for that pair. The panel
 * reads each board through its mailbox's session, whose flow declares it under
 * that id, and the test checks the two agree.
 */
export const SHELL_BOARDS = [
  { mailboxId: "support.help", board: "escalations", ref: "support.help.escalations" },
] as const;
