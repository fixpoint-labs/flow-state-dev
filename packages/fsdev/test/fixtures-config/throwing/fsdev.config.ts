/**
 * Test fixture: a config that throws while being imported (e.g. an app whose
 * module graph fails at evaluation). The loader must surface the underlying
 * message in a CliError.
 */
throw new Error("boom during config import");
