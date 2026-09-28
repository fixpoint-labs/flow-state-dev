/**
 * The rail's session reads: a channel kind's sessions are the channels the
 * tree declares, read by id; every other kind's are listed as the store has
 * them.
 *
 * The navigator lists a singleton kind's sessions by kind. A store kept across
 * an upgrade still holds the sessions of channels an earlier roster declared
 * (the old desk's `support.desk`, say), and a listing by kind would draw them
 * beside `support.help`. Reading each declared channel by its id never reads a
 * retired one (BP-033), and nothing stored is changed or removed.
 */
import type { SessionClient } from "@flow-state-dev/client";

import { isChannelKind, SHELL_CHANNELS } from "./workforce-shell";

/**
 * The session source the rail's navigator reads through.
 *
 * @param client The page's session client; a stable reference, so the navigator's reads stay fenced on it.
 * @returns A source whose channel-kind listings are the declared channels.
 */
export function railSessions(
  client: Pick<SessionClient, "listSessions" | "getSession">,
): Pick<SessionClient, "listSessions"> {
  return {
    listSessions: async (options) => {
      const kind = options?.flowKind;
      if (kind === undefined || !isChannelKind(kind)) return await client.listSessions(options);
      const declared = SHELL_CHANNELS.filter((channel) => channel.kind === kind);
      return await Promise.all(declared.map((channel) => client.getSession(channel.id)));
    },
  };
}
