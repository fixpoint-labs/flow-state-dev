/**
 * The names the shell and its flow agree on — which kinds the rail groups, and
 * which collections the right panel reads.
 *
 * A leaf module on purpose (BP-019): the page is a client bundle and the flow
 * is server code, and both import these. Nothing here imports anything, so the
 * page gets the names without pulling the flow into the browser.
 *
 * The hired roster's key is not here. It is the workforce package's own
 * `HIRED_ROSTER_RESOURCE`, because the rail's hire runs the package's sequence,
 * which reads the roster under that key; the flow, the panel and the rail
 * import it from the package, whose root is isomorphic.
 *
 * The kind names and board ids are written down rather than derived, because
 * the only place that knows them at run time is the server-side tree under
 * `workforce/`, which a browser cannot read. `test/workforce-shell.test.ts`
 * holds them to that tree and fails when a kind or a board is added there and
 * not here.
 */

/** The flow the stream talks to, and the one whose session the panels read through. */
export const SHELL_FLOW_KIND = "chat-agent";

/**
 * The channel kinds: the framework's own `channel`, plus every kind under
 * `workforce/flows/channels/`.
 */
export const CHANNEL_KINDS = ["channel", "digest"] as const;

/**
 * The seat kinds: the built-in `agent`, plus every kind under
 * `workforce/flows/workers/`.
 */
export const SEAT_KINDS = ["agent", "desk-clerk", "followup-runner"] as const;

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
  "desk-clerk": { action: "answer", field: "note" },
  "followup-runner": {
    none: "This seat runs rows from a board and has nothing to answer with, so it takes no messages.",
  },
} as const satisfies Record<(typeof SEAT_KINDS)[number], SeatAsk>;

/** A seat kind's answer, or `undefined` for a kind the shell does not know. */
export function seatAskFor(kind: string): SeatAsk | undefined {
  return (SEAT_ASKS as Record<string, SeatAsk | undefined>)[kind];
}

/**
 * The tag on the session of the shell's flow that the rail's "Hire another"
 * runs on, so a hire never lands in a conversation. Kept apart by tag, not by
 * flow: every session of the flow binds to the same organization.
 */
export const SEAT_HIRES_TAG = "seat-hires";

/** That session's title, as the rail lists it among the assistant's conversations. */
export const SEAT_HIRES_TITLE = "Seat hires";

/** Whether a listed session is the one hires run on, and so never the conversation opened by default. */
export function isSeatHiresSession(session: { readonly tags?: readonly string[] }): boolean {
  return session.tags?.includes(SEAT_HIRES_TAG) ?? false;
}

/** The key the shell's flow declares the boot's skipped-seat report under. */
export const ROSTER_BOOT_REPORT_REF = "rosterBootReport";

/** Storage prefix of the boot report. One row per organization lives under it. */
export const ROSTER_BOOT_REPORT_PREFIX = "kitchen-sink/roster-boot-report/";

/**
 * The one row a boot writes into each organization it reloaded. A plain
 * string, not the row's schema — the schema needs zod, which would give this
 * leaf module an import, so it lives in `lib/roster-boot-report-schema.ts`
 * instead, where both the boot writer and the flow can reach it.
 */
export const ROSTER_BOOT_REPORT_KEY = `${ROSTER_BOOT_REPORT_PREFIX}latest`;

/**
 * The boards the right panel draws, one per `boards:` entry in the tree's
 * `CHANNEL.md` files.
 *
 * `ref` is the ledger id the workforce package mints for that pair. The flow
 * declares each board through `channelBoard(channelId, board)` rather than
 * from `ref`, and the test checks the two agree.
 */
export const SHELL_BOARDS = [
  { channelId: "support.desk", board: "escalations", ref: "support.desk.escalations" },
  { channelId: "support.desk", board: "followups", ref: "support.desk.followups" },
] as const;

/**
 * The skipped-seat lines in a page of boot-report rows.
 *
 * One row per organization is written, and a session reads only its own
 * organization's, so in practice this is one row's list. A row whose shape is
 * not a list of strings contributes nothing rather than failing the panel.
 *
 * This reads `clientData` with a cast rather than the row's zod schema
 * (`lib/roster-boot-report-schema.ts`): that schema needs zod, and this
 * module's contract (above) is that nothing here imports anything, so the
 * page keeps getting these names without pulling anything else into the
 * browser. The shape checked below — `problems` an array, non-string entries
 * dropped — mirrors what that schema would enforce.
 */
export function problemsFromBootReport(
  items: readonly { readonly clientData?: unknown }[],
): string[] {
  return items.flatMap((item) => {
    const report = item.clientData as { problems?: unknown } | undefined;
    return Array.isArray(report?.problems)
      ? report.problems.filter((line): line is string => typeof line === "string")
      : [];
  });
}
