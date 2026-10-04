/**
 * Registers `swap-loader.mjs` in the Lab process. The goal sets
 * `NODE_OPTIONS=--import <this file>` and names the swap in
 * `GOAL_SWAP_TARGET`, `GOAL_SWAP_WITH` and `GOAL_SWAP_FIRED`.
 */
import { register } from "node:module";

const { GOAL_SWAP_TARGET: target, GOAL_SWAP_WITH: replacement, GOAL_SWAP_FIRED: fired } = process.env;
if (target === undefined || replacement === undefined || fired === undefined) {
  throw new Error("swap-hook: GOAL_SWAP_TARGET, GOAL_SWAP_WITH and GOAL_SWAP_FIRED must all be set");
}
register("./swap-loader.mjs", import.meta.url, { data: { target, with: replacement, fired } });
