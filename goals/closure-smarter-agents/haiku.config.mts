/**
 * An app's own fsdev config, served on Haiku (`model.mts`): the closure's
 * `serveFsdev` starts `fsdev serve --config` on this file in place of the
 * app's when `GOAL_HAIKU=1`, with the app's config in `CLOSURE_APP_CONFIG`.
 * It loads that config (from the served tree, so the control's own tree is
 * served on the control) and hands back the app's own FlowState, its resolver
 * swapped for one that answers every model string with Haiku on Anthropic,
 * holding the key from `MY_ANTHROPIC_API_KEY`.
 *
 * Not run by hand: `serveFsdev` sets both variables.
 */
import { pathToFileURL } from "node:url";
import type { FlowState } from "@flow-state-dev/engine";
import { answerOnHaiku, haikuResolver, KEY_VARIABLE } from "./model.mts";

const appConfig = process.env.CLOSURE_APP_CONFIG ?? "";
if (appConfig === "") throw new Error("CLOSURE_APP_CONFIG names no app config: the closure's serveFsdev sets it");
const apiKey = process.env[KEY_VARIABLE] ?? "";
if (apiKey === "") throw new Error(`${KEY_VARIABLE} is not set: the app's agents run on Anthropic with it`);

const app = ((await import(pathToFileURL(appConfig).href)) as { default: FlowState }).default;

export default await answerOnHaiku(app, haikuResolver(apiKey));
