/**
 * Shared builder for a read-only external-collection instance ref (FIX-858).
 *
 * Both the execution-context registry (`createExternalCollectionHandle`) and the
 * client-route scope handle (`createScopeResources`) resolve an app record and
 * expose it as a read-only `ExternalResourceRef`. Factored here so the ref shape
 * — `path` / `scope` / `uri` / synchronous `state`, and content rendered from
 * `contentTemplate` / `contentTemplateRef` — has ONE definition and the two call
 * sites can't drift (they did: the route copy ignored templates). The read+
 * validate step is `readExternalRecord` in core; this owns only the ref shape.
 */
import type { ExternalResourceRef, JsonObject, ResourceScope } from "@flow-state-dev/core/types";
import {
  isResourceTemplate,
  parseResourceTemplate,
  renderResourceTemplate,
} from "@flow-state-dev/core/resource-template";

export function buildExternalResourceRef(args: {
  scope: ResourceScope;
  /** Canonical pattern-normalized storage path (e.g. `"positions/AAPL"`). */
  storageKey: string;
  /** Synchronous accessor for the resolved, schema-validated record state. */
  readState: () => JsonObject;
  /** Parsed `contentTemplate` (a `ResourceTemplate`), if the collection declares one. */
  contentTemplate?: unknown;
  /** `contentTemplateRef` path, if the collection declares one. */
  contentTemplateRef?: string;
  /** Resolve a `contentTemplateRef` path to raw template text (`null` when unavailable). */
  resolveTemplateRef?: (ref: string) => string | null;
}): ExternalResourceRef<JsonObject> {
  const { scope, storageKey, readState, contentTemplate, contentTemplateRef, resolveTemplateRef } = args;
  return {
    path: storageKey,
    scope,
    uri: `${scope}/${storageKey}`,
    get state() {
      return readState();
    },
    async readContentRaw(): Promise<string | null> {
      if (isResourceTemplate(contentTemplate)) return contentTemplate.source;
      if (contentTemplateRef !== undefined) return resolveTemplateRef?.(contentTemplateRef) ?? null;
      // External collections have no raw content store — content is template-rendered from state only.
      return null;
    },
    async readContent(): Promise<string | null> {
      if (isResourceTemplate(contentTemplate)) {
        return renderResourceTemplate(contentTemplate, readState());
      }
      if (contentTemplateRef !== undefined) {
        const raw = resolveTemplateRef?.(contentTemplateRef) ?? null;
        if (raw === null) return null;
        return renderResourceTemplate(parseResourceTemplate(raw), readState());
      }
      return null;
    },
  };
}
