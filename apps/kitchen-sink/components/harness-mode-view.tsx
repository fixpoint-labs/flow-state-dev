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
import { useBlockHistoryKeys } from "@/lib/use-block-history-keys";
import type { ModelChoices } from "@/lib/harness-models";

/** A harness mode's frame and session view. */
export function HarnessModeView({
  label,
  flowKind,
  note,
  models,
}: {
  label: string;
  flowKind: string;
  note?: string;
  models: ModelChoices;
}) {
  useBlockHistoryKeys();
  const stream = useCallback(
    (sessionId: string) => (
      <HarnessSessionView key={sessionId} label={label} flowKind={flowKind} sessionId={sessionId} models={models} />
    ),
    [label, flowKind, models],
  );
  return <HarnessFrame label={label} flowKind={flowKind} note={note} models={models} stream={stream} />;
}
