/**
 * The repository a session works in: the lab's one session field, declared on
 * the workforce kit (`sessionFields`). The server writes it once, when the
 * session opens (workforce's `setSessionFields`), and each hand-over carries it
 * down to the task sessions the session files, so every coding run and every
 * source read finds its repository from the session it runs in. Never from a
 * task's input or a request body.
 *
 * Its value is the repository as the session was opened on it: a path, or a
 * `file://` remote. The host's run source checks it against the repositories
 * it lists when a run starts.
 */
import { z } from "zod";

/** The session field's name. */
export const REPOSITORY_FIELD = "repository";

/** The lab's session fields, as the workforce kit takes them. */
export const sessionFields = { [REPOSITORY_FIELD]: z.string().min(1) };
