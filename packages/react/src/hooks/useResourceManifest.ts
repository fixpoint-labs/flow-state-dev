/**
 * Hook for the resource manifest (FIX-427 §3.11).
 *
 * The manifest is static per `flowKind`. A module-level cache, keyed by
 * `flowKind`, ensures that all components mounting this hook for the same
 * flow share a single fetch and a single in-flight promise. SSE has no role
 * here — manifests don't change at runtime.
 */
import { useEffect, useMemo, useState } from "react";
import {
  createResourceClient,
  type ResourceManifest
} from "@flow-state-dev/client";
import type { SessionView } from "./useSession";
import { useFlowContext } from "../context/FlowContext";

const manifestCache = new Map<string, ResourceManifest>();
const inFlight = new Map<string, Promise<ResourceManifest>>();

export type UseResourceManifestResult = {
  manifest: ResourceManifest | undefined;
  isLoading: boolean;
  error: Error | undefined;
};

export function useResourceManifest(session: SessionView): UseResourceManifestResult {
  const { baseUrl } = useFlowContext();
  const client = useMemo(() => createResourceClient({ baseUrl }), [baseUrl]);
  const flowKind = session.snapshot?.flowKind ?? session.flowKind;
  const sessionId = session.sessionId;

  const [manifest, setManifest] = useState<ResourceManifest | undefined>(
    flowKind ? manifestCache.get(flowKind) : undefined
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    flowKind ? !manifestCache.has(flowKind) : true
  );
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    if (!sessionId || !flowKind) return;
    const cached = manifestCache.get(flowKind);
    if (cached) {
      setManifest(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(undefined);

    const existing = inFlight.get(flowKind);
    const promise = existing ?? (() => {
      const p = client
        .getResourceManifest(sessionId)
        .then((m) => {
          manifestCache.set(flowKind, m);
          return m;
        })
        .finally(() => {
          inFlight.delete(flowKind);
        });
      inFlight.set(flowKind, p);
      return p;
    })();

    promise
      .then((m) => {
        if (!cancelled) {
          setManifest(m);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, flowKind, sessionId]);

  return { manifest, isLoading, error };
}

/** @internal Test-only — clears the module-level manifest cache. */
export function __resetManifestCacheForTests(): void {
  manifestCache.clear();
  inFlight.clear();
}
