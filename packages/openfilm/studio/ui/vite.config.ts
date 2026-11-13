import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The workbenches of OpenFilm's own plugins, built with the editor so that they share its modules, each an entry of
 * its own: name → source. A plugin's `browser` module (plugins/<id>/ui.js) names one as `openfilm/workbench/<name>`.
 */
const WORKBENCHES: Record<string, string> = { edit: at('./src/workbenches/edit.tsx') };

/**
 * The page's import map: `openfilm/workbench/<name>` → the file that entry was built into. It is how a module outside
 * the editor's own files (a plugin's, loaded into the page) names what was built with it.
 */
function importMap(): Plugin {
  return {
    name: 'openfilm-import-map',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const imports: Record<string, string> = {};
        const tags: HtmlTagDescriptor[] = [];
        for (const chunk of Object.values(ctx.bundle ?? {})) {
          if (chunk.type !== 'chunk' || !chunk.isEntry || !chunk.name.startsWith('workbench-')) continue;
          imports[`openfilm/workbench/${chunk.name.slice('workbench-'.length)}`] = `/${chunk.fileName}`;
          /* a workbench is loaded by its name, not by the editor's own modules: its styles are the page's from the
             start (after the editor's, as when they were part of it), and its code is fetched with the page's */
          for (const css of (chunk as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? []) tags.push({ tag: 'link', attrs: { rel: 'stylesheet', crossorigin: true, href: `/${css}` }, injectTo: 'head' });
          tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `/${chunk.fileName}` }, injectTo: 'head' });
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
    rollupOptions: { preserveEntrySignatures: 'exports-only', input: { main: at('./index.html'), ...Object.fromEntries(Object.entries(WORKBENCHES).map(([name, file]) => [`workbench-${name}`, file])) } },
  },
});
