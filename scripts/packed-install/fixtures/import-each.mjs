/**
 * Runs inside the consumer project the packed-install check builds. Imports
 * each specifier given on argv, in order, and prints one JSON line per
 * specifier: `{ spec, ok, name, code, message }`.
 *
 * It never judges a result. Deciding which failures are acceptable (an
 * optional peer the consumer did not install) is the caller's job, so this
 * file stays a plain probe that behaves the same under the control.
 */
for (const spec of process.argv.slice(2)) {
  try {
    await import(spec);
    console.log(JSON.stringify({ spec, ok: true }));
  } catch (error) {
    console.log(
      JSON.stringify({
        spec,
        ok: false,
        name: error?.name ?? null,
        code: error?.code ?? null,
        message: String(error?.message ?? error).split("\n")[0],
      }),
    );
  }
}
