// FIX-141.
/**
 * Resolves a durable-execution suspension by approving or rejecting it
 * (the operator UI for durable suspensions).
 *
 * Wraps the DevTool client's call for the stop: `answer()` for a user's stop
 * (`isUserSuspension`), which answers it whatever started the run, a task's
 * included; `resume()` for a developer's own custom-reason `ctx.suspend`.
 * Transport lives in the client, this hook only manages the in-flight /
 * error UI state. The owning instance and `requestId` come from the selected
 * RECORD, so the answer re-enters the exact copy that suspended — not the DevTool's synthetic
 * `__devtool__` address, and not whichever copy of the kind is registered.
 */
import { useCallback, useState } from "react";
import { isUserSuspension } from "@flow-state-dev/core/types";
/** The resumed run: the request that carries on (the suspended one, under its own id), and the one it carries on from. */
export type ResumeSuspensionResult = { requestId: string; originalRequestId: string };
import { useDevTool } from "../context/devtool-context";

export type ResumeArgs = {
  /** The record's own owning instance id — see `suspensionOwnerId`. */
  flowId: string;
  requestId: string;
  suspensionId: string;
  /** The stop's reason, from the record: it picks the call that answers it. */
  reason: string;
  action: "approve" | "reject";
  data?: unknown;
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
        const request = client.flow(args.flowId).request(args.requestId);
        const body = {
          suspensionId: args.suspensionId,
          action: args.action,
          ...(args.data !== undefined ? { data: args.data } : {})
        };
        const resumed = isUserSuspension({ reason: args.reason })
          ? await request.answer(body)
          : await request.resume(body);
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
