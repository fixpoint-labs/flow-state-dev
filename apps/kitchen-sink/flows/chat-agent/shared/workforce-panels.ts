/**
 * The collections the shell's right panel reads, declared on the shell's flow.
 *
 * A panel read resolves its ref against the reading session's own flow, so the
 * shell can only show the roster and the boards if `chat-agent` declares them.
 * Each one is org-scoped, so a chat-agent session reads its own
 * organization's rows and no other's.
 *
 * - `roster` — the hired roster, from the same factory the admin flow and the
 *   boot reload use, so there is one declaration of that contract.
 * - `rosterBootReport` — what the last boot could not bring back, one row per
 *   organization. The boot writes it (`lib/roster-reload-report.ts`); nothing
 *   in this flow does. The key and the row's schema are declared in
 *   `lib/` (`workforce-shell.ts` and `roster-boot-report-schema.ts`), since
 *   the boot writer must reach them without importing this flow module.
 * - One ledger per board in `SHELL_BOARDS`, declared through `channelBoard` so
 *   it is the same declaration the channel itself holds.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { channelBoard, defineHiredRosterCollection } from "@flow-state-dev/workforce";

import { rosterBootReportSchema } from "@/lib/roster-boot-report-schema";
import {
  ROSTER_BOOT_REPORT_PREFIX,
  ROSTER_BOOT_REPORT_REF,
  ROSTER_REF,
  SHELL_BOARDS,
} from "@/lib/workforce-shell";

/**
 * Org-scoped and shared across flows: the boot writes it with no flow at all,
 * so a flow-isolated key would be one the boot cannot address.
 */
export const rosterBootReportCollection = defineResourceCollection({
  pattern: `${ROSTER_BOOT_REPORT_PREFIX}*`,
  scope: "org",
  flowIsolation: false,
  stateSchema: rosterBootReportSchema,
  client: { state: { read: true }, expose: ["problems"] },
});

/** Spread into the shell flow's `resources`. */
export const workforcePanelResources = {
  [ROSTER_REF]: defineHiredRosterCollection(),
  [ROSTER_BOOT_REPORT_REF]: rosterBootReportCollection,
  ...Object.fromEntries(
    SHELL_BOARDS.map(({ channelId, board }) => {
      const ledger = channelBoard(channelId, board);
      return [ledger.id, ledger];
    }),
  ),
};
