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
  return config;
}
