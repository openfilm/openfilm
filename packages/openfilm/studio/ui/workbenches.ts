/**
 * The workbenches of OpenFilm's own plugins, built with the editor so that they share its modules, each an entry of
 * its own. Both pages that hold the editor build them: Studio's own (vite.config.ts) and the desktop app's window
 * (apps/desktop/shell/vite.config.ts). A plugin's `browser` module (plugins/<id>/ui.js) names one as
 * `openfilm/workbench/<name>`, which the page's import map turns into the file it was built into. Which there are is
 * read from the plugins themselves: one is added with its plugin's folder and its source, nothing else.
 */
import type { HtmlTagDescriptor, Plugin } from 'vite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBlocks } from '../../src/plugin-blocks.mjs';
import { arrangementOf } from './src/lib/blocks.ts';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** OpenFilm's own plugins, each a folder (src/plugins.mjs), and the sources of the workbenches they bring. */
const PLUGINS = at('../../plugins/');
const SOURCES = at('./src/plugins/');

/**
 * The page's own copy of a package, as an entry: `openfilm-page-copy:react` is a module that exports what `react`
 * exports, each by its name. It is written out name by name, as React's modules are CommonJS, whose names a module
 * that only says `export * from 'react'` would not carry.
 */
const PAGE_COPY = 'openfilm-page-copy:';
const pageCopy = (name: string): string => {
  const names = Object.keys(createRequire(import.meta.url)(name) as object).filter((key) => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default');
  return `export { default } from '${name}';\nexport { ${names.join(', ')} } from '${name}';\n`;
};

/** What a plugin's `browser` module names of the page's own: `from 'openfilm/workbench/<name>'`. */
const NAMED = /\bfrom\s*['"]openfilm\/workbench\/([a-z][a-z0-9-]{0,31})['"]/;

const readJson = (path: string): Record<string, unknown> | null => {
  try { const v: unknown = JSON.parse(readFileSync(path, 'utf8')); return v && typeof v === 'object' ? v as Record<string, unknown> : null; } catch { return null; }
};

/**
 * Name → its source, and whether it is put in the page with it (`withPage`) or loaded later. A plugin whose `browser`
 * module names `openfilm/workbench/<name>` brings it, built from `src/plugins/<name>/index.tsx`; several may name one
 * (Motion's names the edit's). In the plugins' order (openfilm.json `order`, then the folder's name), as Studio lists
 * them. `withPage`: one the shell lays out among the page's panels in the edit's arrangement (lib/blocks arrangementOf of the plugin's
 * `workbench`: the edit, and Motion with it) is put in the page with it; any other (the canvas, warmed once the page
 * is drawn or when first shown; one that takes the panes' place) is loaded when it is wanted.
 */
function workbenches(): Map<string, { src: string; withPage: boolean }> {
  /* each plugin's workbench and the blocks it is laid out in, to know which are laid out in the edit's arrangement */
  const laidOut = readdirSync(PLUGINS, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
    const manifest = readJson(join(PLUGINS, e.name, 'openfilm.json'));
    return typeof manifest?.workbench === 'string' ? [{ workbench: manifest.workbench, blocks: readBlocks(manifest.blocks) }] : [];
  });
  const named = readdirSync(PLUGINS, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
    const browser = readJson(join(PLUGINS, e.name, 'package.json'))?.browser;
    if (typeof browser !== 'string') return [];
    let module: string;
    try { module = readFileSync(join(PLUGINS, e.name, browser), 'utf8'); } catch { return []; }
    const name = NAMED.exec(module)?.[1];
    if (!name) return [];
    const manifest = readJson(join(PLUGINS, e.name, 'openfilm.json'));
    const order = typeof manifest?.order === 'number' && Number.isFinite(manifest.order) ? manifest.order : 1000;
    const amongPanels = typeof manifest?.workbench === 'string' && arrangementOf(manifest.workbench, laidOut) === 'edit';
    return [{ id: e.name, browser, name, order, amongPanels }];
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const out = new Map<string, { src: string; withPage: boolean }>();
  for (const { id, browser, name, amongPanels } of named) {
    const src = join(SOURCES, name, 'index.tsx');
    if (!existsSync(src)) throw new Error(`plugins/${id}/${browser} names openfilm/workbench/${name}, which has no source: studio/ui/src/plugins/${name}/index.tsx`);
    out.set(name, { src, withPage: (out.get(name)?.withPage ?? false) || amongPanels });
  }
  return out;
}

/**
 * The modules the page names for any plugin's element (packages/openfilm/plugins/README.md), each an entry of its own:
 * Studio's public interface (`openfilm/studio`, and its React layer), and the page's own React, so an element drawn
 * with React draws with the same one. Name in the import map → [the entry's name, its source].
 */
const SHARED: Record<string, [string, string]> = {
  'openfilm/studio': ['studio', at('./src/studio/index.ts')],
  'openfilm/studio/react': ['studio-react', at('./src/studio/react.ts')],
  ...Object.fromEntries(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].map((name) => [name, [`shared-${name.replace('/', '-')}`, `${PAGE_COPY}${name}`]])),
};

/** The build's entries for them, beside the page's own: `workbench-<name>` → its source, and the shared modules. */
export const workbenchInputs = (): Record<string, string> => ({
  ...Object.fromEntries([...workbenches()].map(([name, { src }]) => [`workbench-${name}`, src])),
  ...Object.fromEntries(Object.values(SHARED)),
});

/**
 * The page's import map: `openfilm/workbench/<name>` → the file that entry was built into, and so for each shared
 * module (`openfilm/studio`, `react`…). It is how a module outside the editor's own files (a plugin's, loaded into the
 * page) names what was built with it. The build keeps each
 * entry's exports (`preserveEntrySignatures: 'exports-only'`): it is imported by name, from outside the build.
 */
export function workbenchImportMap(): Plugin {
  return {
    name: 'openfilm-import-map',
    resolveId: (id) => (id.startsWith(PAGE_COPY) ? `\0${id}` : null),
    load: (id) => (id.startsWith(`\0${PAGE_COPY}`) ? pageCopy(id.slice(PAGE_COPY.length + 1)) : null),
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle ?? {};
        const imports: Record<string, string> = {};
        const tags: HtmlTagDescriptor[] = [];
        /* the styles a chunk needs: those of the chunks it imports, then its own */
        const stylesOf = (fileName: string, seen: Set<string>): string[] => {
          const chunk = bundle[fileName];
          if (chunk?.type !== 'chunk' || seen.has(fileName)) return [];
          seen.add(fileName);
          return [...chunk.imports.flatMap((dep) => stylesOf(dep, seen)), ...((chunk as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? [])];
        };
        const linked = new Set<string>();
        for (const [name, { withPage }] of workbenches()) {
          const chunk = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry && c.name === `workbench-${name}`);
          if (chunk?.type !== 'chunk') continue;
          imports[`openfilm/workbench/${name}`] = `/${chunk.fileName}`;
          /* a workbench is loaded by its name, not by the editor's own modules: its styles (and those of what it
             imports that the page has not linked) are the page's from the start, after the editor's, as when they
             were part of it; the code of one put in the page with it is fetched with the page's */
          for (const css of stylesOf(chunk.fileName, new Set())) {
            if (linked.has(css) || html.includes(`/${css}"`)) continue;
            linked.add(css);
            tags.push({ tag: 'link', attrs: { rel: 'stylesheet', crossorigin: true, href: `/${css}` }, injectTo: 'head' });
          }
          if (withPage) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `/${chunk.fileName}` }, injectTo: 'head' });
        }
        for (const [named, [entry]] of Object.entries(SHARED)) {
          const chunk = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry && c.name === entry);
          if (chunk?.type === 'chunk') imports[named] = `/${chunk.fileName}`;
        }
        /* before any module of the page: a map read after one has loaded is not used */
        return [{ tag: 'script', attrs: { type: 'importmap' }, children: JSON.stringify({ imports }), injectTo: 'head-prepend' }, ...tags];
      },
    },
  };
}
