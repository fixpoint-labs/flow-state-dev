/**
 * Session fields an app declares on its worker sessions (the workforce kit's
 * `sessionFields`, held by the installation): a schema each, by name, written
 * only by the server.
 *
 * Each field joins every worker session's state schema, its `serverOwned`
 * list (a create that seeds it is refused with a 400 naming it) and what the
 * client reads of the session. A field named like one workforce keeps is
 * refused: the app would overwrite a key workforce writes.
 *
 * The server writes a field in two places, and nowhere else:
 *
 * - **At open**, on a user's own conversation, through
 *   {@link setSessionFieldsAction}: once per field, so it is read-only after.
 * - **At each hand-over**, a task's session (and a delegate's ongoing one) is
 *   born with its filer's values, as `filingProjectId` is: a task works where
 *   the conversation that filed it does, however many hops down.
 *
 * Every field is visible to the session's browser. Never put a secret here.
 */
import { handler } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { SessionConfig } from "@flow-state-dev/core/types";
import { z, type AnyZodObject, type ZodTypeAny } from "zod";
import { linkedSessionOf } from "../projects/work-project";
import { WORKER_ID_STATE_KEY } from "./keys";

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
  // Optional on the session: it is born without one, and the server writes it after. Declared as
  // any value, not the field's schema: what is stored is already that schema's output, parsed once
  // where the server writes it (`setSessionFieldsAction`), and a hand-over copies it as is. Parsing
  // it again at each birth would run a `.transform` twice, or refuse a value whose type it changed.
  const declared = Object.fromEntries(names.map((name) => [name, z.unknown()]));
  return {
    ...session,
    stateSchema: z.object({ ...schema.shape, ...declared }) as never,
    serverOwned: [...(session.serverOwned ?? []), ...names],
    client: { ...session.client, expose: [...(session.client?.expose ?? []), ...names] },
  };
}

/** The app's session fields `state` holds, for a hand-over to carry down. */
export function carriedSessionFields(fields: SessionFields, state: unknown): Record<string, unknown> {
  const held = (state ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(fields).flatMap((name) => (held[name] === undefined ? [] : [[name, held[name]]])));
}

/**
 * What {@link setSessionFieldsAction} takes: the fields to write, by name,
 * and the worker the caller means the session to run, which it must.
 */
const setSessionFieldsInputSchema = z.object({ fields: z.record(z.unknown()), worker: z.string().min(1).optional() }).strict();

function refuse(message: string): never {
  throw new Error(`Refused: ${message}`);
}

/**
 * The action that writes the app's session fields on the user's own
 * conversation it runs in: the server's write at open. It admits only the
 * session's own user, on their own conversation (never a task's, a
 * delegate's, a workstream lead's or a project coordinator's session, which a
 * hand-over or an open fills), declared fields each not yet set, with a value
 * its schema parses. A refusal fails the request with its reason and stores
 * nothing.
 *
 * @param fields The app's session fields.
 */
export function setSessionFieldsAction(fields: SessionFields) {
  return {
    inputSchema: setSessionFieldsInputSchema,
    block: handler({
      name: "set-session-fields",
      inputSchema: setSessionFieldsInputSchema,
      outputSchema: z.object({ fields: z.record(z.unknown()) }),
      execute: async (input, ctx) => {
        const { state } = ctx.session;
        const running = state[WORKER_ID_STATE_KEY];
        if (typeof running !== "string") refuse("this session runs no worker.");
        if (input.worker !== undefined && input.worker !== running) {
          refuse(`this session runs "${running}", not "${input.worker}". Name the session's own worker.`);
        }
        const linked = linkedSessionOf(state);
        if (linked !== undefined) refuse(`this is ${linked}. Its fields come from where it was opened, and can't be set.`);
        const user = ctx.user?.identity?.userId;
        if (user === undefined || user !== ctx.session.identity.userId) refuse("only the session's own user sets its fields.");
        const names = Object.keys(input.fields);
        if (names.length === 0) refuse("name at least one field.");
        const written: Record<string, unknown> = {};
        for (const name of names) {
          const schema = Object.hasOwn(fields, name) ? fields[name] : undefined;
          if (schema === undefined) refuse(`"${name}" is no session field this app declares.`);
          if (state[name] !== undefined) refuse(`"${name}" is set when the session opens, and it already has one.`);
          const parsed = schema.safeParse(input.fields[name]);
          if (!parsed.success) refuse(`"${name}": ${parsed.error.issues.map((issue) => issue.message).join("; ")}.`);
          written[name] = parsed.data;
        }
        // The absence check and the write are one versioned write, rerun on a conflict against the
        // stored state: of two opens that race, the second finds the first's value and is refused.
        const taken = await withOutcome(ctx.session.atomicState, (current) => {
          const existing = names.find((name) => current[name] !== undefined);
          return { state: existing === undefined ? written : {}, result: existing };
        });
        if (taken !== undefined) refuse(`"${taken}" is set when the session opens, and it already has one.`);
        return { fields: written };
      },
    }),
  };
}
