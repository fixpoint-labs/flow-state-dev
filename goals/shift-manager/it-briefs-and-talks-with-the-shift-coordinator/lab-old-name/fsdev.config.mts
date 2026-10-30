/**
 * The goal's desk with its point of contact under the retired id: the `asker`
 * worker and a worker named `chief-of-staff`, both delegates of the `front`
 * coordinator, opened the same way as the desk (`../lab/open-desk.mts`). What
 * the **old name** leg serves: the old id never reaches the Shift Coordinator.
 */
import { fileURLToPath } from "node:url";
import { openDesk } from "../lab/open-desk.mts";

export default await openDesk(fileURLToPath(new URL("./workforce", import.meta.url)));
