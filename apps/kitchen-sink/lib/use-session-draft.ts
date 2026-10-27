"use client";

/**
 * Persists a session composer's in-progress text in `localStorage`, keyed by
 * session id, so a reload or accidental navigation does not lose what was typed.
 */
import { useCallback, useEffect, useState } from "react";

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

/** Composer text for one session, restored from storage when the session opens. */
export function useSessionDraft(sessionId: string | undefined): [string, (text: string) => void] {
  const [draft, setDraftState] = useState(() => readDraft(sessionId));

  useEffect(() => {
    setDraftState(readDraft(sessionId));
  }, [sessionId]);

  const setDraft = useCallback(
    (text: string) => {
      setDraftState(text);
      writeDraft(sessionId, text);
    },
    [sessionId],
  );

  return [draft, setDraft];
}
