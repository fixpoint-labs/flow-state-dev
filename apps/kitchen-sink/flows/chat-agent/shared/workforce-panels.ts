/**
 * The collections the shell's right panel reads, declared on the shell's flow.
 *
 * A panel read resolves its ref against the reading session's own flow, so the
 * shell can only show the roster if `chat-agent` declares it. Each one is
 * org-scoped, so a chat-agent session reads its own organization's rows and no
 * other's. The boards are not here: each is read through its own mailbox's
 * session, whose flow already declares it.
 *
 * - `HIRED_ROSTER_RESOURCE` — the hired roster, from the same factory the
 *   admin flow and the boot reload use, so there is one declaration of that
 *   contract. Declared under the package's key, not a name of this app's,
 *   because the operator's hire (`flows/workforce-admin/`) writes the roster
 *   there; a second key for the same collection would be refused as a
 *   resource collision.
 * - `rosterBootReport` — what the last boot could not bring back, one row per
 *   organization. The boot writes it (`lib/roster-reload-report.ts`); nothing
 *   in this flow does. The key and the row's schema are declared in
 *   `lib/` (`workforce-shell.ts` and `roster-boot-report-schema.ts`), since
 *   the boot writer must reach them without importing this flow module.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { defineHiredRosterCollection, HIRED_ROSTER_RESOURCE } from "@flow-state-dev/workforce";

import { rosterBootReportSchema } from "@/lib/roster-boot-report-schema";
import { ROSTER_BOOT_REPORT_PREFIX, ROSTER_BOOT_REPORT_REF } from "@/lib/workforce-shell";

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
  [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
  [ROSTER_BOOT_REPORT_REF]: rosterBootReportCollection,
};
