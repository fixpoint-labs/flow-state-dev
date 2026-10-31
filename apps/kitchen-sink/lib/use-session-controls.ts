"use client";

/**
 * The assistant composer's per-session controls: mode, thinking style and
 * features. The session remembers them: the `run` action writes all three to
 * session state on every turn, and the flow projects them back as the
 * `modeStatus` client data. This hook seeds the controls from that record when
 * a session opens, so a session that last ran in Build reopens in Build.
 *
 * A session that never ran projects the defaults, so it opens on them.
 * Seeding happens once per session, and never over a choice the user made in
 * that session before its record arrived. Like `useSessionDraft`, the state is
 * reset during render when `sessionId` changes, not in an effect, so a frame
 * never shows one session's controls on another.
 */
import { useCallback, useState } from "react";

import type { Mode } from "@/components/mode-selector";
import type { ThinkingStyle } from "@/components/thinking-style-selector";
import { DEFAULT_FEATURES, type Features } from "@/components/feature-selector";

/** What the session last ran with, as the `modeStatus` client data carries it. */
export interface RecordedSessionControls {
  currentMode: Mode;
  thinkingStyle: ThinkingStyle | undefined;
  features?: Partial<Features>;
}

/** The controls, and a setter for each. */
export interface SessionControls {
  mode: Mode;
  thinkingStyle: ThinkingStyle;
  features: Features;
  setMode: (mode: Mode) => void;
  setThinkingStyle: (style: ThinkingStyle) => void;
  setFeatures: (features: Features) => void;
}

interface ControlsState {
  sessionId: string | undefined;
  mode: Mode;
  thinkingStyle: ThinkingStyle;
  features: Features;
  /** The record was applied, or the user chose first: either way, don't seed again. */
  settled: boolean;
}

function defaults(sessionId: string | undefined): ControlsState {
  return { sessionId, mode: "ask", thinkingStyle: "default", features: DEFAULT_FEATURES, settled: false };
}

/**
 * Controls for one session. `recorded` must be the record of `sessionId`
 * itself, or `undefined` while it is loading: a caller passes nothing while
 * its snapshot still belongs to the previous session.
 */
export function useSessionControls(
  sessionId: string | undefined,
  recorded: RecordedSessionControls | undefined,
): SessionControls {
  const [state, setState] = useState<ControlsState>(() => defaults(sessionId));

  let current = state;
  if (current.sessionId !== sessionId) current = defaults(sessionId);
  if (!current.settled && sessionId !== undefined && recorded !== undefined) {
    // Applied whether or not a turn has finished: `run` records the controls
    // before its generator runs and counts the request only at the end, so a
    // session reopened mid-way through (or after a failed) first turn still
    // has them. A session that never ran projects the defaults.
    current = {
      sessionId,
      mode: recorded.currentMode,
      thinkingStyle: recorded.thinkingStyle ?? "default",
      features: { ...DEFAULT_FEATURES, ...recorded.features },
      settled: true,
    };
  }
  if (current !== state) setState(current);

  const update = useCallback(
    (patch: Partial<Pick<ControlsState, "mode" | "thinkingStyle" | "features">>) => {
      // Applies to whichever session is open: the controls are clicked, never
      // set from an async callback that could outlive its session.
      setState((prev) => ({ ...prev, ...patch, settled: true }));
    },
    [],
  );
  const setMode = useCallback((mode: Mode) => update({ mode }), [update]);
  const setThinkingStyle = useCallback((thinkingStyle: ThinkingStyle) => update({ thinkingStyle }), [update]);
  const setFeatures = useCallback((features: Features) => update({ features }), [update]);

  return {
    mode: current.mode,
    thinkingStyle: current.thinkingStyle,
    features: current.features,
    setMode,
    setThinkingStyle,
    setFeatures,
  };
}
