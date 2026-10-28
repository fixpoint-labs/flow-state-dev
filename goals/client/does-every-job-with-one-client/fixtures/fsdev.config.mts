/**
 * The HTTP leg's host, as `fsdev serve --config` loads it: the goal's one
 * host over `GOAL_STORE`.
 */
import { goalHost } from "./host.mts";

export default goalHost();
