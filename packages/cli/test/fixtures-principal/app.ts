/**
 * Test fixture: an app that names its own organization in host code, the shape
 * a real app's `createFlowState({ resolvePrincipal })` takes. `fsdev run` and
 * `fsdev chat` load it through `fsdev.config.ts`; the tests also build the same
 * app to ask its HTTP router the question the terminal asked.
 *
 * One host-level resolver returns constants and reads nothing from the
 * request. Four flows cover the resolver shapes a terminal meets:
 *   - `echo`        no resolver of its own, so the host's governs it
 *   - `admin`       checks a bearer credential (the CLI carries none)
 *   - `digest`      wraps the framework default for non-scheduled callers
 *   - `placeholder` a resolver that claims the reserved development org
 *
 * Every instance shares one in-memory store registry, so a test can read what
 * a run wrote after the CLI disposes its FlowState.
 */
import {
  createBearerSecretPrincipalResolver,
  createFlowState,
  createInMemoryStores,
  defaultBodyUserIdPrincipalResolver,
  type StoreAdapter,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

/** The organization the app's host resolver names. */
export const APP_ORG = "acme-dev";
/** The user the app's host resolver names. */
export const APP_USER = "dev";
/** The credential `admin`'s resolver checks. */
export const ADMIN_SECRET = "fixture-only-secret";

const g = globalThis as unknown as { __principalFixtureStores?: StoreRegistry };

/** The registry every instance of this app writes through. */
export function sharedStores(): StoreRegistry {
  g.__principalFixtureStores ??= createInMemoryStores();
  return g.__principalFixtureStores;
}

/** Start each test from an empty store. */
export function resetSharedStores(): void {
  g.__principalFixtureStores = undefined;
}

const sharedAdapter: StoreAdapter = {
  capabilities: ["primary"],
  resolve: () => Promise.resolve(sharedStores()),
};

const messageInput = z.object({ message: z.string() });

const echoBlock = handler({
  name: "principal-echo",
  inputSchema: messageInput,
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({ reply: input.message }),
});

const respond = { respond: { inputSchema: messageInput, block: echoBlock } };

const echoFlow = defineFlow({ kind: "echo", actions: respond })();

const adminFlow = defineFlow({
  kind: "admin",
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: ADMIN_SECRET,
      principal: { userId: "admin", orgId: APP_ORG },
    }),
  },
  actions: respond,
})();

const digestFlow = defineFlow({
  kind: "digest",
  authentication: {
    resolvePrincipal: async (ctx) =>
      ctx.source === "scheduled"
        ? createBearerSecretPrincipalResolver({
            secret: ADMIN_SECRET,
            principal: { userId: "system", orgId: APP_ORG },
          })(ctx)
        : defaultBodyUserIdPrincipalResolver(ctx),
    requireUser: true,
  },
  actions: respond,
})();

const placeholderFlow = defineFlow({
  kind: "placeholder",
  authentication: { resolvePrincipal: () => ({ userId: "someone", orgId: DEFAULT_ORG_ID }) },
  actions: respond,
})();

/** Assemble the app the way its `fsdev.config.ts` does. */
export function makeApp() {
  return createFlowState({
    flows: { echo: echoFlow, admin: adminFlow, digest: digestFlow, placeholder: placeholderFlow },
    stores: { default: { primary: sharedAdapter } },
    resolvePrincipal: () => ({ userId: APP_USER, orgId: APP_ORG }),
  });
}
