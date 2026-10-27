"use client";

/**
 * Persists a session composer's in-progress text in `localStorage`, keyed by
 * session id, so a reload or accidental navigation does not lose what was typed.
 *
 * The lazy initializer reads storage on first mount (keyed composers remount per
 * session). When the parent keeps the same hook instance and only `sessionId`
 * changes (the assistant composer), state is reset during render on that change.
 */
import { useCallback, useState } from "react";

export const SESSION_DRAFT_STORAGE_PREFIX = "kitchen-sink:composer-draft:";

function readDraft(sessionId: string | undefined): string {
  if (sessionId === undefined || typeof window === "undefined") return "";
  try {
    return localStorage.getItem(SESSION_DRAFT_STORAGE_PREFIX + sessionId) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(sessionId: string | undefined, text: string): void {
  if (sessionId === undefined || typeof window === "undefined") return;
  const key = SESSION_DRAFT_STORAGE_PREFIX + sessionId;
  try {
    if (text === "") localStorage.removeItem(key);
    else localStorage.setItem(key, text);
  } catch {
    // Quota or private mode — keep the in-memory draft only.
  }
}

/** Drops the stored draft only; in-memory text is unchanged until the composer clears it. */
export function clearSessionDraftStorage(sessionId: string | undefined): void {
  writeDraft(sessionId, "");
}

/** Composer text for one session, restored from storage when the session opens. */
export function useSessionDraft(sessionId: string | undefined): [string, (text: string) => void] {
  const [state, setState] = useState(() => ({ sessionId, draft: readDraft(sessionId) }));

  if (state.sessionId !== sessionId) {
    let draft = readDraft(sessionId);
    if (sessionId !== undefined && state.sessionId === undefined && state.draft !== "") {
      writeDraft(sessionId, state.draft);
      draft = state.draft;
    }
    setState({ sessionId, draft });
  }

  const setDraft = useCallback(
    (text: string) => {
      writeDraft(sessionId, text);
      setState((prev) => {
        // A slow send from another session must not replace this session's draft.
        if (prev.sessionId !== sessionId) return prev;
        return { sessionId: prev.sessionId, draft: text };
      });
    },
    [sessionId],
  );

  return [state.draft, setDraft];
}
