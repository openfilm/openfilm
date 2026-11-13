#!/usr/bin/env node
// @ts-check
/**
 * `openfilm edit look [what] [t | a-b]`: the edit's look (src/plugin-look.mjs, the `look` convention), which is
 * `openfilm look` itself: the film drawn as a contact sheet, with its sound and loudness. Every word after `look` is
 * given to it as typed, and what it prints and its exit status are its own.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OPENFILM = fileURLToPath(new URL('../../bin/openfilm.mjs', import.meta.url));

const child = spawn(process.execPath, [OPENFILM, 'look', ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', (e) => { console.error(`openfilm edit look: ${e.message}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
