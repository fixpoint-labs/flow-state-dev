/**
 * Resolves a durable-execution suspension by approving or rejecting it
 * (FIX-141 operator UI).
 *
 * Wraps the client's `recoveryClient.resumeSuspensionStream` — transport lives
 * in the client, this hook only manages the in-flight / error UI state. The
 * suspension's real `flowKind` and `requestId` come from the selected record,
 * so the resume hits the correct flow endpoint (not the DevTool's synthetic
 * `__devtool__` flowKind).
 *
 * The resume streams: it POSTs with `Accept: text/event-stream` and returns the
 * continuation's SSE `Response` so the panel can consume it inline and follow
 * the resumed run live, without a separate GET reconnect (FIX-276). When the
 * server returns 202 JSON instead, `stream` is `null` and the panel falls back
 * to a GET re-attach.
 */
import { useCallback, useState } from "react";
import { useDevTool } from "../context/devtool-context";

export type ResumeArgs = {
  flowKind: string;
  requestId: string;
  suspensionId: string;
  action: "approve" | "reject";
  data?: unknown;
  resumedBy?: string;
};

export type ResumeResult = {
  /** The suspended request's id (the continuation re-enters it, FIX-811). */
  requestId: string;
  /** Continuation SSE response to consume inline, or `null` for a 202 fallback. */
  stream: Response | null;
};

export type UseResumeSuspensionResult = {
  resume: (args: ResumeArgs) => Promise<ResumeResult>;
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
    async (args: ResumeArgs): Promise<ResumeResult> => {
      setIsResuming(true);
      setError(null);
      try {
        const response = await recoveryClient.resumeSuspensionStream(
          args.flowKind,
          args.requestId,
          {
            suspensionId: args.suspensionId,
            action: args.action,
            data: args.data,
            resumedBy: args.resumedBy
          }
        );
        const contentType = response.headers.get("content-type") ?? "";
        const isStream = contentType.includes("text/event-stream");
        if (!isStream) {
          // 202 fallback: drain the JSON body so the connection is released;
          // the panel re-attaches via GET.
          response.body?.cancel().catch(() => {});
        }
        return {
          requestId: args.requestId,
          stream: isStream ? response : null
        };
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
