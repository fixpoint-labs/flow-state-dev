/**
 * The goal's desk, as Shift Manager's command loads it: the `asker` seat
 * and the `chief-of-staff` seat on a real model, in one mailbox. See
 * `open-desk.mts`.
 */
import { fileURLToPath } from "node:url";
import { openDesk } from "./open-desk.mts";

export default await openDesk(fileURLToPath(new URL("./workforce", import.meta.url)));
