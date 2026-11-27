/**
 * Test fixture: a config module with a named export but no default export.
 * The loader must reject it with a "must default-export a FlowState" CliError.
 */
export const notTheDefault = 42;
