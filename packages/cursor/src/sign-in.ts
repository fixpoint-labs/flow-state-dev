/**
 * Whether a host is signed in to Cursor: a key in the run's environment, a
 * stored login, or neither. No run is started.
 *
 * A host calls this from its own availability check, over the same
 * environment it hands the block's `env`, so the answer is about the run's
 * environment rather than the host process's.
 */

/** How this host signs Cursor in: a key in the run's environment, a stored login, or neither. */
export type CursorSignIn = { readonly status: "key" | "login" } | { readonly status: "none"; readonly reason: string };

/**
 * Cursor's sign-in over `env`. A non-empty `CURSOR_API_KEY` is `key`;
 * otherwise the SDK's own answer about its stored login decides `login` or
 * `none`.
 */
export async function cursorSignIn(env: Readonly<Record<string, string>>): Promise<CursorSignIn> {
  if ((env.CURSOR_API_KEY ?? "") !== "") return { status: "key" };
  // Loaded only here, so a host without the SDK never loads it, and the check
  // reads the stored login under the same `HOME` the run is handed.
  const { Cursor } = (await import("@cursor/sdk")) as unknown as {
    Cursor: { auth: { status(): Promise<{ status: string }> } };
  };
  const status = await Cursor.auth.status();
  return status.status === "logged-in"
    ? { status: "login" }
    : { status: "none", reason: "no CURSOR_API_KEY in the run's environment and no stored login" };
}
