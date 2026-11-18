#!/usr/bin/env node
// @ts-check
// `openfilm color look`: ../grade.mjs says what it does.
import { main } from '../grade.mjs';

process.exitCode = await main('look');
