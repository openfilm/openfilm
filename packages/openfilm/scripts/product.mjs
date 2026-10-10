#!/usr/bin/env node
// @ts-check
/**
 * Which build this package is. product.json says where the OpenFilm account service is, and where the desktop app
 * looks for updates: empty in the repository, so a checkout connects to no account service and a build of it updates
 * from nowhere; the official values (public hostnames and a public OAuth client id) are in product.official.json and
 * go into the package npm publishes and into the official desktop app (apps/desktop/scripts/release.mjs --official):
 *
 *   node scripts/product.mjs official   (prepack) keeps product.json aside and writes the official one in its place
 *   node scripts/product.mjs restore    (postpack) puts the kept product.json back
 *
 * OPENFILM_ACCOUNT_URL, _ISSUER and _CLIENT_ID still override it when the package runs (studio/server/account.mjs).
 */
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT = join(ROOT, 'product.json');
const OFFICIAL = join(ROOT, 'product.official.json');
/* .dev/ is git-ignored and not in the package */
const KEPT = join(ROOT, '.dev', 'product.json.kept');

const step = process.argv[2];
if (step === 'official') {
  mkdirSync(join(ROOT, '.dev'), { recursive: true });
  /* a pack that stopped half-way left the checkout's own file aside: keep that one, not the official copy */
  if (!existsSync(KEPT)) copyFileSync(PRODUCT, KEPT);
  copyFileSync(OFFICIAL, PRODUCT);
} else if (step === 'restore') {
  if (existsSync(KEPT)) renameSync(KEPT, PRODUCT);
} else {
  console.error('Usage: node scripts/product.mjs official | restore');
  process.exit(2);
}
