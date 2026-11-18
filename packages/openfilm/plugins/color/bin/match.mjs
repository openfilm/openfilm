#!/usr/bin/env node
// @ts-check
// `openfilm color match`: ../grade.mjs says what it does.
import { main } from '../grade.mjs';

process.exitCode = await main('match');
