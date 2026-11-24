/**
 * Test fixture: a JavaScript config with an extensionless relative import.
 * JavaScript configs keep a plain native import, so this one fails to load.
 */
import { flowKeys } from "./src/flows";

export default { flowKeys };
