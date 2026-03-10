#!/usr/bin/env node
/**
 * CLI entrypoint for `fsdev`. Parses argv and dispatches to the appropriate command.
 */
import { program } from "./cli.js";

program.parse();
