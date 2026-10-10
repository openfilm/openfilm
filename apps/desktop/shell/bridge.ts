/**
 * The window is one page: Studio's editor, and the chat in the column Studio leaves for it. This is what each gets
 * from the other and from the app, in the page:
 *
 *   · window.openfilmHost    Studio's host (its lib/host.ts StudioHost): the window's controls, the chat's column,
 *                            "Reference in chat", Settings → Agents.
 *   · window.openfilmDesktop the chat's bridge (chat/src/app-bridge.ts and lib/desktop-bridge.ts).
 *
 * What only the app can do (the agents, a file on the disk, the window, updates) is the preload's `openfilmNative`
 * (src/preload.cjs). Imported before Studio's modules and the chat's: Studio reads its host as it loads.
 */
import { flushSync } from 'react-dom';
import type { HostAgent, HostAsk, StudioCommand, StudioHost, StudioRef, StudioSelection } from 'openfilm/studio-ui/lib/host.ts';

type Listener<T> = (value: T) => void;
type Stop = () => void;
type Theme = 'light' | 'dark';
type Project = { id: string; name: string; path: string };

interface Native {
  platform: string;
  hello(): Promise<{ flavor: string; version: string; ffmpeg: unknown; update: unknown; chatOpen: boolean; chatWidth: number; chatMin: number; studioMin: number; fullScreen: boolean }>;
  pathForFile(file: File): string;
  revealPath(path: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  capture(rect: { x: number; y: number; width: number; height: number }): Promise<string | null>;
  agents: NonNullable<StudioHost['agents']>;
  localAgents: Record<string, unknown>;
  importFile(request: { projectId: string; path: string; name: string }): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  chat: Record<string, (...args: never[]) => Promise<unknown>>;
  prefs: { get(): Promise<{ developer: boolean }>; set(next: { developer?: boolean }): Promise<unknown>; onChange(listener: Listener<{ developer: boolean }>): Stop };
  saveLayout(layout: { chatOpen: boolean; chatWidth: number }): void;
  setTheme(theme: Theme): void;
  onFullScreen(listener: Listener<boolean>): Stop;
  onToggleChat(listener: Listener<void>): Stop;
  onStudioBrowser(listener: Listener<unknown>): Stop;
  onFfmpeg(listener: Listener<unknown>): Stop;
  onUpdate(listener: Listener<unknown>): Stop;
  restartToUpdate(): Promise<{ ok: boolean; error?: string }>;
}

const native = (window as unknown as { openfilmNative: Native }).openfilmNative;
const hello = native.hello();

/** A value that tells its listeners when it changes. */
function signal<T>(value: T) {
  const listeners = new Set<Listener<T>>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const listener of listeners) listener(next); },
    on(listener: Listener<T>): Stop { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
const events = <T,>() => signal<T>(undefined as T);

/* ── the chat's column: open or not, how wide, and the assets drawer over it ── */
const TOP_BAR = 32;
const column = document.getElementById('of-chat')!;
const layout = { open: true, width: 420, min: 340, studioMin: 640 };
/** the assets open in the column (Studio draws them, above the composer); `bottom`: the composer's height, all the
    chat shows then */
const assets = { open: false, bottom: 120 };
const assetsSignal = signal(false);
const chatOpenSignal = signal(true);

/** The column's width as the window allows it: Studio keeps its least width, the chat its own while it fits. */
const shownWidth = () => (layout.open ? Math.max(Math.min(layout.width, innerWidth - layout.studioMin), Math.min(layout.min, innerWidth)) : 0);
const panelState = () => ({ open: layout.open, width: shownWidth(), assets: { open: assets.open && layout.open, bottom: assets.bottom } });
const panelListeners = new Set<Listener<ReturnType<typeof panelState>>>();

function place() {
  column.hidden = !layout.open;
  column.style.width = `${shownWidth()}px`;
  column.style.top = `${TOP_BAR}px`;
  /* the column never moves or resizes for the assets: the chat shows only its composer then, and the rest of the
     column lets the drawer under it be seen and used (shell.css) */
  column.toggleAttribute('data-assets-open', assets.open && layout.open);
  const state = panelState();
  for (const listener of panelListeners) listener(state);
}
addEventListener('resize', place);

function setChatOpen(open: boolean) {
  if (open === layout.open) return;
  layout.open = open;
  flushSync(() => {
    if (!open && assets.open) { assets.open = false; assetsSignal.set(false); }
    place();
    chatOpenSignal.set(open);
  });
  native.saveLayout({ chatOpen: layout.open, chatWidth: layout.width });
}
function setChatWidth(width: number, done = false) {
  if (!Number.isFinite(width)) return;
  layout.width = Math.round(Math.max(layout.min, Math.min(width, innerWidth - layout.studioMin)));
  place();
  if (done) native.saveLayout({ chatOpen: layout.open, chatWidth: layout.width });
}
function setAssetsOpen(open: boolean) {
  if (open && !layout.open) setChatOpen(true);
  assets.open = open && layout.open;
  /* the chat folding to its composer and Studio's drawer appearing are one frame: neither is seen without the other */
  flushSync(() => {
    assetsSignal.set(assets.open);
    place();
  });
}
native.onToggleChat(() => setChatOpen(!layout.open));

/* ── the theme and the language are the page's (Studio sets them on <html>) ── */
const root = document.documentElement;
const themeOf = (): Theme => (root.dataset.theme === 'dark' ? 'dark' : 'light');
const theme = signal<Theme>(themeOf());
const language = signal(root.lang || 'en');
new MutationObserver(() => {
  if (themeOf() !== theme.get()) theme.set(themeOf());
  if ((root.lang || 'en') !== language.get()) language.set(root.lang || 'en');
}).observe(root, { attributes: true, attributeFilter: ['data-theme', 'lang'] });
/* the window behind the page, and the system's menus and dialogs, take the same theme */
native.setTheme(theme.get());
theme.on((next) => native.setTheme(next));

/* ── the project Studio shows (its address, /projects/<id>) ── */
const project = signal<Project | null>(null);
let projectReady: Promise<void> = Promise.resolve();
async function follow() {
  const id = /^\/projects\/([\w-]+)/.exec(location.pathname)?.[1] ?? null;
  if (!id || id === project.get()?.id) return;
  try {
    const res = await fetch('/api/projects');
    const body = await res.json() as { projects?: Project[] };
    const found = body.projects?.find((p) => p.id === id);
    if (found) project.set({ id: found.id, name: found.name, path: found.path });
  } catch { /* told next time the address changes */ }
}
for (const method of ['pushState', 'replaceState'] as const) {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History['pushState']>) => { original(...args); projectReady = follow(); };
}
addEventListener('popstate', () => { projectReady = follow(); });
projectReady = follow();

/* ── between Studio and the chat: what is selected, what is referenced, what Studio is asked to show ── */
const selection = signal<StudioSelection | null>(null);
const refer = events<StudioRef>();
/** what the pointer is over in Studio (null: nothing), for the chat to light its pills that point at it */
const hover = signal<StudioRef | null>(null);
let command: ((command: StudioCommand) => void) | null = null;
const fullScreen = signal(false);
native.onFullScreen((full) => fullScreen.set(full));

/*
 * ── a reference's picture of the viewer (StudioRefImage `viewer`): what the person sees there now, taken by the app as
 * they point at it. The picture's overlays (selection frames, handles, Studio's toolbars) step aside for that frame;
 * the subtitles stay, they are part of the picture. Without a viewer on screen, or when the app cannot take it, the
 * reference goes without a picture.
 */
let pictured: Promise<void> = Promise.resolve();
const captureStyle = document.createElement('style');
captureStyle.textContent = '[data-capturing] [data-film-select], [data-capturing] [data-capture-hide] { visibility: hidden !important; }';
document.head.append(captureStyle);
const nextFrame = () => new Promise<void>((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done())); });
async function withPicture(ref: StudioRef): Promise<StudioRef> {
  const image = ref.image;
  if (!image?.viewer) return ref;
  const { image: _viewer, ...bare } = ref;
  document.documentElement.toggleAttribute('data-capturing', true);
  try {
    await nextFrame();
    const film = [...document.querySelectorAll<HTMLIFrameElement>('iframe[title="film"]')]
      .find((f) => f.getBoundingClientRect().width > 0 && getComputedStyle(f).visibility !== 'hidden');
    if (!film) return bare as StudioRef;
    const r = film.getBoundingClientRect();
    let box = { x: r.left, y: r.top, width: r.width, height: r.height };
    if (image.crop && image.stage?.w) {
      const k = r.width / image.stage.w;
      /* an element is shown with what is around it (a line of text alone is a strip the agent cannot place); a region
         is what the person drew, as drawn */
      const pad = ref.kind === 'layer' ? Math.max(120, Math.max(image.crop.w, image.crop.h) / 2) : 0;
      const crop = { x: image.crop.x - pad, y: image.crop.y - pad, w: image.crop.w + 2 * pad, h: image.crop.h + 2 * pad };
      const left = Math.max(r.left, r.left + crop.x * k);
      const top = Math.max(r.top, r.top + crop.y * k);
      const right = Math.min(r.right, r.left + (crop.x + crop.w) * k);
      const bottom = Math.min(r.bottom, r.top + (crop.y + crop.h) * k);
      box = { x: left, y: top, width: right - left, height: bottom - top };
    }
    const jpeg = await native.capture(box).catch(() => null);
    return (jpeg ? { ...bare, image: { src: `data:image/jpeg;base64,${jpeg}` } } : bare) as StudioRef;
  } finally {
    document.documentElement.toggleAttribute('data-capturing', false);
  }
}

/* ── what an agent's command asks before it spends (Studio words it): the chat shows it above its composer ── */
const asks = signal<HostAsk[]>([]);
let answerAsk: (id: string, allow: boolean) => void = () => {};

/* ── the app's developer mode (Settings → Developer, kept by the app): Studio switches it, the chat shows logs by it ── */
const developer = {
  get: async () => (await native.prefs.get()).developer,
  set: (on: boolean) => native.prefs.set({ developer: on }),
  onChange: (listener: Listener<boolean>) => native.prefs.onChange((prefs) => listener(prefs.developer)),
};

/* ── Studio's host ── */
const mac = native.platform === 'darwin';
const windows = native.platform === 'win32';
/** the window's own controls: macOS's traffic lights end at 66 px (Studio's logo a little after them); Windows draws
    its buttons over the top bar's right */
const INSET = 74;
const INSET_RIGHT = 138;

const host: StudioHost = {
  version: 1,
  name: 'OpenFilm',
  ...(mac ? { titlebar: { inset: INSET, onChange: (listener: Listener<number>) => { fullScreen.on((full) => listener(full ? 6 : INSET)); } } } : {}),
  ...(windows ? { titlebar: { inset: 6, insetRight: INSET_RIGHT } } : {}),
  /* in order, each with its picture: two pointed at quickly must not swap or share a screenshot */
  refer: (ref) => {
    if (!layout.open) setChatOpen(true);
    pictured = pictured.then(() => withPicture(ref)).then((done) => refer.set(done));
  },
  onSelection: (next) => selection.set(next),
  onHover: (ref) => hover.set(ref ?? null),
  onCommand: (listener) => { command = listener; },
  /* read live: Studio may read the panel before or after the kept layout arrives */
  panel: {
    label: 'Chat',
    get open() { return layout.open; },
    get width() { return shownWidth(); },
    get assets() { return panelState().assets; },
    setOpen: setChatOpen,
    setAssetsOpen,
    setWidth: (width, done) => setChatWidth(width, done === true),
    onChange: (listener) => { panelListeners.add(listener); listener(panelState()); },
  },
  agents: native.agents,
  asks: { show: (list, answer) => { answerAsk = answer; asks.set(list); } },
  developer,
  folders: { pick: native.pickFolder, pathOf: native.pathForFile },
};
(window as unknown as { openfilmHost: StudioHost }).openfilmHost = host;

/* the layout the app kept: the panel starts as it was, before Studio first reads it */
const ready = hello.then((h) => {
  layout.open = h.chatOpen;
  layout.width = h.chatWidth;
  layout.min = h.chatMin;
  layout.studioMin = h.studioMin;
  fullScreen.set(h.fullScreen);
  chatOpenSignal.set(layout.open);
  place();
  return h;
});

/* ── the chat's bridge ── */
/** Where a reference takes the person: the clip selected, the moment, the range marked, the box shown, the track, the
    file. A layer whose place on the picture Studio told is shown as that box (it is what was pointed at); one without,
    by its clip. */
function commandFor(ref: StudioRef): StudioCommand {
  switch (ref.kind) {
    case 'clip': return { type: 'select-clip', id: ref.id, loc: ref.loc, seek: true };
    case 'layer': return ref.box && typeof ref.time === 'number'
      ? { type: 'show-box', time: ref.time, box: ref.box }
      : { type: 'select-clip', id: ref.clipId, loc: ref.loc, seek: true };
    case 'region': return { type: 'show-box', time: ref.time, box: ref.box };
    case 'time': return { type: 'seek', time: ref.time };
    case 'range': return { type: 'show-range', start: ref.start, end: ref.end };
    case 'track': return { type: 'show-track', track: ref.track };
    case 'file': return { type: 'show-file', path: ref.path };
    case 'subtitle': return { type: 'show-subtitle', start: ref.start, end: ref.end };
  }
}
const uploadName = (name: string) => name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]+/g, '').slice(0, 200) || 'file';

(window as unknown as { openfilmDesktop: unknown }).openfilmDesktop = {
  bridgeVersion: '1',
  platform: native.platform,
  pathForFile: native.pathForFile,
  revealPath: native.revealPath,
  agents: {
    list: native.agents.list,
    connect: native.agents.connect,
    onChange: native.agents.onChange,
  },
  localAgents: native.localAgents,
  openSettings: (section: string) => command?.({ type: 'settings', section: section === 'providers' ? 'providers' : 'agents' }),
  async hello() {
    const h = await ready;
    await projectReady;
    return {
      platform: native.platform, flavor: h.flavor, theme: theme.get(), language: language.get(), chatOpen: layout.open,
      project: project.get(), selection: selection.get(), ffmpeg: h.ffmpeg, update: h.update, version: h.version, chatMin: layout.min,
    };
  },
  onTheme: theme.on,
  onLanguage: language.on,
  onProject: (listener: Listener<Project>) => project.on((p) => { if (p) listener(p); }),
  onChatOpen: chatOpenSignal.on,
  onStudioBrowser: native.onStudioBrowser,
  /* Studio failing to start leaves no page to tell: the app shows that itself (src/main.mjs) */
  onStudioFailed: () => () => {},
  onRefer: refer.on,
  onSelection: (listener: Listener<StudioSelection>) => selection.on((s) => { if (s) listener(s); }),
  onFfmpeg: native.onFfmpeg,
  onUpdate: native.onUpdate,
  showInStudio: (ref: StudioRef) => command?.(commandFor(ref)),
  /* a reference made in the chat (⌘L there, the @ menu) gets its picture as Studio's own do */
  withPicture: (ref: StudioRef) => { const done = pictured.then(() => withPicture(ref)); pictured = done.then(() => {}); return done; },
  /* what a pill hovered in the chat points at, lit in Studio while it is (null: none); and the references of the
     message being written, numbered there */
  highlightInStudio: (ref: StudioRef | null) => command?.({ type: 'highlight', ref }),
  draftRefsInStudio: (refs: StudioRef[]) => command?.({ type: 'draft-refs', refs }),
  onStudioHover: hover.on,
  /* the project's files, for the @ menu: Studio's own listing (this page is Studio's, so its API is too) */
  async projectFiles() {
    const id = project.get()?.id;
    if (!id) return { files: [] };
    try { return await (await fetch(`/api/projects/${encodeURIComponent(id)}/files`)).json(); } catch { return { files: [] }; }
  },
  /* a file brought into the chat goes into the project (assets/upload/), through Studio's own import: a file on the
     disk by its path (the app reads it), one with no path (pasted) by its bytes */
  async importFile(file: { path: string; name: string } | { bytes: ArrayBuffer; name: string }) {
    const id = project.get()?.id;
    if (!id) return { ok: false, error: 'No project is open.' };
    const name = uploadName(file.name);
    if ('path' in file) return native.importFile({ projectId: id, path: file.path, name });
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/files?path=${encodeURIComponent(`assets/upload/${name}`)}`, { method: 'PUT', body: file.bytes });
      const answer = await res.json().catch(() => ({})) as { path?: string; error?: string };
      return res.ok ? { ok: true, path: answer.path } : { ok: false, error: answer.error ?? `Studio answered ${res.status}` };
    } catch (error) { return { ok: false, error: (error as Error).message }; }
  },
  setChatWidth: (width: number, done?: boolean) => setChatWidth(width, done === true),
  setChatOpen,
  assetsOpen: () => assets.open,
  setAssetsOpen,
  onAssets: assetsSignal.on,
  setComposerHeight(px: number) {
    const bottom = Math.round(px);
    if (!Number.isFinite(bottom) || bottom < 40 || bottom === assets.bottom) return;
    assets.bottom = bottom;
    place();
  },
  /* a menu of the chat's floats in its own layer over everything: nothing to make room for */
  setMenuOpen() {},
  restartToUpdate: native.restartToUpdate,
  /* the chat's record of each project, in its .film/chat and .film/logs */
  chat: native.chat,
  asks: { get: asks.get, onChange: asks.on, answer: (id: string, allow: boolean) => answerAsk(id, allow) },
  developer,
};

export type { HostAgent };
