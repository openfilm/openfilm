import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import type { Plugin as PostcssPlugin } from 'postcss';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The app's window: one page, Studio's editor and the chat beside it, built into shell/dist and served by the app's
 * Studio as its editor (studio-process.mjs `editorDir`). Studio's sources are the open-source ones as they are.
 */
const STUDIO = join(dirname(createRequire(import.meta.url).resolve('openfilm/package.json')), 'studio/ui/src/');
const CHAT = fileURLToPath(new URL('../chat/src/', import.meta.url));

/** `@/…` is the importing file's own tree: Studio's files and the chat's each name their `src` so. */
function twoTrees(): Plugin {
  return {
    name: 'openfilm-two-trees',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (!source.startsWith('@/') || !importer) return null;
      const base = importer.startsWith(CHAT) ? CHAT : STUDIO;
      return this.resolve(join(base, source.slice(2)), importer, { ...options, skipSelf: true });
    },
  };
}

/**
 * The chat's styles, kept to the chat: every selector applies inside `.of-chat` (its column and its layer); `:root`,
 * `html` and `body` mean the chat itself; a theme on the page reaches the chat under it. Rules only a page of the
 * chat's own needed (its title bar, the see-through column, a theme from the system, the focus ring and the timeline
 * cursor Studio already has) are left out.
 */
const scopeChat: PostcssPlugin = {
  postcssPlugin: 'openfilm-scope-chat',
  Once(root, { result }) {
    if (!result.opts.from?.startsWith(CHAT)) return;
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as { name: string }).name)) return;
      const selectors = new Set<string>();
      for (const raw of rule.selectors) {
        const s = raw.trim();
        if (/:not\(\[data-theme\]\)|data-assets-open|openfilm-inset-titlebar|openfilm-fullscreen|tl-scrubbing|data-focus-nav/.test(s)) continue;
        const page = /^(?::root|html|body)(?![\w-])/.exec(s);
        const theme = /^\[data-theme='(?:light|dark)'\]/.exec(s);
        if (page) selectors.add(`.of-chat${s.slice(page[0].length)}`);
        else if (theme) selectors.add(`${theme[0]} .of-chat${s.slice(theme[0].length)}`);
        else selectors.add(`.of-chat ${s}`);
      }
      if (selectors.size) rule.selectors = [...selectors];
      else rule.remove();
    });
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [twoTrees(), react(), tailwind()],
  css: { postcss: { plugins: [scopeChat] } },
  /* one React for both trees (each would find its own package's otherwise) */
  resolve: { dedupe: ['react', 'react-dom', 'lucide-react'] },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
});
