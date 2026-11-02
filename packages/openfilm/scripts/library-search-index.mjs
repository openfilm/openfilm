#!/usr/bin/env node
// @ts-check
/**
 * The library's keyword index (library/search.json): what each thing is searched by (src/library-search.mjs
 * searchRows), worked out once here rather than on every search, with a digest of what it was worked out from. Run
 * after the library's catalogs or tags change (src/library-search.test.mjs fails until it is):
 *
 *   node scripts/library-search-index.mjs
 *
 * A search whose library no longer matches the digest works the rows out itself, as before.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtInRoot, libraryIndex } from '../studio/server/library.mjs';
import { searchFile } from '../src/library-search.mjs';

const text = searchFile(/** @type {any} */ (libraryIndex()));
writeFileSync(join(builtInRoot(), 'search.json'), text);
console.log(`library/search.json: ${(text.length / 1e6).toFixed(2)} MB`);
