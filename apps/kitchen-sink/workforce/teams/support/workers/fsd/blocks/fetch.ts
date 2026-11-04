/**
 * `fetch`: read one page by its URL, for `support.fsd` alone (this folder
 * registers it for that worker; its `tools:` line grants it).
 *
 * The tools package's own `fetch`, unchanged. It needs no key: with no
 * provider configured it falls back to a plain fetch.
 */
import { fetch } from "@flow-state-dev/tools/fetch";

export default fetch();
