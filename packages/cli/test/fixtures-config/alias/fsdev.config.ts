/**
 * Test fixture: a TypeScript config that imports through a `tsconfig` path
 * alias (`@/*`, declared in the sibling tsconfig.json), as a Next.js app does.
 */
// @ts-expect-error -- `@/*` is declared by this fixture's tsconfig.json, which the package typecheck doesn't read.
import { flowKeys } from "@/src/flows";

const config: { flowKeys: readonly string[] } = { flowKeys };
export default config;
