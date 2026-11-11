#!/usr/bin/env tsx
/**
 * The `fsdev` bin inside this repository: `bin` in the CLI's manifest, run by
 * `tsx` from source, so a workspace package that depends on the CLI (every
 * example, Kitchen Sink) calls plain `fsdev` with nothing built. The published
 * package swaps in `dist/bin.js` through `publishConfig.bin`.
 */
import { program } from "../src/cli.js";

program.parse(process.argv);
