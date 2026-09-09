/**
 * `@flow-state-dev/workforce` — Agent registry and materialization.
 *
 * Provides the first-class Agent primitive: a named, reusable participant
 * composed of a Persona (its identity), Skills, a model, and tools. The
 * package supplies `defineAgent`, `createAgentRegistry`, `materializeAgent`,
 * `agentBlock`, `definePersona`, and `createWorkforceCapability`.
 */

export { defineAgent } from "./define-agent";
export { createAgentRegistry } from "./agent-registry";
export { materializeAgent } from "./materialize-agent";
export { agentBlock, type AgentBlockOptions } from "./agent-block";
export { definePersona, type PersonaResourceConfig, type PersonaCollectionConfig } from "./define-persona";
export { createWorkforceCapability, type WorkforceCapabilityOptions } from "./workforce-capability";
