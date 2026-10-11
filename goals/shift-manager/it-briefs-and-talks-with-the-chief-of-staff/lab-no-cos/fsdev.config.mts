/**
 * The goal's Lab with no chief of staff: the desk's `asker` worker, the `front`
 * coordinator's one delegate, opened the same way as the desk
 * (`../lab/open-desk.mts`). What the
 * **no CoS** leg serves.
 */
import { fileURLToPath } from "node:url";
import { openDesk } from "../lab/open-desk.mts";

export default await openDesk(fileURLToPath(new URL("./workforce", import.meta.url)));
