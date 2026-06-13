/**
 * Resolves a durable-execution suspension by approving or rejecting it
 * (FIX-141 operator UI).
 *
 * Wraps the client's `recoveryClient.resumeSuspension` — transport lives in
 * the client, this hook only manages the in-flight / error UI state. The
 * suspension's real `flowKind` and `requestId` come from the selected
 * record, so the resume hits the correct flow endpoint (not the DevTool's
 * synthetic `__devtool__` flowKind).
 */
import { useCallback, useState } from "react";
import type { ResumeSuspensionResult } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export type ResumeArgs = {
  flowKind: string;
  requestId: string;
  suspensionId: string;
  action: "approve" | "reject";
  data?: unknown;
  resumedBy?: string;
};

export type UseResumeSuspensionResult = {
  resume: (args: ResumeArgs) => Promise<ResumeSuspensionResult>;
  isResuming: boolean;
  error: string | null;
};

/**
 * Returns a `resume` callback plus in-flight and error state. `resume`
 * rethrows on failure (after capturing `error`) so callers can branch on
 * success without re-reading state synchronously.
 */
export function useResumeSuspension(): UseResumeSuspensionResult {
  const { recoveryClient } = useDevTool();
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resume = useCallback(
    async (args: ResumeArgs): Promise<ResumeSuspensionResult> => {
      setIsResuming(true);
      setError(null);
      try {
        return await recoveryClient.resumeSuspension(
          args.flowKind,
          args.requestId,
          {
            suspensionId: args.suspensionId,
            action: args.action,
            data: args.data,
            resumedBy: args.resumedBy
          }
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resume");
        throw err;
      } finally {
        setIsResuming(false);
      }
    },
    [recoveryClient]
  );

  return { resume, isResuming, error };
}
