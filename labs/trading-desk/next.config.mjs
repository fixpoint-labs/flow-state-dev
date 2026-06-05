import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { workspacePackages } from "../../scripts/workspace-packages.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Workspace packages are consumed as TypeScript source in dev (their
// package.json `exports` point at ./src). Next must transpile every one it
// imports; the list is derived from the workspace (see
// scripts/workspace-packages.mjs) rather than hand-maintained.

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  transpilePackages: workspacePackages,
  // Keep unpdf OUT of the server bundle so it (and its vendored worker-free
  // pdfjs) load from node_modules at runtime. unpdf is serverless-ready and
  // generally bundles fine, but turbopack has mangled pdfjs worker loading twice
  // (the client web worker URL, then the server "fake worker" chunk), so
  // externalizing it is the belt-and-suspenders that avoids the class entirely.
  // See src/flows/portfolio/extract-pdf-text.server.ts.
  serverExternalPackages: ["unpdf"],
  turbopack: {
    root: resolve(__dirname, "../../"),
  },
};

export default nextConfig;
