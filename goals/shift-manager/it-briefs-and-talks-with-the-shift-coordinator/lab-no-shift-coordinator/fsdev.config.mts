/**
 * The goal's Lab with no Shift Coordinator: the desk's `asker` worker, the `front`
 * coordinator's one delegate, opened the same way as the desk
 * (`../lab/open-desk.mts`). What the
 * **no Shift Coordinator** leg serves.
 */
import { fileURLToPath } from "node:url";
import { openDesk } from "../lab/open-desk.mts";

export default await openDesk(fileURLToPath(new URL("./workforce", import.meta.url)));
