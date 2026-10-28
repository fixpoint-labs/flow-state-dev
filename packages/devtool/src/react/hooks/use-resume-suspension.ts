/**
 * Resolves a durable-execution suspension by approving or rejecting it
 * (FIX-141 operator UI).
 *
 * Wraps a request's `resume()` on the DevTool's client — transport lives in
 * the client, this hook only manages the in-flight / error UI state. The
 * owning instance and `requestId` come from the selected RECORD, so the resume
 * re-enters the exact copy that suspended — not the DevTool's synthetic
 * `__devtool__` address, and not whichever copy of the kind is registered.
 */
import { useCallback, useState } from "react";
/** The resumed run: the request that carries on (the suspended one, under its own id), and the one it carries on from. */
export type ResumeSuspensionResult = { requestId: string; originalRequestId: string };
import { useDevTool } from "../context/devtool-context";

export type ResumeArgs = {
  /** The record's own owning instance id — see `suspensionOwnerId`. */
  flowId: string;
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
  const { client } = useDevTool();
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resume = useCallback(
    async (args: ResumeArgs): Promise<ResumeSuspensionResult> => {
      setIsResuming(true);
      setError(null);
      try {
        // Addressed to the exact owning instance.
        const resumed = await client.flow(args.flowId).request(args.requestId).resume({
          suspensionId: args.suspensionId,
          action: args.action,
          data: args.data,
          resumedBy: args.resumedBy
        });
        return { requestId: resumed.id, originalRequestId: args.requestId };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resume");
        throw err;
      } finally {
        setIsResuming(false);
      }
    },
    [client]
  );

  return { resume, isResuming, error };
}
