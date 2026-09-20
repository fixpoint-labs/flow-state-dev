/**
 * Demo: System One as an index-time resource classifier.
 *
 * `systemOne: true` installs the capability — ingest classifies on write,
 * search is a deterministic facet filter, reindex walks stale rows.
 * `systemOne: false` is the package-off case: those actions and tools
 * are simply not there.
 */

import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { TypeSafeDecisionsClient } from "./client";
import {
  SEARCH_INDEXED_DOCUMENTS_TOOL,
  createSystemOneIndexCapability,
  systemOneIndexTools,
} from "./index-capability";

export const INDEXED_DOCS_FLOW_KIND = "system-one-index";

export interface IndexedDocsFlowOptions {
  /** When false, facet search / classify-on-write are not installed. */
  systemOne?: boolean;
  client?: TypeSafeDecisionsClient;
  apiKey?: string;
  schemaVersion?: number;
  minConfidence?: number;
}

const statusOutputSchema = z.object({
  systemOne: z.boolean(),
  tools: z.array(z.string()),
});

/**
 * Demo flow. On: ingest / search / reindex / classifyQuery / status.
 * Off: status only, tools empty.
 */
export function createIndexedDocsFlow(options: IndexedDocsFlowOptions = {}) {
  const enabled = options.systemOne !== false;
  const cap = enabled
    ? createSystemOneIndexCapability({
        client: options.client,
        apiKey: options.apiKey,
        schemaVersion: options.schemaVersion,
        minConfidence: options.minConfidence,
      })
    : undefined;

  const status = handler({
    name: "index-status",
    inputSchema: z.object({}),
    outputSchema: statusOutputSchema,
    execute: () => ({
      systemOne: enabled,
      tools: systemOneIndexTools(cap).map((tool) => tool.name),
    }),
  });

  const definition = defineFlow({
    kind: INDEXED_DOCS_FLOW_KIND,
    requireUser: true,
    actions: enabled && cap !== undefined
      ? {
          status: { block: status },
          ingest: { block: cap.classifyOnWrite },
          search: { block: cap.searchIndexed },
          reindex: { block: cap.reindex },
          classifyQuery: { block: cap.classifyQuery },
        }
      : {
          status: { block: status },
        },
  });

  return definition();
}

export { SEARCH_INDEXED_DOCUMENTS_TOOL, systemOneIndexTools };
