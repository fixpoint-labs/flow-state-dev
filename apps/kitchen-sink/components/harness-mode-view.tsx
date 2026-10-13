"use client";

/**
 * An available harness mode: its frame, with the session view in the stream
 * slot. The client half of `harness-mode-page.tsx`, which can't hand the frame
 * a function from the server.
 *
 * Nothing harness-specific: the mode's label and flow kind are data from the
 * mode list.
 */
import { useCallback } from "react";

import { HarnessFrame } from "@/components/harness-frame";
import { HarnessSessionView } from "@/components/harness-session";

/** A harness mode's frame and session view. */
export function HarnessModeView({ label, flowKind }: { label: string; flowKind: string }) {
  const stream = useCallback(
    (sessionId: string) => <HarnessSessionView key={sessionId} label={label} flowKind={flowKind} sessionId={sessionId} />,
    [label, flowKind],
  );
  return <HarnessFrame label={label} flowKind={flowKind} stream={stream} />;
}
