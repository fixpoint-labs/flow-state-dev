// `src/flow.ts` reads KB_MCP_SECRET at module-evaluation time to decide
// whether to construct the bearer-secret resolver. Set a fixed test value
// here (before any test file's static `import ... from "../src/flow"`
// evaluates) so every test in this package sees one consistent module
// instance of the resolver/error classes. `test/flow.spec.ts` unsets and
// dynamically re-imports the module for the one test that needs to exercise
// the no-secret path.
process.env.KB_MCP_SECRET = "test-secret";
