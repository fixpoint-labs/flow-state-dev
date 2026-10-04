/**
 * The ask-lab's fsdev config: what the `shift-manager` command loads. Set
 * `ASK_LAB_NO_INVENTORY=1` to boot it without opening its inventory.
 */
import { openAskLab } from "./lab.mts";

const opened = await openAskLab({ inventory: process.env.ASK_LAB_NO_INVENTORY !== "1" });

export default opened.flowState;
