// FIX-858.
/**
 * Builder for a read-only projected-collection instance ref.
 *
 * The execution-context registry (`createExternalCollectionHandle`) resolves an
 * app record and exposes it as a read-only `ProjectedResourceRef` through this:
 * the ref shape — `path` / `scope` / `uri` / synchronous `state`, and content
 * rendered from `contentTemplate` / `contentTemplateRef` — has one definition
 * here. The read+validate step is `readProjectedRecord` in core; this owns only
 * the ref shape.
 */
import type { ProjectedResourceRef, JsonObject, ResourceScope } from "@flow-state-dev/core/types";
import {
  isResourceTemplate,
  parseResourceTemplate,
  renderResourceTemplate,
} from "@flow-state-dev/core/resource-template";

export function buildProjectedResourceRef(args: {
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
}): ProjectedResourceRef<JsonObject> {
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
      // Projected collections have no raw content store — content is template-rendered from state only.
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
