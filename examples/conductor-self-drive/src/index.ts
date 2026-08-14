/**
 * The example's public surface: the operation registry and the helpers around
 * it. The command-line entry point is `./cli`, which runs on import.
 */

export {
  applyOperation,
  findOperation,
  operations,
  UnknownOperationError,
  verifyRegistry,
  type Operation,
} from "./operations";
