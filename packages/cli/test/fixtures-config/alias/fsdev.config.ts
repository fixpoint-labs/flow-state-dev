/**
 * Test fixture: a TypeScript config that imports through a `tsconfig` path
 * alias (`@/*`, declared in the sibling tsconfig.json), as a Next.js app does.
 */
import { flowKeys } from "@/src/flows";

const config: { flowKeys: readonly string[] } = { flowKeys };
export default config;
