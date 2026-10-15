/**
 * The skill store's index: the skills on offer, as the skills repository's index.json lists them (internal design
 * §10.1): each with its source (a repository, a folder in it and the commit it is pinned to), its badge, its title and
 * summary in each language, its category, author, version, preview (poster, demo video), the scripts it brings and
 * what it needs.
 *
 * Read from the official address (OPENFILM_SKILLS_INDEX names another: a web address or a file, for development),
 * and kept in the app's data folder: offline, the last one read is shown. A preview's address may be relative to the
 * index's own; it is made whole here. Anything that is not a skill as listed is left out.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where the official index is published (the site, beside the downloads). */
export const OFFICIAL_INDEX = 'https://openfilm.dev/skills/index.json';
const BADGES = new Set(['official', 'reviewed', 'community']);
const CATEGORIES = new Set(['format', 'style', 'capability', 'brand']);
/** how long a read may take before the one kept is shown */
const READ_MS = 8000;

const words = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).filter(([k, t]) => typeof k === 'string' && typeof t === 'string')) : typeof v === 'string' ? { en: v } : {});

/** An index as read, made whole and checked: its skills, each as the store shows it. */
export function normalizeIndex(raw, base) {
  const whole = (u) => { if (typeof u !== 'string' || !u) return undefined; try { return new URL(u, base).href; } catch { return undefined; } };
  const skills = (Array.isArray(raw?.skills) ? raw.skills : []).flatMap((s) => {
    if (typeof s?.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.id) || typeof s.source?.repo !== 'string') return [];
    const title = words(s.title);
    if (!Object.keys(title).length) return [];
    return [{
      id: s.id,
      source: { repo: s.source.repo, path: String(s.source.path ?? ''), ...(s.source.commit ? { commit: String(s.source.commit) } : {}) },
      badge: BADGES.has(s.badge) ? s.badge : 'community',
      title,
      summary: words(s.summary),
      category: CATEGORIES.has(s.category) ? s.category : 'format',
      tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [],
      author: { name: String(s.author?.name ?? ''), ...(typeof s.author?.url === 'string' ? { url: s.author.url } : {}) },
      version: String(s.version ?? ''),
      preview: { poster: whole(s.preview?.poster), video: whole(s.preview?.video) },
      scripts: Number(s.scripts) || 0,
      size: Number(s.size) || 0,
      testedWith: Array.isArray(s.testedWith) ? s.testedWith.filter((t) => typeof t === 'string') : [],
      needs: (Array.isArray(s.needs) ? s.needs : []).filter((n) => ['file', 'text', 'service'].includes(n?.kind)).map((n) => ({ kind: n.kind, what: String(n.what ?? ''), label: words(n.label), ...(n.optional ? { optional: true } : {}) })),
      featured: Number(s.featured) || 0,
      ...(typeof s.updated === 'string' ? { updated: s.updated } : {}),
    }];
  });
  return { version: Number(raw?.version) || 1, updated: String(raw?.updated ?? ''), skills };
}

/**
 * The store's index: `{ ok, index, offline }` (offline: the one kept from before, as the address could not be read),
 * or `{ ok: false, error }` when there is neither.
 * @param {{ dataDir: string, address?: string, fetch?: typeof fetch }} o
 */
export async function readStoreIndex({ dataDir, address = process.env.OPENFILM_SKILLS_INDEX || OFFICIAL_INDEX, fetch: fetchImpl = fetch }) {
  const kept = join(dataDir, 'skills-index.json');
  const base = /^https?:\/\//i.test(address) ? address : pathToFileURL(address).href;
  try {
    let raw;
    if (/^https?:\/\//i.test(address)) {
      const res = await fetchImpl(address, { signal: AbortSignal.timeout(READ_MS) });
      if (!res.ok) throw new Error(`The store answered ${res.status}.`);
      raw = await res.json();
    } else raw = JSON.parse(readFileSync(address, 'utf8'));
    const index = normalizeIndex(raw, base);
    try { mkdirSync(dataDir, { recursive: true }); writeFileSync(kept, JSON.stringify({ base, raw })); } catch { /* kept next time */ }
    return { ok: true, index, offline: false };
  } catch (e) {
    try {
      const { base: keptBase, raw } = JSON.parse(readFileSync(kept, 'utf8'));
      return { ok: true, index: normalizeIndex(raw, keptBase), offline: true };
    } catch {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
