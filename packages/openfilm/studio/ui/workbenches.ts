/**
 * The workbenches of OpenFilm's own plugins, built with the editor so that they share its modules, each an entry of
 * its own. Both pages that hold the editor build them: Studio's own (vite.config.ts) and the desktop app's window
 * (apps/desktop/shell/vite.config.ts). A plugin's `browser` module (plugins/<id>/ui.js) names one as
 * `openfilm/workbench/<name>`, which the page's import map turns into the file it was built into. Which there are is
 * read from the plugins themselves: one is added with its plugin's folder and its source, nothing else.
 */
import type { HtmlTagDescriptor, Plugin } from 'vite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrangementOf } from './src/lib/workspaces.ts';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** OpenFilm's own plugins, each a folder (src/plugins.mjs), and the sources of the workbenches they bring. */
const PLUGINS = at('../../plugins/');
const SOURCES = at('./src/plugins/');

/** What a plugin's `browser` module names of the page's own: `from 'openfilm/workbench/<name>'`. */
const NAMED = /\bfrom\s*['"]openfilm\/workbench\/([a-z][a-z0-9-]{0,31})['"]/;

const readJson = (path: string): Record<string, unknown> | null => {
  try { const v: unknown = JSON.parse(readFileSync(path, 'utf8')); return v && typeof v === 'object' ? v as Record<string, unknown> : null; } catch { return null; }
};

/**
 * Name → its source, and whether it is put in the page with it (`withPage`) or loaded later. A plugin whose `browser`
 * module names `openfilm/workbench/<name>` brings it, built from `src/plugins/<name>/index.tsx`; several may name one
 * (Motion's names the edit's). In the plugins' order (openfilm.json `order`, then the folder's name), as Studio lists
 * them. `withPage`: one the shell lays out among the page's panels (lib/workspaces arrangementOf of the plugin's
 * `workbench`: the edit, and Motion with it) is put in the page with it; any other (the canvas, warmed once the page
 * is drawn or when first shown; one that takes the panes' place) is loaded when it is wanted.
 */
function workbenches(): Map<string, { src: string; withPage: boolean }> {
  const named = readdirSync(PLUGINS, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
    const browser = readJson(join(PLUGINS, e.name, 'package.json'))?.browser;
    if (typeof browser !== 'string') return [];
    let module: string;
    try { module = readFileSync(join(PLUGINS, e.name, browser), 'utf8'); } catch { return []; }
    const name = NAMED.exec(module)?.[1];
    if (!name) return [];
    const manifest = readJson(join(PLUGINS, e.name, 'openfilm.json'));
    const order = typeof manifest?.order === 'number' && Number.isFinite(manifest.order) ? manifest.order : 1000;
    const amongPanels = typeof manifest?.workbench === 'string' && arrangementOf(manifest.workbench) === 'edit';
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

/** The build's entries for them, beside the page's own: `workbench-<name>` → its source. */
export const workbenchInputs = (): Record<string, string> =>
  Object.fromEntries([...workbenches()].map(([name, { src }]) => [`workbench-${name}`, src]));

/**
 * The page's import map: `openfilm/workbench/<name>` → the file that entry was built into. It is how a module outside
 * the editor's own files (a plugin's, loaded into the page) names what was built with it. The build keeps each
 * entry's exports (`preserveEntrySignatures: 'exports-only'`): it is imported by name, from outside the build.
 */
export function workbenchImportMap(): Plugin {
  return {
    name: 'openfilm-import-map',
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
        /* before any module of the page: a map read after one has loaded is not used */
        return [{ tag: 'script', attrs: { type: 'importmap' }, children: JSON.stringify({ imports }), injectTo: 'head-prepend' }, ...tags];
      },
    },
  };
}
