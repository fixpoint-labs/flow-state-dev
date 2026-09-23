/**
 * The shape of the boot's skipped-seat report.
 *
 * A leaf module like `lib/workforce-shell.ts`, but not folded into it: that
 * module's contract is zero imports, and this schema needs zod. Both the boot
 * writer (`lib/roster-reload-report.ts`) and the shell's flow
 * (`flows/chat-agent/shared/workforce-panels.ts`) import it from here, so
 * there is one declaration of what a report row holds.
 */
import { z } from "zod";

/** What the report holds: the problems the roster panel shows beside the seats. */
export const rosterBootReportSchema = z.object({
  problems: z.array(z.string()),
});

export type RosterBootReport = z.infer<typeof rosterBootReportSchema>;
