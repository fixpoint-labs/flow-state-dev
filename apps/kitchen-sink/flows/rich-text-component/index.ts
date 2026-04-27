/**
 * Public surface for the rich-text-component flow. Mirrors chat-agent's
 * barrel pattern: default export is the flow instance; generators are
 * re-exported for tests that bind to specific blocks.
 */
export { default as richTextComponentFlow } from "./flow";
export * from "./generators";
