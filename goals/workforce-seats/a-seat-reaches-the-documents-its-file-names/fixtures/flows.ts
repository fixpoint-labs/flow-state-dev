/**
 * One worker flow, built the way an app builds one on an installation: one
 * registered copy every worker runs on, the installation's documents spread
 * into its resources beside a store of its own, and the installation's
 * visibility rule, so each turn's model reaches only its worker's documents.
 *
 * Its actions are core's model-facing document tools, mounted as they are:
 * the same blocks a model calls, so a check runs them as a model would, with
 * no model. Beside them, `peek`, an app's own tool built on core's lookup.
 *
 * `withoutRule` builds the same flow with no visibility rule: the control.
 */
import {
  createManifestRegistry,
  defineFlow,
  defineResource,
  discoveryTools,
  handler,
  readResourceContentTool,
  resolveResourceByUri,
  resourcesManifestSource,
  resourceSearchTools,
  writeResourceContentTool,
} from "@flow-state-dev/core";
import type { WorkerInstallation } from "@flow-state-dev/workforce";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";
import { workerDoor } from "../../../lib/worker-door.mts";

export const DESK_KIND = "desk";

/** The app's own store, declared beside the documents. Not a document, and no grant governs it. */
export const STORE = "audit-log";

const auditLog = defineResource({
  ref: STORE,
  scope: "org",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
  default: { entries: [] },
  writable: true,
});

/** An app's own tool: open a document by uri through core's lookup, and say whether it found one. */
const peek = handler({
  name: "peek",
  inputSchema: z.object({ uri: z.string() }),
  outputSchema: z.object({ found: z.boolean() }),
  execute: async ({ uri }, ctx) => ({ found: (await resolveResourceByUri(uri, ctx)) !== undefined }),
});

/**
 * Build the desk flow on `installation`.
 *
 * @param options.withoutRule The control: no visibility rule, so every turn's
 *   model reaches every document, as a flow that sets none does.
 */
export function buildDesk(installation: WorkerInstallation, options: { withoutRule?: boolean } = {}) {
  const { globResources, grepResourceContent } = resourceSearchTools();
  const { discover } = discoveryTools(createManifestRegistry([resourcesManifestSource()]));
  // The turn's worker, loaded on every run of a request, a resumed one included.
  const loadWorker = handler({
    name: "desk-load-worker",
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, DESK_KIND)).id }),
  });
  return defineFlow({
    kind: DESK_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...installation.documents, [STORE]: auditLog },
    ...(options.withoutRule === true ? {} : { resourceVisibility: installation.resourceVisibility }),
    request: { onStarted: loadWorker },
    actions: {
      ...workerDoor,
      read: { inputSchema: z.object({ uri: z.string().optional() }), block: readResourceContentTool() },
      write: { inputSchema: z.object({ uri: z.string(), content: z.string() }), block: writeResourceContentTool() },
      glob: { inputSchema: z.object({}).passthrough(), block: globResources },
      grep: { inputSchema: z.object({ pattern: z.string() }).passthrough(), block: grepResourceContent },
      discover: { inputSchema: z.object({}).passthrough(), block: discover },
      peek: { inputSchema: z.object({ uri: z.string() }), block: peek },
    },
  });
}
