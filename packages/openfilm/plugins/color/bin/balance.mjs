#!/usr/bin/env node
// @ts-check
// `openfilm color balance`: ../grade.mjs says what it does.
import { main } from '../grade.mjs';

process.exitCode = await main('balance');
