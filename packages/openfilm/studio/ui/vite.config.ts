import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The workbenches of OpenFilm's own plugins, built with the editor so that they share its modules, each an entry of
 * its own: name → its source, and whether it is put in the page with it (`withPage`: the edit, laid out among the
 * page's panels) or loaded later (the canvas: warmed once the page is drawn, or when first shown). A plugin's
 * `browser` module (plugins/<id>/ui.js) names one as `openfilm/workbench/<name>`.
 */
const WORKBENCHES: Record<string, { src: string; withPage?: boolean }> = {
  edit: { src: at('./src/workbenches/edit.tsx'), withPage: true },
  canvas: { src: at('./src/workbenches/canvas.tsx') },
};

/**
 * The page's import map: `openfilm/workbench/<name>` → the file that entry was built into. It is how a module outside
 * the editor's own files (a plugin's, loaded into the page) names what was built with it.
 */
function importMap(): Plugin {
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
        for (const [name, { withPage }] of Object.entries(WORKBENCHES)) {
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

/* Studio's editor: built once into dist/ and served by Studio's own server (studio/server/server.mjs) */
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwind(), importMap()],
  resolve: { alias: { '@': at('./src') } },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false,
    /* a workbench's entry keeps what it exports (its element): it is imported by name, from outside the build */
    rollupOptions: { preserveEntrySignatures: 'exports-only', input: { main: at('./index.html'), ...Object.fromEntries(Object.entries(WORKBENCHES).map(([name, { src }]) => [`workbench-${name}`, src])) } },
  },
});
