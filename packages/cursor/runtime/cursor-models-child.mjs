/**
 * Asks Cursor's SDK which models the account can run, in a process whose
 * environment is exactly the run's. `src/model-list.ts` is the other half.
 *
 * In this process, as in the run's (`cursor-runtime-child.mjs`), the SDK finds
 * its key in its own `CURSOR_API_KEY` and its stored login under its own
 * `HOME`, both the run's. Asked in the server's process instead, the SDK would
 * fall back to the server's own key and list another account's models.
 *
 * argv[2] is the module to load the SDK from. Prints one JSON line:
 * `{ "rows": [...] }`, `{ "loadError": "..." }` or `{ "listError": "..." }`.
 */

const sdkModule = process.argv[2] || "@cursor/sdk";

/** An error's message, or the thrown value as text. */
const messageOf = (err) => (err instanceof Error ? err.message : String(err));

let answer;
let models;
try {
  const sdk = await import(sdkModule);
  models = sdk.Cursor?.models;
  if (typeof models?.list !== "function") throw new Error("it exports no Cursor.models.list");
} catch (err) {
  answer = { loadError: messageOf(err) };
}
if (answer === undefined) {
  try {
    answer = { rows: await models.list() };
  } catch (err) {
    answer = { listError: messageOf(err) };
  }
}
process.stdout.write(`${JSON.stringify(answer)}\n`);
process.exit(0);
