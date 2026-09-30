// Standalone config: this experiment lives outside every package's vitest
// root, so the default `pnpm test` never discovers it. Run it explicitly
// (see README.md in this directory).
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default {
  root: here("."),
  resolve: { alias: { zod: here("../../../../../packages/core/node_modules/zod") } },
  test: { include: ["characterize.test.ts"] },
};
