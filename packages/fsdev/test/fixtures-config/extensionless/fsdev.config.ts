/**
 * Test fixture: a TypeScript config whose relative import has no extension,
 * as the quick start writes it. Plain Node can't resolve `./src/flows`, so the
 * loader has to bring it in through jiti. The default export only needs to be
 * recognisable; the loader test reads `default.flowKeys`.
 */
import { flowKeys } from "./src/flows";

const config: { flowKeys: readonly string[] } = { flowKeys };
export default config;
