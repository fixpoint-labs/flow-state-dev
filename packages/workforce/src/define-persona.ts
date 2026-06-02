/**
 * `definePersona` — Skills-parallel convention for declaring persona resources.
 * Thin sugar over defineResource / defineResourceCollection with contentTemplate
 * set, so readContent() renders the body from state.
 */

import {
  defineResource,
  defineResourceCollection,
  type DefinedResource,
  type DefinedResourceCollection,
} from "@flow-state-dev/core";
import type { ResourceScope } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import type { JsonValue } from "@flow-state-dev/core";

export interface PersonaResourceConfig {
  /** Resource ref / storage key (e.g. "persona-analyst"). */
  ref: string;
  scope?: ResourceScope;
  /** The template body rendered against state via LiquidJS. */
  contentTemplate: string;
  stateSchema?: ZodTypeAny;
  initialState?: JsonValue;
}

export interface PersonaCollectionConfig {
  /** Collection pattern (e.g. "personas/*"). */
  pattern: string;
  scope?: ResourceScope;
  /** Template applied to each collection instance. */
  contentTemplate?: string;
  /** Reference to an external template resource. */
  contentTemplateRef?: string;
  stateSchema?: ZodTypeAny;
  maxInstances?: number;
}

export function definePersona(config: PersonaCollectionConfig): DefinedResourceCollection;
export function definePersona(config: PersonaResourceConfig): DefinedResource;
export function definePersona(
  config: PersonaResourceConfig | PersonaCollectionConfig,
): DefinedResource | DefinedResourceCollection {
  const schema = config.stateSchema ?? z.object({});

  if ("pattern" in config) {
    return defineResourceCollection({
      pattern: config.pattern,
      scope: config.scope ?? "org",
      stateSchema: schema,
      ...(config.contentTemplate !== undefined ? { contentTemplate: config.contentTemplate } : {}),
      ...(config.contentTemplateRef !== undefined ? { contentTemplateRef: config.contentTemplateRef } : {}),
      ...(config.maxInstances !== undefined ? { maxInstances: config.maxInstances } : {}),
    });
  }

  return defineResource({
    ref: config.ref,
    scope: config.scope ?? "org",
    stateSchema: schema,
    ...(config.initialState !== undefined ? { default: config.initialState as JsonValue } : {}),
    contentTemplate: config.contentTemplate,
  });
}
