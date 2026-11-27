/**
 * The API reference as a site plugin: a docs-content instance whose folder is generated first.
 *
 * Docusaurus starts every plugin at once and the docs plugin reads its folder as it starts, so
 * generation can't be a sibling plugin. This one awaits `generateApiReference` into the
 * instance's `path`, then hands back the docs plugin itself, with the options Docusaurus has
 * already checked against the docs plugin's own schema.
 */
import { resolve } from "node:path";
import docsPlugin, { validateOptions } from "@docusaurus/plugin-content-docs";
import { generateApiReference } from "./generate.mjs";

/**
 * @param {import("@docusaurus/types").LoadContext} context
 * @param {import("@docusaurus/plugin-content-docs").PluginOptions} options the docs plugin's options
 */
export default async function apiReferencePlugin(context, options) {
  await generateApiReference({
    outDir: resolve(context.siteDir, options.path),
    skipTypes: process.env.FSD_API_REFERENCE_SKIP_TYPES === "1",
  });
  return docsPlugin(context, options);
}

apiReferencePlugin.validateOptions = validateOptions;
