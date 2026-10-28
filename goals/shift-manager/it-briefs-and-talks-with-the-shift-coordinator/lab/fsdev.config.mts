/**
 * The goal's desk, as Shift Manager's command loads it: the `asker` worker
 * and the `shift-coordinator` worker on a real model, both delegates of the
 * `front` coordinator. See `open-desk.mts`.
 */
import { fileURLToPath } from "node:url";
import { openDesk } from "./open-desk.mts";

export default await openDesk(fileURLToPath(new URL("./workforce", import.meta.url)));
