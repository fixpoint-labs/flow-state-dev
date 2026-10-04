/**
 * The rail's session reads: a mailbox kind's sessions are the mailboxes the
 * tree declares, read by id; every other kind's are listed as the store has
 * them.
 *
 * The navigator lists a singleton kind's sessions by kind. A store kept across
 * an upgrade still holds the sessions of mailboxes an earlier roster declared
 * (the old desk's `support.desk`, say), and a listing by kind would draw them
 * beside `support.help`. Reading each declared mailbox by its id never reads a
 * retired one (BP-033), and nothing stored is changed or removed.
 */
import type { SessionClient } from "@flow-state-dev/client";

import { isMailboxKind, SHELL_MAILBOXES } from "./workforce-shell";

/**
 * The session source the rail's navigator reads through.
 *
 * @param client The page's session client; a stable reference, so the navigator's reads stay fenced on it.
 * @returns A source whose mailbox-kind listings are the declared mailboxes.
 */
export function railSessions(
  client: Pick<SessionClient, "listSessions" | "getSession">,
): Pick<SessionClient, "listSessions"> {
  return {
    listSessions: async (options) => {
      const kind = options?.flowKind;
      if (kind === undefined || !isMailboxKind(kind)) return await client.listSessions(options);
      const declared = SHELL_MAILBOXES.filter((mailbox) => mailbox.kind === kind);
      return await Promise.all(declared.map((mailbox) => client.getSession(mailbox.id)));
    },
  };
}
