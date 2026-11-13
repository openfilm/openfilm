/**
 * The project's frame: what Studio's shell holds of a project for whichever workbench is shown in it, and tells it
 * through shell/frame. Its files as the folder lists them, with what is known of each (its media facts, its proxy, how
 * it was made); the media pane's operations on them (bring in, link, move, delete, reveal); the project as it was read;
 * and the toast, which the shell draws. Which workbench is shown, and what takes the panes' place when it is not the
 * edit (the canvas, a plugin's surface), are the shell's too (shell/workbenches).
 *
 * For now the project and its files are still read by the edit (ProjectView: the same events redraw its picture), which
 * puts them here with the setters this frame gives it. What a workbench has that an operation here needs (its picture
 * drawn again, the files its film plays) is reached through the wiring, when the operation runs.
 */
import * as React from 'react';
import { api, PREFS_EVENT, type Listing, type MediaMade, type MissingMedia, type ProjectFilm } from '@/api';
import { useT } from '@/i18n';
import { batchMap } from '@/lib/batch-map';
import { decodes, type PlayCheck } from '@/lib/decodes';
import { studioHost } from '@/lib/host';
import { mediaFetch } from '@/lib/media-queue';
import { recycleRefusalOf } from '@/lib/recycle';
import { factsOfProbe, mediaListingOf, srcHitsAsset, warmProjectMedia, type MediaListing, type MediaProxy, type MediaResult, type MediaSources, type WorkspaceResource } from '@/lib/workspace-resources';
import type { ImportProgress } from '@/components/MediaPool';
import { Toast, useToast } from '@/components/Toast';
import { BrandLoadingScreen } from '@/components/BrandLoadingScreen';
import { usePublishFrame, wiringStore } from './frame';
import { InPanesPlace, useWorkbenchShown } from './workbenches';

/** What the shell holds of the project `projectId`: every name a workbench is given of it (shell/frame's `Frame`). */
export function useProjectFrame(projectId: string) {
  const t = useT();
  const toast = useToast();

  /* ── the project and its files, as the folder has them ── */
  /* how many times the project's files changed since it opened (see the folder's events in ProjectView) */
  const [filesTick, setFilesTick] = React.useState(0);
  const [loaded, setLoaded] = React.useState<ProjectFilm | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [rawListing, setRawListing] = React.useState<Listing | null>(null);
  const [facts, setFacts] = React.useState<Map<string, ReturnType<typeof factsOfProbe> & { audio?: boolean }>>(new Map());

  /* media facts (length, size, sound) of the project's videos, stills and sounds and its web pages, probed once each: a
     page without a duration has no end, and is dropped on the timeline with a length of its own; a picture's size
     gives its clip a box in its own shape */
  const probed = React.useRef(new Set<string>());
  /* the answers handed on a few times a second, not one by one (lib/batch-map) */
  const factsIn = React.useMemo(() => batchMap<string, ReturnType<typeof factsOfProbe> & { audio?: boolean }>((batch) => {
    setFacts((m) => { const next = new Map(m); for (const [path, f] of batch) next.set(path, f); return next; });
  }, 250), []);
  React.useEffect(() => () => factsIn.cancel(), [factsIn]);
  React.useEffect(() => {
    if (!rawListing) return;
    const wanted = [
      ...rawListing.files.filter((f) => f.kind === 'video' || f.kind === 'image' || f.kind === 'audio').map((f) => ({ f, page: false })),
      /* pages: the project's, and any put in a folder of the media pane */
      ...[...rawListing.pages, ...rawListing.files.filter((f) => f.kind === 'page')].map((f) => ({ f, page: true })),
    ];
    for (const { f, page } of wanted) {
      const key = `${f.path}@${f.mtime}`;
      if (probed.current.has(key)) continue;
      probed.current.add(key);
      void mediaFetch(`/api/projects/${encodeURIComponent(projectId)}/media?what=probe&path=${encodeURIComponent(f.path)}&v=${f.mtime}`, undefined, 'background')
        .then((r) => (r.ok ? r.json() : null))
        .then((probe) => {
          if (!probe) return;
          const facts = {
            ...factsOfProbe(probe), audio: Boolean(probe.audio),
            ...(page && !(probe.duration > 0) ? { endless: true } : {}),
            ...(page && probe.reflows ? { reflows: true } : {}),
          };
          factsIn.set(f.path, facts);
        }, () => {});
    }
  }, [rawListing, projectId, factsIn]);

  const folder = loaded?.folder ?? '';
  const mediaSources = React.useMemo<MediaSources>(() => {
    const media = (what: string, path: string, mtime: number | string) => `/api/projects/${encodeURIComponent(projectId)}/media?what=${what}&path=${encodeURIComponent(path)}&v=${mtime}`;
    return {
      file: (f) => `${folder}${f.path.split('/').map(encodeURIComponent).join('/')}?v=${Math.round(f.mtimeMs)}`,
      poster: (f) => (f.kind === 'video' ? media('poster', f.path, Math.round(f.mtimeMs)) : undefined),
      wave: (f) => media('wave', f.path, Math.round(f.mtimeMs)),
      pagePoster: (f) => media('poster', f.path, `${Math.round(f.mtimeMs)}.${filesTick}`),
      pageSurface: (f) => `${folder}${f.path.split('/').map(encodeURIComponent).join('/')}`,
    };
  }, [projectId, folder, filesTick]);
  /*
   * proxies (studio/server/proxies.mjs): asked for the project's heavy footage whenever its files change or the
   * preferences do, followed while they are made, and for the footage this browser does not decode (lib/decodes.ts),
   * whose proxy is all it shows, proxies on or off. One ready for footage on the film, or other preferences, load the
   * preview again behind the picture, so it plays what it should.
   */
  const [proxies, setProxies] = React.useState<Record<string, MediaProxy>>({});
  /* the videos the preview could not play though this browser said it would (their src): told as not decoded too */
  const unplayed = React.useRef(new Set<string>());
  const askProxies = React.useRef<(() => void) | null>(null);
  const onUndecoded = React.useCallback((src: string) => {
    if (unplayed.current.has(src)) return;
    unplayed.current.add(src);
    askProxies.current?.();
  }, []);
  const [prefsTick, setPrefsTick] = React.useState(0);
  React.useEffect(() => {
    const changed = () => setPrefsTick((n) => n + 1);
    window.addEventListener(PREFS_EVENT, changed);
    return () => window.removeEventListener(PREFS_EVENT, changed);
  }, []);
  React.useEffect(() => {
    if (!rawListing) return undefined;
    let alive = true;
    let timer = 0;
    let before: Record<string, MediaProxy> | null = null;
    let undecoded: string[] = [];
    const ask = async () => {
      const answer = await fetch(`/api/projects/${encodeURIComponent(projectId)}/proxies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ undecoded }) })
        .then((r) => (r.ok ? r.json() : null), () => null) as { states?: Record<string, MediaProxy>; checks?: Record<string, PlayCheck> } | null;
      if (!alive || !answer) return;
      const states = answer.states ?? {};
      setProxies(states);
      /* made since the last answer, or found made for footage just said not to decode (the server had not heard yet) */
      const now = before ? Object.keys(states).filter((path) => states[path]!.state === 'ready' && (before![path]?.state !== 'ready' || (states[path]!.needed && !before![path]?.needed))) : [];
      if (now.some((path) => wiringStore.get()?.srcsInUse?.().some((src) => srcHitsAsset(src, path)))) wiringStore.get()?.reloadPicture?.();
      before = states;
      const found = (await Promise.all(Object.entries(answer.checks ?? {}).map(async ([path, check]) => ((await decodes(check)) ? [] : [path])))).flat();
      if (!alive) return;
      for (const path of new Set([...Object.keys(states), ...Object.keys(answer.checks ?? {})])) {
        if (!found.includes(path) && [...unplayed.current].some((src) => srcHitsAsset(src, path))) found.push(path);
      }
      const told = found.every((path) => undecoded.includes(path));
      undecoded = found;
      if (!told) void ask();
      else if (Object.values(states).some((s) => s.state === 'waiting' || s.state === 'making')) timer = window.setTimeout(() => { void ask(); }, 1500);
    };
    askProxies.current = () => { window.clearTimeout(timer); void ask(); };
    void ask();
    return () => { alive = false; window.clearTimeout(timer); askProxies.current = null; };
  }, [rawListing, projectId, prefsTick]);
  const listing = React.useMemo<MediaListing | null>(
    () => (rawListing ? mediaListingOf(rawListing, (path) => ({ ...facts.get(path), ...(proxies[path] ? { proxy: proxies[path] } : {}) }), (rawListing as { made?: string[] }).made) : null),
    [rawListing, facts, proxies],
  );
  React.useEffect(() => { if (listing) warmProjectMedia(projectId, listing, mediaSources); }, [projectId, listing, mediaSources]);
  /* how the project's media was made (studio/server/media-made.mjs), by path: read with the files, and again when a
     run of `get` has put what it landed on record. A file pointed at for the agent says it too */
  const [mediaMade, setMediaMade] = React.useState<Record<string, MediaMade>>({});
  React.useEffect(() => {
    let live = true;
    void api.mediaMade(projectId).then((made) => { if (live) setMediaMade(made); }, () => {});
    return () => { live = false; };
  }, [projectId, filesTick]);

  /* ── media pane actions ── */
  const { show: showToast } = toast;
  const projectApi = `/api/projects/${encodeURIComponent(projectId)}`;
  const mediaResult = async (res: Response): Promise<MediaResult> => (res.ok ? 'ok' : res.status === 409 ? recycleRefusalOf(await res.json().catch(() => null)) ?? 'taken' : 'failed');
  /* media kept on this computer (files.mjs bringIn): picked in the system's dialog (the app's own for a folder, when
     it has one; 'no-dialog' where there is none), copied in (cloned where the disk can) or linked where it is kept (a
     NAS). A link pointed elsewhere, or copied into the project in its place */
  const postJson = React.useCallback(async (path: string, body: unknown) => {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, answer };
  }, []);
  const onPick = React.useCallback(async (title: string, folder: boolean): Promise<string[] | 'no-dialog'> => {
    if (folder && studioHost?.folders?.pick) { const path = await studioHost.folders.pick({ title }); return path ? [path] : []; }
    const { ok, status, answer } = await postJson(folder ? '/api/pick-folder' : '/api/pick-files', { title });
    if (status === 501) return 'no-dialog';
    if (!ok) return [];
    return folder ? (typeof answer.path === 'string' ? [answer.path] : []) : Array.isArray(answer.paths) ? answer.paths.map(String) : [];
  }, [postJson]);
  const onBring = React.useCallback(async (paths: string[], into: string, mode: 'auto' | 'link'): Promise<string[]> => {
    const { ok, answer } = await postJson(`${projectApi}/files/bring`, { paths, into, mode });
    if (!ok) throw new Error(String(answer.error ?? t('assets.uploadFailed')));
    /* big media that could only come in as a second copy was left where it is kept, and linked: said, so it is no surprise */
    if (mode === 'auto' && Array.isArray(answer.linked) && answer.linked.length) showToast(t('media.keptInPlace').replace('{n}', String(answer.linked.length)));
    return Array.isArray(answer.landed) ? answer.landed.map(String) : [];
  }, [projectApi, postJson, t, showToast]);
  const onRelink = React.useCallback(async (path: string, folder: boolean): Promise<MediaResult> => {
    const to = (await onPick(t('media.pickRelink'), folder));
    if (to === 'no-dialog' || !to.length) return 'ok';
    return (await postJson(`${projectApi}/files/relink`, { path, to: to[0] })).ok ? 'ok' : 'failed';
  }, [projectApi, postJson, onPick, t]);
  const onCollect = React.useCallback(async (path: string): Promise<MediaResult> => (
    (await postJson(`${projectApi}/files/collect`, { path })).ok ? 'ok' : 'failed'
  ), [projectApi, postJson]);
  /* media that cannot be found (studio/server/media-reconnect.mjs): the workbench asks for it, as it knows the
     clips whose file is gone (ProjectView), and the person points at the folder it is in now (findMissing below) */
  const [missingMedia, setMissingMedia] = React.useState<MissingMedia[]>([]);
  /* how the project's media was made (studio/server/media-made.mjs), by path: read with the files, and again when a
     run of `get` has put what it landed on record. The media pane searches the words and shows versions as one; the
     inspector says it all, and asks for the same once more (`mediaMade`, read above with the files) */
  const madeWords = React.useCallback((file: WorkspaceResource) => mediaMade[file.path]?.words, [mediaMade]);
  const madeVersions = React.useCallback((file: WorkspaceResource) => mediaMade[file.path]?.versions, [mediaMade]);
  /* media kept elsewhere is renamed or moved without the project's folder changing: its links are looked at again
     when the person comes back to the window, and the listing is taken when one of them changed */
  const hasLinks = React.useMemo(() => Object.keys(rawListing?.links ?? {}).length > 0, [rawListing]);
  React.useEffect(() => {
    if (!hasLinks) return undefined;
    const back = () => {
      void api.files(projectId).then((next) => setRawListing((now) => (JSON.stringify(now?.links ?? {}) === JSON.stringify(next.links ?? {}) ? now : next)), () => {});
    };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [hasLinks, projectId]);
  const findMissing = React.useCallback(async () => {
    const picked = await onPick(t('media.pickMissingFolder'), true);
    if (picked === 'no-dialog') { toast.show(t('media.noDialog')); return; }
    if (!picked[0]) return;
    try {
      const { found, missing } = await api.reconnectMedia(projectId, picked[0]);
      setMissingMedia(missing);
      if (found) wiringStore.get()?.reloadPicture?.();
      toast.show(!found ? t('media.reconnectNone')
        : missing.length ? t('media.reconnectedSome').replace('{n}', String(found)).replace('{left}', String(missing.length))
          : t('media.reconnected').replace('{n}', String(found)));
    } catch (e) { toast.showError(e instanceof Error ? e.message : String(e)); }
  }, [projectId, onPick, toast, t]);
  /*
   * resolves with where each file landed (a taken name gets a number); one that is no readable media is said at once.
   * Each file's progress is its bytes sent (XMLHttpRequest: fetch cannot tell how much of a body has gone), then 1 and
   * where it landed
   */
  const onImport = React.useCallback(async (files: File[], into: string, onProgress: ImportProgress): Promise<string[]> => {
    const landed: string[] = [];
    /* in the app a dropped file's path is known: copied on this computer (cloned where the disk can: at once, and no
       more room taken), not sent through the page */
    const paths = files.map((file) => studioHost?.folders?.pathOf(file) ?? '');
    if (paths.length && paths.every(Boolean)) {
      for (const [i, path] of paths.entries()) {
        onProgress(i, -1);
        // eslint-disable-next-line no-await-in-loop
        const [at] = await onBring([path], into, 'auto');
        if (at) landed.push(at);
        onProgress(i, 1, at);
      }
      return landed;
    }
    for (const [i, file] of files.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const { ok, body } = await new Promise<{ ok: boolean; body: { path?: string; error?: string; unreadable?: string } }>((done) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `${projectApi}/files?path=${encodeURIComponent(`${into}/${file.name}`)}`);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(i, Math.min(0.99, e.loaded / e.total)); };
        xhr.onload = () => {
          let body = {};
          try { body = JSON.parse(xhr.responseText); } catch { /* no answer to read */ }
          done({ ok: xhr.status >= 200 && xhr.status < 300, body });
        };
        xhr.onerror = () => done({ ok: false, body: {} });
        xhr.send(file);
      });
      if (!ok) throw new Error(String(body.error ?? t('assets.uploadFailed')));
      if (body.path) landed.push(body.path);
      if (body.unreadable) toast.show(t('assets.unreadable').replace('{name}', file.name).replace('{why}', body.unreadable));
      onProgress(i, 1, body.path);
    }
    return landed;
  }, [projectApi, t, toast, onBring]);
  const onMove = React.useCallback(async (from: string, to: string) => mediaResult(await fetch(`${projectApi}/files`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to }),
  })), [projectApi]);
  const onMoveCheck = React.useCallback(async (from: string, to: string) => {
    const res = await fetch(`${projectApi}/files`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to, check: true }) });
    const body = await res.json().catch(() => ({})) as { unseen?: { file: string; unseen: string[] }[] };
    return res.ok ? body.unseen ?? [] : [];
  }, [projectApi]);
  const onDelete = React.useCallback(async (path: string) => mediaResult(await fetch(`${projectApi}/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' })), [projectApi]);
  const onExtractAudio = React.useCallback(async (path: string) => mediaResult(await fetch(`${projectApi}/files/audio`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
  })), [projectApi]);
  /* a picture of the project: the project's card in the projects list */
  const coverSet = React.useCallback((cover: number | null) => {
    setLoaded((current) => current?.project.id === projectId
      ? { ...current, project: { ...current.project, cover: cover ?? undefined } } : current);
    toast.show(t('projects.coverSet'));
  }, [projectId, toast, t]);
  const onSetCover = React.useCallback((path: string) => {
    void api.setCover(projectId, { path }).then(coverSet, () => toast.showError(t('projects.coverFailed')));
  }, [projectId, coverSet, toast, t]);
  const onNewFolder = React.useCallback(async (path: string) => mediaResult(await fetch(`${projectApi}/folders`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
  })), [projectApi]);
  const reveal = React.useCallback((path: string, original?: boolean) => {
    void fetch(`${projectApi}/reveal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, ...(original ? { original } : {}) }) });
  }, [projectApi]);

  /* ── the workbench shown, and what the canvas was asked for (shell/workbenches) ── */
  const shown = useWorkbenchShown(projectId, loaded?.project.id, toast.showError);

  /* ── the page's places: what a workbench draws outside its own element goes into one of them ── */
  const [slotPage, setSlotPage] = React.useState<HTMLDivElement | null>(null);
  const [slotTop, setSlotTop] = React.useState<HTMLDivElement | null>(null);
  const [slotOver, setSlotOver] = React.useState<HTMLDivElement | null>(null);
  /** `page`: in the page's stead (it could not be read). `top`: the top bar. `over`: over the page (the library's
   *  pane, dialogs). */
  const slots = React.useMemo(() => (slotPage && slotTop && slotOver ? { page: slotPage, top: slotTop, over: slotOver } : null), [slotPage, slotTop, slotOver]);
  const slotRefs = React.useMemo(() => ({ page: setSlotPage, top: setSlotTop, over: setSlotOver }), []);

  return {
    projectId, toast, showToast, slots, slotRefs,
    loaded, setLoaded, failure, setFailure,
    filesTick, setFilesTick, rawListing, setRawListing, facts, proxies, onUndecoded, prefsTick, folder, mediaSources, listing,
    mediaMade, madeWords, madeVersions, missingMedia, setMissingMedia, findMissing,
    projectApi, onPick, onBring, onRelink, onCollect, onImport, onMove, onMoveCheck, onDelete, onExtractAudio, coverSet, onSetCover, onNewFolder, reveal,
    ...shown,
  };
}

/** A place of the page's that takes no room of its own: what is put in it is laid out as its parent's. */
const PLACE = { display: 'contents' } as const;

/**
 * The project's page: its frame told, and the page itself, which is the shell's. The workbench's element (`children`)
 * goes where the panes are, and after it what takes their place (shell/workbenches); the other places are filled by
 * the workbench for now (see `slots`), each until it is the shell's own. Nothing of a workbench is drawn before the
 * frame is told with its places, so one never reads an empty frame. While the project is being read the loading
 * screen is here (unless `covered`: the page says something else), and the page is not shown. The toast is drawn over
 * everything.
 */
export function ProjectFrame({ projectId, covered = false, children }: { projectId: string; covered?: boolean; children: React.ReactNode }) {
  const state = useProjectFrame(projectId);
  usePublishFrame(state);
  const { loaded, failure, slots, slotRefs } = state;
  /* set after the frame is told (the layout effect above runs first), and drawn again before the page is painted */
  const [told, setTold] = React.useState(false);
  React.useLayoutEffect(() => { setTold(true); }, []);
  const read = Boolean(loaded) && !failure;
  return (
    <>
      <div ref={slotRefs.page} style={PLACE} />
      {!loaded && !failure && !covered ? <BrandLoadingScreen labelKey="projects.opening" /> : null}
      <div className="workspace-shell flex flex-col bg-[var(--bg-app)]" style={read ? undefined : { display: 'none' }}>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative z-10 grid min-h-0 min-w-0 flex-1 bg-[var(--dock-line)]" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'auto minmax(0, 1fr)', gridTemplateAreas: '"bar" "main"' }}>
            <div ref={slotRefs.top} style={PLACE} />
            {told && slots ? children : null}
            <InPanesPlace frame={state} />
          </div>
        </div>
        <div ref={slotRefs.over} style={PLACE} />
      </div>
      {/* in a layer of its own, as the page is one: the toast stays under the dialogs put on the body */}
      <div className="fixed"><Toast toast={state.toast.current} /></div>
    </>
  );
}
