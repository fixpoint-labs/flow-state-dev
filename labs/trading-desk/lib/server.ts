/**
 * Server entry — re-exports the FlowState declared once in `fsdev.config.ts`,
 * so the Next.js route handler and the `fsdev` CLI run the exact same wiring
 * (gateway, xAI provider, intent map, filesystem stores).
 */
export { default as flowstate } from "../fsdev.config";
