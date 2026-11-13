/**
 * Session fields an app declares on the agent and coordinator sessions (the
 * workforce kit's `sessionFields`): a schema each, by name, written only by
 * the server.
 *
 * Each field joins the session's state schema, its `serverOwned` list (a
 * create that seeds it is refused with a 400 naming it, BP-031) and what the
 * client reads of the session. A field named like one workforce keeps is
 * refused: the app would overwrite a key workforce writes.
 */
import type { SessionConfig } from "@flow-state-dev/core/types";
import { z, type AnyZodObject, type ZodTypeAny } from "zod";

/** The app's session fields: a schema each, by name. */
export type SessionFields = Readonly<Record<string, ZodTypeAny>>;

/**
 * `session` with `fields` declared on it, server-written and read by the
 * client. `session` unchanged when there are none.
 *
 * @throws When a field is named like a key the session already declares.
 */
export function withSessionFields(session: SessionConfig, fields: SessionFields | undefined): SessionConfig {
  const names = Object.keys(fields ?? {});
  if (names.length === 0) return session;
  const schema = session.stateSchema as AnyZodObject;
  const taken = names.filter((name) => Object.hasOwn(schema.shape, name));
  if (taken.length > 0) {
    throw new Error(`workforce: session field ${taken.map((name) => `"${name}"`).join(", ")} is one workforce keeps on the session. Name it otherwise.`);
  }
  return {
    ...session,
    stateSchema: z.object({ ...schema.shape, ...fields }) as never,
    serverOwned: [...(session.serverOwned ?? []), ...names],
    client: { ...session.client, expose: [...(session.client?.expose ?? []), ...names] },
  };
}
