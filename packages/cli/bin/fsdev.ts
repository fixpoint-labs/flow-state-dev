#!/usr/bin/env tsx
/**
 * CLI entry point for the fsdev command.
 * Invoked directly via tsx during development, or via compiled dist/index.js when published.
 */
import { program } from "../src/cli.js";

program.parse(process.argv);
