#!/usr/bin/env node
// @ts-check
// `openfilm color filter`: ../grade.mjs says what it does.
import { main } from '../grade.mjs';

process.exitCode = await main('filter');
