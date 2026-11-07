/**
 * An app's own fsdev config, served on Haiku (`model.mts`): the closure's
 * `serveFsdev` starts `fsdev serve --config` on this file in place of the
 * app's when `GOAL_HAIKU=1`, with the app's config in `CLOSURE_APP_CONFIG`.
 * It loads that config (from the served tree, so the control's own tree is
 * served on the control) and hands back the app's own FlowState, on a
 * resolver that answers every model string with Haiku on Anthropic, holding
 * the key from `MY_ANTHROPIC_API_KEY`.
 *
 * The resolver is swapped in before the config is imported (`serveOnHaiku`),
 * on the engine the app's config itself resolves: an app may build its router
 * while it is imported, and a router keeps the resolver it was built with.
 *
 * Not run by hand: `serveFsdev` sets both variables.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { FlowState } from "@flow-state-dev/engine";
import { haikuResolver, KEY_VARIABLE, serveOnHaiku, type ServedEngine } from "./model.mts";

const appConfig = process.env.CLOSURE_APP_CONFIG ?? "";
if (appConfig === "") throw new Error("CLOSURE_APP_CONFIG names no app config: the closure's serveFsdev sets it");
const apiKey = process.env[KEY_VARIABLE] ?? "";
if (apiKey === "") throw new Error(`${KEY_VARIABLE} is not set: the app's agents run on Anthropic with it`);

// The engine as the app's config resolves it: the same module, so the same FlowState class.
const engine = (await import(pathToFileURL(createRequire(appConfig).resolve("@flow-state-dev/engine")).href)) as ServedEngine;

export default await serveOnHaiku(
  engine,
  async () => ((await import(pathToFileURL(appConfig).href)) as { default: FlowState }).default,
  haikuResolver(apiKey),
);
