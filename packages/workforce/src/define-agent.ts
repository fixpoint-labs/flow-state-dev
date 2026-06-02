/**
 * `defineAgent` — pure builder that validates and returns an Agent config.
 */

import type { Agent } from "@flow-state-dev/core";

/** Create a validated Agent definition. */
export function defineAgent(config: Agent): Agent {
  if (!config.name || config.name.trim().length === 0) {
    throw new Error("defineAgent: name must be a non-empty string");
  }
  if (typeof config.persona === "string" && config.persona.trim().length === 0) {
    throw new Error("defineAgent: bare-string persona must be non-empty");
  }
  if (typeof config.persona === "object" && "path" in config.persona && !config.persona.path.trim()) {
    throw new Error("defineAgent: path-based persona must have a non-empty path");
  }
  if (typeof config.persona === "object" && "template" in config.persona && !config.persona.template.trim()) {
    throw new Error("defineAgent: inline template persona must have a non-empty template");
  }
  return config;
}
