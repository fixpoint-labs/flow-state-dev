/**
 * The names the shell and its flow agree on — which kinds the rail groups,
 * what each declared seat handles, and which collections the right panel reads.
 *
 * A leaf module on purpose (BP-019): the page is a client bundle and the flow
 * is server code, and both import these. Nothing here imports anything, so the
 * page gets the names without pulling the flow into the browser.
 *
 * The hired roster's key is not here. It is the workforce package's own
 * `HIRED_ROSTER_RESOURCE`, because the operator's hire runs the package's
 * sequence, which writes the roster under that key; the flow imports it from
 * the package root, and the panels from `@flow-state-dev/workforce/browser`,
 * because the root is server code (`test/client-imports.test.ts`).
 *
 * The kind names, seat descriptions and board ids are written down rather than
 * derived, because the only place that knows them at run time is the
 * server-side tree under `workforce/`, which a browser cannot read.
 * `test/workforce-shell.test.ts` holds them to that tree and fails when a
 * kind, a seat's description or a board changes there and not here.
 */

/** The flow the stream talks to, and the one whose session the panels read through. */
export const SHELL_FLOW_KIND = "chat-agent";

/**
 * The channel kinds: the framework's own `channel`, plus every kind under
 * `workforce/flows/channels/`, of which this app has none.
 */
export const CHANNEL_KINDS = ["channel"] as const;

/** Whether a picked flow kind is a channel kind, whose panel shows a transcript rather than a conversation. */
export function isChannelKind(kind: string): boolean {
  return (CHANNEL_KINDS as readonly string[]).includes(kind);
}

/**
 * The channels the tree declares, each with the kind its `CHANNEL.md` selects:
 * what the rail lists under that kind. A store kept across an upgrade can still
 * hold the sessions of channels the tree no longer declares, so the rail reads
 * these by id rather than listing the kind (`lib/rail-sessions.ts`).
 */
export const SHELL_CHANNELS = [{ id: "support.help", kind: "channel" }] as const;

/**
 * The seat kinds: the built-in `agent`, plus every kind under
 * `workforce/flows/workers/`, of which this app has none.
 */
export const SEAT_KINDS = ["agent"] as const;

/**
 * What each declared seat handles: its `WORKER.md`'s `description:`, by the
 * seat's address. The route reads the same line to pick who answers a post, so
 * the rail shows a person what the route reads.
 */
export const SEAT_DESCRIPTIONS = {
  "support.devices": "Printers, laptops, phones, wifi and anything else with a power button.",
  "support.accounts": "Sign-in, passwords, billing, refunds and subscriptions.",
  "support.fsd": "Questions about building apps with the flow-state-dev framework.",
  "support.general": "Anything that fits none of the other specialists.",
} as const;

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
  { channelId: "support.help", board: "escalations", ref: "support.help.escalations" },
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
