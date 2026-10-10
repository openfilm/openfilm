/**
 * Put an official build on the download mirror, the place its update feed names (product.official.json's
 * `desktop.updates`, then `<mac|win>/<arch>/`), through any S3-compatible bucket served there. The release pipeline
 * runs it (.github/workflows/desktop.yml); the bucket and its keys are the pipeline's secrets, never in this code.
 *
 *   node scripts/mirror.mjs publish --from <folder> --target mac-arm64|mac-x64|win-x64
 *       uploads a build's versioned files (the folder holds what scripts/release.mjs --official made: the .zip or
 *       .exe, its block map, the .dmg, and latest(-mac).yml), downloads each back from the public address in full to
 *       check it, then switches the beta feed (beta-mac.yml, beta.yml) to it. Stable and the download link do not move.
 *   node scripts/mirror.mjs promote --target <target> --version <x.y.z>
 *       the same build to stable: refused unless the beta feed lists this version and every file it lists is on the
 *       mirror with those bytes. Nothing is uploaded: the stable feed (latest-mac.yml, latest.yml) gets the beta
 *       feed's text, then the download link (OpenFilm-<arch>.dmg, OpenFilm-Setup-<arch>.exe) becomes a copy of the
 *       build.
 *
 * The rules: a versioned file is never replaced with other bytes (release a higher version instead); a feed never goes
 * back to an older version; feeds switch last. The channels are the app's (src/update-channel.mjs).
 *
 * Environment: MIRROR_S3_ENDPOINT, MIRROR_S3_BUCKET, MIRROR_S3_PREFIX (the key prefix the feed URL's path maps to;
 * default `download/desktop`), and the AWS CLI's own AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION.
 * Needs the AWS CLI (v2) on the PATH.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { positionals: [command], values: opts } = parseArgs({
  allowPositionals: true,
  options: { from: { type: 'string' }, target: { type: 'string' }, version: { type: 'string' } },
});
const TARGETS = { 'mac-arm64': ['mac', 'arm64'], 'mac-x64': ['mac', 'x64'], 'win-x64': ['win', 'x64'] };
if (!['publish', 'promote'].includes(command) || !TARGETS[opts.target]) {
  console.error('Usage: node scripts/mirror.mjs publish --from <folder> --target <mac-arm64|mac-x64|win-x64>\n       node scripts/mirror.mjs promote --target <target> --version <x.y.z>');
  process.exit(2);
}
const [os, arch] = TARGETS[opts.target];
const win = os === 'win';

const ENDPOINT = process.env.MIRROR_S3_ENDPOINT;
const BUCKET = process.env.MIRROR_S3_BUCKET;
if (!ENDPOINT || !BUCKET) throw new Error('set MIRROR_S3_ENDPOINT and MIRROR_S3_BUCKET');
const PREFIX = `${(process.env.MIRROR_S3_PREFIX || 'download/desktop').replace(/^\/+|\/+$/g, '')}/${os}/${arch}`;
const product = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../packages/openfilm/product.official.json'), 'utf8'));
const PUBLIC = `${product.desktop.updates.replace(/\/+$/, '')}/${os}/${arch}`;

/** A channel's feed file: electron-updater's channel name, with -mac on macOS. */
const feedName = (channel) => `${channel === 'beta' ? 'beta' : 'latest'}${win ? '' : '-mac'}.yml`;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const FRESH = 'no-cache';
const TYPES = { dmg: 'application/x-apple-diskimage', zip: 'application/zip', exe: 'application/vnd.microsoft.portable-executable', yml: 'text/yaml; charset=utf-8' };
const typeOf = (name) => TYPES[name.split('.').pop()] ?? 'application/octet-stream';

const tmp = mkdtempSync(join(tmpdir(), 'mirror-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

/** The AWS CLI against the mirror's bucket; its JSON answer, or null when the key is not there. */
function s3(args, { missingIsNull = false } = {}) {
  try {
    const out = execFileSync('aws', ['s3api', ...args, '--bucket', BUCKET, '--endpoint-url', ENDPOINT, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() ? JSON.parse(out) : {};
  } catch (error) {
    if (missingIsNull && /\b(404|Not Found|NoSuchKey)\b/.test(String(error.stderr))) return null;
    throw new Error(`aws s3api ${args[0]} ${args[2] ?? ''}: ${String(error.stderr).trim()}`);
  }
}
const head = (name) => s3(['head-object', '--key', `${PREFIX}/${name}`], { missingIsNull: true });
function getText(name) {
  const file = join(tmp, `get-${name}`);
  return s3(['get-object', '--key', `${PREFIX}/${name}`, file], { missingIsNull: true }) ? readFileSync(file, 'utf8') : null;
}
const put = (name, file, cacheControl, metadata = {}) => s3(['put-object', '--key', `${PREFIX}/${name}`, '--body', file,
  '--content-type', typeOf(name), '--cache-control', cacheControl, '--metadata', JSON.stringify(metadata)]);

/** What an electron-builder feed says: its version and its files (url, sha512, size). */
function readFeed(text, where) {
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
  const files = [...text.matchAll(/^\s+- url:\s*['"]?([^'"\s]+)['"]?\s*\n\s+sha512:\s*['"]?([^'"\s]+)['"]?\s*\n\s+size:\s*(\d+)/gm)]
    .map(([, url, sha512, size]) => ({ url, sha512, size: Number(size) }));
  if (!version || !files.length) throw new Error(`${where} is not an update feed`);
  return { version, files };
}
/** Whether version a is below b (x.y.z, a prerelease below its release). */
function below(a, b) {
  const parse = (v) => { const [core, pre] = v.split('-'); return [...core.split('.').map(Number), pre ? 0 : 1, pre ?? '']; };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return x[4] < y[4];
}
const sha512Of = (file) => new Promise((done, fail) => {
  const hash = createHash('sha512');
  createReadStream(file).on('data', (d) => hash.update(d)).on('error', fail).on('end', () => done(hash.digest('base64')));
});

/** The public file, downloaded in full: the same bytes, and byte ranges work (the updater asks for them). */
async function verifyPublic(name, { sha512, size }) {
  const url = `${PUBLIC}/${encodeURIComponent(name)}`;
  let res = await fetch(url, { cache: 'no-store' });
  /* a cache may still hold the 404 from before the upload for a few minutes */
  for (let waited = 0; res.status === 404 && waited < 300; waited += 15) {
    await res.arrayBuffer();
    await new Promise((r) => setTimeout(r, 15000));
    res = await fetch(url, { cache: 'no-store' });
  }
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const hash = createHash('sha512');
  let bytes = 0;
  for await (const chunk of res.body) { hash.update(chunk); bytes += chunk.length; }
  if (bytes !== size || hash.digest('base64') !== sha512) throw new Error(`${url} does not download as built`);
  const range = await fetch(url, { headers: { range: 'bytes=0-15' }, cache: 'no-store' });
  await range.arrayBuffer();
  if (range.status !== 206) throw new Error(`${url} does not answer byte ranges (${range.status})`);
}

/** Switch a feed file to `text`, never to a version older than the one it lists; then read it back publicly. */
async function switchFeed(name, text, version) {
  const live = getText(name);
  if (live) {
    const was = readFeed(live, name).version;
    if (below(version, was)) throw new Error(`${name} is at ${was}: it never goes back to ${version}`);
  }
  const file = join(tmp, `put-${name}`);
  writeFileSync(file, text);
  put(name, file, FRESH);
  for (let tries = 0; ; tries++) {
    const seen = await (await fetch(`${PUBLIC}/${name}`, { cache: 'no-store' })).text();
    if (seen === text) break;
    if (tries >= 10) throw new Error(`the public ${name} is not the new one (a cache in the way?)`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  console.log(`${name}: ${live ? `${readFeed(live, name).version} → ` : ''}${version}`);
}

if (command === 'publish') {
  const from = resolve(opts.from ?? '');
  const feedText = readFileSync(join(from, feedName('stable')), 'utf8');
  const feed = readFeed(feedText, join(from, feedName('stable')));
  const main = win ? `OpenFilm-Setup-${feed.version}-${arch}.exe` : `OpenFilm-${feed.version}-${arch}-mac.zip`;
  /* the updater reads the .zip's (or installer's) block map; the .dmg was re-signed after its map was made */
  const names = win ? [main, `${main}.blockmap`] : [main, `${main}.blockmap`, `OpenFilm-${feed.version}-${arch}.dmg`];
  if (!feed.files.some((f) => f.url === main)) throw new Error(`the feed does not list ${main}: not a ${opts.target} build`);

  for (const name of names) {
    const file = join(from, name);
    if (!existsSync(file)) throw new Error(`no ${name} in ${from}`);
    const size = statSync(file).size;
    const sha512 = await sha512Of(file);
    const listed = feed.files.find((f) => f.url === name);
    if (listed && (listed.sha512 !== sha512 || listed.size !== size)) throw new Error(`${name} is not what the feed lists`);
    const there = head(name);
    if (there && there.Metadata?.sha512 !== sha512) throw new Error(`${name} is already on the mirror with other bytes: release a higher version`);
    if (!there) {
      console.log(`uploading ${name} (${(size / 1048576).toFixed(1)} MB)`);
      put(name, file, IMMUTABLE, { sha512 });
    }
    await verifyPublic(name, { sha512, size });
    console.log(`verified ${PUBLIC}/${name}`);
  }
  await switchFeed(feedName('beta'), feedText, feed.version);
  console.log(`${opts.target} ${feed.version}: live on beta`);
}

if (command === 'promote') {
  if (!opts.version) throw new Error('promote needs --version');
  const betaText = getText(feedName('beta'));
  if (!betaText) throw new Error(`no ${feedName('beta')} on the mirror: publish to beta first`);
  const beta = readFeed(betaText, feedName('beta'));
  if (beta.version !== opts.version) throw new Error(`beta is at ${beta.version}, not ${opts.version}: promote only what beta has`);
  for (const f of beta.files) {
    const there = head(f.url);
    if (!there || there.Metadata?.sha512 !== f.sha512 || there.ContentLength !== f.size) throw new Error(`${f.url} is not on the mirror as beta lists it`);
  }
  await switchFeed(feedName('stable'), betaText, beta.version);
  /* the download link the site points at: a copy of this build's installer */
  const build = win ? `OpenFilm-Setup-${beta.version}-${arch}.exe` : `OpenFilm-${beta.version}-${arch}.dmg`;
  const link = win ? `OpenFilm-Setup-${arch}.exe` : `OpenFilm-${arch}.dmg`;
  const source = head(build);
  if (!source) throw new Error(`${build} is not on the mirror`);
  s3(['copy-object', '--key', `${PREFIX}/${link}`, '--copy-source', `${BUCKET}/${PREFIX}/${build}`, '--metadata-directive', 'REPLACE',
    '--content-type', typeOf(link), '--cache-control', FRESH, '--metadata', JSON.stringify({ sha512: source.Metadata?.sha512 ?? '', version: beta.version })]);
  const res = await fetch(`${PUBLIC}/${link}`, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok || Number(res.headers.get('content-length')) !== source.ContentLength) throw new Error(`${PUBLIC}/${link} is not the new build`);
  console.log(`${opts.target} ${beta.version}: live on stable, ${PUBLIC}/${link}`);
}
