/**
 * The names the shell and its flow agree on — which kinds the rail groups, and
 * which collections the right panel reads.
 *
 * A leaf module on purpose (BP-019): the page is a client bundle and the flow
 * is server code, and both import these. Nothing here imports anything, so the
 * page gets the names without pulling the flow, or the workforce package, into
 * the browser.
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
 * The key the shell's flow declares the hired roster under. One path segment,
 * because the collection read route takes no slash in a ref.
 */
export const ROSTER_REF = "roster";

/** The key the shell's flow declares the boot's skipped-seat report under. */
export const ROSTER_BOOT_REPORT_REF = "rosterBootReport";

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
