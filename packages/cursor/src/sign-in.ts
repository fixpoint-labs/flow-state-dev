/**
 * Whether a host is signed in to Cursor: a key in the run's environment, a
 * stored login, or neither. No run is started.
 *
 * The two answers come from different places. `key` comes from `env`, the
 * environment the host hands the block's `env`. `login` comes from the SDK's
 * stored login under the checking process's own `HOME`; `env.HOME` is not
 * used. A run handed a different `HOME` reads a different stored login, so a
 * host keeps the two the same.
 */

/** The sign-in `cursorSignIn` found. */
export type CursorSignIn = { readonly status: "key" | "login" } | { readonly status: "none"; readonly reason: string };

/** Cursor's sign-in over `env`. See the file header for where each answer comes from. */
export async function cursorSignIn(env: Readonly<Record<string, string>>): Promise<CursorSignIn> {
  if ((env.CURSOR_API_KEY ?? "") !== "") return { status: "key" };
  // Loaded only here, so a host without the SDK never loads it.
  const { Cursor } = (await import("@cursor/sdk")) as unknown as {
    Cursor: { auth: { status(): Promise<{ status: string }> } };
  };
  const status = await Cursor.auth.status();
  return status.status === "logged-in"
    ? { status: "login" }
    : { status: "none", reason: "no CURSOR_API_KEY in the run's environment and no stored login" };
}
