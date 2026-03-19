/**
 * Exit code constants for the fsdev CLI.
 *
 * | Code | Meaning            | Error Codes                                              |
 * |------|--------------------|----------------------------------------------------------|
 * | 0    | Success            | —                                                        |
 * | 1    | Execution error    | EXECUTION_ERROR, EXECUTION_TIMEOUT                       |
 * | 2    | Input/validation   | INPUT_PARSE_ERROR, SEED_VALIDATION_FAILED, ACTION_NOT_FOUND |
 * | 3    | Config error       | CONFIG_NOT_FOUND, CONFIG_INVALID                         |
 * | 4    | Discovery error    | FLOW_NOT_FOUND, BLOCK_NOT_FOUND, DISCOVERY_FAILED        |
 * | 5    | Scaffold error     | SCAFFOLD_CONFLICT, SCAFFOLD_INVALID_TYPE                 |
 * | 10   | Internal error     | Unexpected / unhandled errors                            |
 */
export const EXIT_SUCCESS = 0;
export const EXIT_EXECUTION_ERROR = 1;
export const EXIT_INVALID_ARGS = 2;
export const EXIT_CONFIG_ERROR = 3;
export const EXIT_DISCOVERY_ERROR = 4;
export const EXIT_SCAFFOLD_ERROR = 5;
export const EXIT_INTERNAL_ERROR = 10;
