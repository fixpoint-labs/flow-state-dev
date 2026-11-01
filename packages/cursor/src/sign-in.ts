/**
 * Whether a host is signed in to Cursor: a key in the run's environment, a
 * stored login, or neither. No run is started.
 *
 * The two answers come from different places. `key` comes from `env`, the
 * environment the host hands the block's `env`. `login` comes from the SDK's
 * stored login under the checking process's own `HOME`; `env.HOME` is not
 * used. A run handed a different `HOME` reads a different stored login, so a
 * host keeps the two the same.
 *
 * `checkCursorReadiness` gives the same answer as core's neutral
 * `HarnessReadiness`, with the remedy the user follows.
 */
import type { HarnessReadiness } from "@flow-state-dev/core/types";

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

/** What the user does when Cursor has no sign-in. */
export const CURSOR_SIGN_IN_REMEDY = "Set CURSOR_API_KEY, or sign in to Cursor";

/**
 * Whether Cursor can run on this machine, as core's neutral readiness: the
 * answer of {@link cursorSignIn}, with what to do when there is none. An SDK
 * that won't load, or a sign-in read that fails, is not ready with its reason;
 * a key counts only when the SDK also loads, since a run needs both.
 * Never throws.
 */
export async function checkCursorReadiness(env: Readonly<Record<string, string>>): Promise<HarnessReadiness> {
  let signIn: CursorSignIn;
  try {
    signIn = await cursorSignIn(env);
    // A key answers without loading the SDK, and a run still needs the SDK.
    if (signIn.status === "key") await import("@cursor/sdk");
  } catch (error) {
    return {
      ready: false,
      reason: `The Cursor SDK didn't load or answer: ${error instanceof Error ? error.message : String(error)}`,
      remedy: "Install @cursor/sdk",
    };
  }
  return signIn.status === "none" ? { ready: false, reason: `Cursor has no sign-in: ${signIn.reason}`, remedy: CURSOR_SIGN_IN_REMEDY } : { ready: true };
}
