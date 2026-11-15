#!/usr/bin/env node
// @ts-check
// `openfilm color set`: cli.mjs says what it does.
import { main } from './cli.mjs';

process.exitCode = await main('set');
