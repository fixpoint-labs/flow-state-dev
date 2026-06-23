/**
 * Test fixture: a config whose default export is a plain object, not a
 * FlowState. The loader must reject it with a "must default-export" CliError.
 */
export default { hello: "world" };
