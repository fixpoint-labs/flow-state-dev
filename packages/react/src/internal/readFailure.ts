// FIX-2774, FIX-2775 D2.
/**
 * Why a read failed, in the words the screen shows: one rule for `useView`
 * and `useResource`, so a Retry note reads the same whichever hook it sits on.
 */
import { ClientHttpError } from "@flow-state-dev/client";

/** Why a read failed: the server's reason, and its HTTP status when it answered one. */
export type ViewReadFailure = { message: string; httpStatus?: number };

/**
 * What a failed read says: the server's own words from its answer, else the
 * error's message (a `CollectionReadStoppedError`'s says why the list stopped).
 */
export function failureOf(error: unknown): ViewReadFailure {
  if (error instanceof ClientHttpError) {
    const body = error.body as { error?: unknown; message?: unknown } | undefined;
    const said = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : undefined;
    return { message: said ?? error.message, httpStatus: error.status };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}
