/**
 * FIX-1551 · POC fixture — a miniature of kitchen-sink after FIX-1500's PR-B.
 *
 * NOT production code. Copied next to the POC test by `run.sh`; nothing imports
 * it otherwise.
 *
 * One host-level `resolvePrincipal` that names a constant organization and user
 * and reads nothing off the request (FIX-1500 S10's shape). Three flows:
 *   - `echo`   has no resolver of its own, so the host resolver governs it
 *   - `admin`  keeps a credential-reading resolver (workforce-admin's shape)
 *   - `digest` wraps the framework default for non-scheduled sources
 *              (weekly-digest's shape)
 *
 * Planted controls, read from the environment so one test file can be turned red:
 *   POC_HOST_RESOLVER=none  — the app configures no host resolver (main today)
 *   POC_PER_FLOW=1          — the constant resolver moves onto `echo` itself
 */
import {
  createBearerSecretPrincipalResolver,
  createFlowState,
  defaultBodyUserIdPrincipalResolver,
  inMemoryStores,
  type PrincipalResolver,
} from "@flow-state-dev/engine";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

/** The one organization the app names, as FIX-1500 D6 names `kitchen-sink`. */
export const APP_ORG = "kitchen-sink";
/** The one user the app names (FIX-1500 S10: `devuser`). */
export const APP_USER = "devuser";
/** The credential `admin`'s resolver checks. A throwaway literal. */
export const ADMIN_SECRET = "poc-only-secret";

/** Host-level resolver: constants, nothing read from the request (BP-031). */
export const hostResolver: PrincipalResolver = () => ({ userId: APP_USER, orgId: APP_ORG });

const echoBlock = handler({
  name: "poc-echo",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({ reply: input.message }),
});

const echoInput = z.object({ message: z.string() });

/** Built per call so the planted per-flow control can attach a resolver. */
export function echoFlow(perFlow: boolean) {
  return defineFlow({
    kind: "echo",
    ...(perFlow ? { authentication: { resolvePrincipal: hostResolver } } : {}),
    actions: { respond: { inputSchema: echoInput, block: echoBlock } },
  })();
}

/** workforce-admin's shape: a bearer credential or nothing. */
export const adminFlow = defineFlow({
  kind: "admin",
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: ADMIN_SECRET,
      principal: { userId: "workforce-admin", orgId: APP_ORG },
    }),
  },
  actions: { respond: { inputSchema: echoInput, block: echoBlock } },
})();

/** weekly-digest's shape: scheduled gets a credential, everything else the default. */
export const digestFlow = defineFlow({
  kind: "digest",
  authentication: {
    resolvePrincipal: async (ctx) => {
      if (ctx.source === "scheduled") {
        return createBearerSecretPrincipalResolver({
          secret: ADMIN_SECRET,
          principal: { userId: "system", orgId: "org_test" },
        })(ctx);
      }
      return defaultBodyUserIdPrincipalResolver(ctx);
    },
    requireUser: true,
  },
  actions: { respond: { inputSchema: echoInput, block: echoBlock } },
})();

/** Whether the planted "no host resolver" control is on. */
export function hostResolverEnabled(): boolean {
  return process.env.POC_HOST_RESOLVER !== "none";
}

/** Assemble the app the way an `fsdev.config.ts` would. */
export function makeFlowState() {
  const perFlow = process.env.POC_PER_FLOW === "1";
  const stores = inMemoryStores();
  const flowState = createFlowState({
    flows: { echo: echoFlow(perFlow), admin: adminFlow, digest: digestFlow },
    stores: { default: { primary: stores } },
    ...(hostResolverEnabled() && !perFlow ? { resolvePrincipal: hostResolver } : {}),
  });
  return flowState;
}
