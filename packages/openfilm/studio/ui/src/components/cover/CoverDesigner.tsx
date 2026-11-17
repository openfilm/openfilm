/**
 * The cover design: one large window over the edit, the size of the other large windows (the projects, settings). The
 * film stays as it is under it: nothing is opened, no tab. On its left what a cover is made of (Templates by category,
 * Words, Stickers, the Picture); in the middle the cover, picked and moved and its words typed on it as on the edit's
 * picture, with undo, the picture fitted again, a picture of this computer or made with AI and the strip of the film a
 * moment is taken from under it; on its right the picture's tools, the template's words and the layers. Across its top
 * a tab for each shape the film has a cover in. Cancel (and Esc, and the window's close) puts back every cover the
 * design reached as it was when it opened, and takes away those it made; Set as cover keeps them, the one shown the
 * film's main cover.
 *
 * A cover is a film of one frame (studio/server/covers.mjs), edited here with the edit's own parts: its film
 * (editor/use-film) on the cover's own project, drawn by the edit's Preview and picked by its FilmStageSelect.
 */
import React from 'react';
import { Ban, Plus, Type } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { api, type Film, type Op, type ProjectFilm } from '@/api';
import { useFilm } from '@/editor/use-film';
import { Preview, type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import { FilmStageSelect, type FilmStageControl, type LayerGeometry, type StageClipEdit } from '../FilmStageSelect';
import { LargeDialog } from '../LargeDialog';
import { CoversPane, type CoversActions } from '../library/CoversPane';
import { CoverBottom, CoverFeed, CoverSafeArea, CoverTopBar } from './CoverChrome';
import { COVER_BACKGROUND_LEAD, COVER_PICTURE_LEAD, COVER_REDRAW_LEAD, CoverAiPanel, CoverLookPreview, madePath, readLooksAhead, type CoverMakeAsk } from './CoverAi';
import { CoverInspector, type CoverLayer } from './CoverInspector';
import {
  COVER_SHAPES, coversApi, coverThumb, filmShots, frameMoment, isCoverLook, isCoverPicture, libraryLookPage, shapeOf,
  type CoverList, type CoverLook, type CoverShape,
} from '@/lib/covers';
import {
  BUILT_IN, TEXT_COMPONENT, builtInItem, defaultTextWords, isLibrarySticker, libraryBox, nameOf, pageUrl, posterUrl, useLibraryIndex, withRootVars, type LibraryItem,
} from '@/lib/library';
import { hugText } from '@/lib/text-box';
import { withWords } from '@/lib/text-look';
import { filmDocLoc, filmSrcIsPage, parseFilmDocLoc, type FilmDoc, type FilmOverride } from '@/lib/film';
import { propsOf, propValue, withPropValue } from '@/lib/component-props';
import { layerTarget, pageClipOf } from '@/lib/stage-layers';
import { nextOverrides, type OverrideGeometry } from '@/lib/film-overrides';
import { compactScale, type StageElement } from '@/lib/stage-types';
import { studioHost } from '@/lib/host';

type Tab = 'look' | 'text' | 'sticker' | 'picture';
const PICTURE_LINES = ['film', 'local', 'color', 'ai'] as const;
const NO_SHOTS: readonly number[] = [];

/** A cover of the film, opened here: its folder and the project it is edited as. */
type Open = { folder: string; id: string };

/** How the design says what happened (the edit's toast). */
export type CoverSay = { show: (message: string) => void; showError: (message: string) => void };

export function CoverDesigner({ projectId, filmTitle, filmMs, atMs, filmStage, toast, onClose }: {
  /** the film the covers are of */
  projectId: string;
  filmTitle: string;
  filmMs: number;
  /** the playhead: a new cover's picture is the film there */
  atMs: number;
  filmStage: { w: number; h: number };
  toast: CoverSay;
  onClose: () => void;
}) {
  const t = useT();
  const [list, setList] = React.useState<CoverList | null>(null);
  const [open, setOpen] = React.useState<Open | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [safe, setSafe] = React.useState(true);
  const [feed, setFeed] = React.useState(true);
  /* each cover the design reached as it was when it got there (null: made here), for Cancel */
  const design = React.useRef(new Map<string, string | null>());
  const failed = React.useCallback((e: unknown) => toast.showError(t('covers.failed').replace('{error}', e instanceof Error ? e.message : String(e))), [t, toast]);
  const reload = React.useCallback(() => coversApi.list(projectId).then(setList, () => {}), [projectId]);
  const job = React.useCallback((what: string, run: () => Promise<unknown>) => {
    setBusy((cur) => {
      if (cur) return cur;
      void run().catch(failed).finally(() => setBusy(null));
      return what;
    });
  }, [failed]);
  const openFolder = React.useCallback(async (folder: string) => {
    const { project } = await coversApi.open(projectId, folder);
    setOpen({ folder, id: project.id });
  }, [projectId]);
  /* opened: the film's main cover, else a new one of the film's shape with the film at the playhead as its picture */
  React.useEffect(() => {
    let live = true;
    void (async () => {
      const got = await coversApi.list(projectId);
      if (!live) return;
      setList(got);
      if (got.main) { await openFolder(got.main); return; }
      const shape = COVER_SHAPES.find((s) => s.id === (filmStage.h > filmStage.w ? 'portrait' : 'landscape'))!;
      const at = Math.max(0, Math.min(filmMs - 1, atMs)) / 1000;
      const { folder } = await coversApi.make(projectId, { name: shape.id, stage: { w: shape.w, h: shape.h }, ...(filmMs > 0 ? { at } : {}) });
      design.current.set(folder, null);
      if (!live) return;
      await reload();
      await openFolder(folder);
    })().catch((e) => { failed(e); onClose(); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => job('finish', async () => {
    for (const [folder, text] of design.current) {
      // eslint-disable-next-line no-await-in-loop
      await (text == null ? coversApi.discard(projectId, folder) : coversApi.restore(projectId, folder, text)).catch(() => {});
    }
    design.current.clear();
    onClose();
  });
  const done = (settled: () => Promise<unknown>) => job('finish', async () => {
    if (!open) return;
    await settled();
    await coversApi.main(projectId, open.folder);
    design.current.clear();
    onClose();
  });
  const addShape = (shape: CoverShape) => job('new', async () => {
    if (!open) return;
    const { folder } = await coversApi.make(projectId, { name: shape.id, stage: { w: shape.w, h: shape.h }, from: open.folder });
    design.current.set(folder, null);
    await reload();
    await openFolder(folder);
  });
  const exportCovers = (folders: string[]) => job('export', async () => {
    if (!folders.length) return;
    const { files } = await coversApi.draw(projectId, folders);
    toast.show(t('covers.exported').replace('{n}', String(files.length)));
  });

  return (
    <LargeDialog label={t('covers.designTitle')} onClose={cancel} closeLabel={t('covers.cancel')}>
      <div data-cover-design="" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-[var(--border)] pr-14">
          <CoverTopBar covers={list?.covers ?? []} current={open?.folder ?? ''} main={list?.main ?? null}
            thumbOf={(c) => coverThumb(projectId, c, 96)} safe={safe} feed={feed} onSafe={setSafe} onFeed={setFeed}
            onOpen={(c) => { void openFolder(c.folder).catch(failed); }}
            onAddShape={addShape}
            onMain={(c) => { void coversApi.main(projectId, c.folder).then(reload, failed); }}
            onExport={exportCovers} />
        </div>
        {open ? (
          <CoverEditor key={open.id} toast={toast} projectId={projectId} open={open} list={list} filmTitle={filmTitle} busy={busy} job={job} safe={safe} feed={feed}
            design={design.current} reload={reload} failed={failed} onCancel={cancel} onDone={done} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--text-faint)]">{t('covers.making')}</div>
        )}
      </div>
    </LargeDialog>
  );
}

/** The cover open in the design: its film, edited here. */
function CoverEditor({ toast, projectId, open, list, filmTitle, busy, job, safe, feed, design, reload, failed, onCancel, onDone }: {
  toast: CoverSay;
  projectId: string;
  open: Open;
  list: CoverList | null;
  filmTitle: string;
  busy: string | null;
  job: (what: string, run: () => Promise<unknown>) => void;
  safe: boolean;
  feed: boolean;
  design: Map<string, string | null>;
  reload: () => Promise<void>;
  failed: (e: unknown) => void;
  onCancel: () => void;
  onDone: (settled: () => Promise<unknown>) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const here = open.folder;
  const name = open.folder.split('/').pop()!;
  const [loaded, setLoaded] = React.useState<ProjectFilm | null>(null);
  React.useEffect(() => {
    let live = true;
    void api.film(open.id).then((got) => {
      if (!live) return;
      if (!design.has(open.folder)) design.set(open.folder, got.text);
      setLoaded(got);
    }, failed);
    return () => { live = false; };
  }, [open.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = React.useRef<PreviewHandle>(null);
  const stageControl = React.useRef<FilmStageControl | null>(null);
  const initial = React.useMemo(() => (loaded?.value ? { value: loaded.value, rev: loaded.rev } : null), [loaded]);
  const filmRef = React.useRef<Film | null>(null);
  const film = useFilm(open.id, initial, React.useCallback((value: Film, _kind: 'edit' | 'server', head?: string) => {
    filmRef.current = value;
    preview.current?.update(value, head);
  }, []), () => {});
  filmRef.current = film.film;
  const [info, setInfo] = React.useState<FilmInfo | null>(null);
  const [picked, setPicked] = React.useState<StageElement | null>(null);
  /* the clips in hand (a layer's row clicked, or a whole clip picked on the picture) */
  const [held, setHeld] = React.useState<readonly string[]>([]);
  const [ai, setAi] = React.useState(false);
  const [tryLook, setTryLook] = React.useState<CoverLook | null>(null);
  const [tab, setTab] = React.useState<Tab>('look');
  const [line, setLine] = React.useState('');
  const [outer, setOuter] = React.useState<{ seconds: number | null; shots: number[] } | null>(null);
  React.useEffect(() => {
    let live = true;
    void Promise.all([coversApi.length(projectId), api.film(projectId).catch(() => null)]).then(([seconds, f]) => {
      if (live) setOuter({ seconds, shots: filmShots(f?.value ?? null) });
    });
    return () => { live = false; };
  }, [projectId]);
  const looks = list?.looks.items;
  React.useEffect(() => { if (looks) readLooksAhead(looks.map(libraryLookPage)); }, [looks]);
  /* the tabs' pictures drawn again a moment after the last change */
  const changed = film.film;
  React.useEffect(() => {
    if (!changed) return undefined;
    const timer = window.setTimeout(() => void reload(), 900);
    return () => window.clearTimeout(timer);
  }, [changed, reload]);

  const stage = film.film?.stage ?? loaded?.value?.stage ?? { w: 1920, h: 1080 };
  const edit = React.useCallback(async (ops: Op[], label: string) => {
    stageControl.current?.flushPending();
    const why = await film.edit(ops, label);
    if (why) toast.showError(why);
    return why;
  }, [film, toast]);

  /* ── the picture's own editing: what the stage picks and moves, written as the edit writes it ── */
  const editBlocks = React.useCallback((edits: StageClipEdit[]): Promise<string | null> => {
    const now = filmRef.current;
    const mapped = edits.map((e) => {
      const at = parseFilmDocLoc(e.loc);
      return { clip: at ? now?.tracks[at.track]?.clips[at.clip]?.id ?? null : null, prop: e.prop, value: e.value };
    });
    if (mapped.some((e) => !e.clip)) return Promise.resolve(t('timeline.editFail'));
    return edit([{ op: 'props', edits: mapped as never }], 'covers.stepLayer');
  }, [edit, t]);
  const editOverride = React.useCallback(async (element: StageElement, patch: OverrideGeometry | null): Promise<string | null> => {
    const riders = await stageControl.current?.riders(element, patch) ?? [];
    const doc = filmRef.current as unknown as FilmDoc | null;
    const found = doc ? pageClipOf(doc, element) : null;
    const target = layerTarget(element);
    if (!found || !target) return t('timeline.editFail');
    let next = nextOverrides(found.clip.overrides, target, patch);
    for (const r of riders) next = nextOverrides(next ?? undefined, { at: r.at, ...(r.n != null ? { n: r.n } : {}) }, r.patch);
    const why = await editBlocks([{ loc: found.loc, prop: 'overrides', value: next as never }]);
    if (why) stageControl.current?.release(element);
    return why;
  }, [editBlocks, t]);
  const transformLayer = React.useCallback((element: StageElement, g: LayerGeometry) => editOverride(element, { t: g.t, s: compactScale(g.s[0], g.s[1]), r: g.r }), [editOverride]);
  const transformLayers = React.useCallback((all: ReadonlyArray<{ element: StageElement; g: LayerGeometry }>) => {
    void (async () => { for (const { element, g } of all) await transformLayer(element, g); })(); // eslint-disable-line no-await-in-loop
  }, [transformLayer]);
  const editTextInline = React.useCallback(async (element: StageElement, value: string, typed?: Record<string, string | null>) => {
    if (!element.text) return t('timeline.editFail');
    const hold = typed ?? await stageControl.current?.holdStyle(element, {}, value) ?? {};
    stageControl.current?.previewText(element, value);
    const why = await editOverride(element, { text: value, ...(Object.keys(hold).length ? { style: hold } : {}) } as OverrideGeometry);
    if (why) stageControl.current?.previewText(element, element.text.value);
    return why;
  }, [editOverride, t]);

  /* the picked layer taken away: a whole clip out of the cover, a layer of a page hidden in it */
  const removePicked = () => {
    const loc = held[0] ?? (picked?.kind === 'clip' ? picked.clipLoc : null);
    if (loc) {
      const at = parseFilmDocLoc(loc);
      const id = at ? filmRef.current?.tracks[at.track]?.clips[at.clip]?.id : null;
      if (id) void edit([{ op: 'remove', clip: id } as never], 'covers.stepRemove');
    } else if (picked) {
      void editOverride(picked, { style: { display: 'none' } } as OverrideGeometry);
    } else return;
    setHeld([]);
    setPicked(null);
  };
  /* the design's keys: ⌘Z and ⇧⌘Z on the cover, Delete on what is picked (not while typing) */
  const keys = React.useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (e.defaultPrevented || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
    if (document.querySelector('[data-cover-ai]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) film.redo(); else film.undo(); return; }
    if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && (picked || held.length)) { e.preventDefault(); removePicked(); }
  };
  React.useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  /* ── the cover's parts ── */
  const clips = (film.film?.tracks ?? []).flatMap((tr, track) => tr.clips.map((clip, i) => ({ clip, track, loc: filmDocLoc(track, i) })));
  const pictureNow = clips.find((c) => isCoverPicture(c.clip)) ?? null;
  const lookNow = clips.find((c) => isCoverLook(c.clip)) ?? null;
  const lookIdOf = (src: string) => /^look-([^/]+)\.html$/.exec(src)?.[1] ?? null;
  const applyLook = (look: CoverLook) => job(look.id, async () => {
    const { clip } = await coversApi.look(projectId, here, look.id);
    const had = lookNow?.clip;
    if (!had) { await edit([{ op: 'insert', clip, track: { insert: 0 } } as never], 'covers.stepLook'); return; }
    const before = propsOf(had), after = propsOf({ attrs: clip.attrs });
    let overrides: FilmOverride[] = [];
    for (const p of after) {
      if (p.type !== 'text') continue;
      const same = before.find((b) => b.type === 'text' && b.name === p.name);
      const value = same ? propValue(had.overrides as FilmOverride[] | undefined, same) : null;
      if (value != null) overrides = withPropValue(overrides, p, value) ?? overrides;
    }
    await edit([
      { op: 'set', clip: had.id, field: 'src', value: clip.src },
      { op: 'fields', clip: had.id, fields: { attrs: clip.attrs ?? null, overrides: overrides.length ? overrides : null } },
    ] as never, 'covers.stepLook');
  });
  const noLook = () => { const had = lookNow?.clip; if (had) void edit([{ op: 'remove', clip: had.id } as never], 'covers.stepLook'); };
  const putPicture = async (clip: { src: string; box?: { x: number; y: number; w: number; h: number }; style?: string }, label: string) => {
    const had = pictureNow?.clip;
    await edit((had
      ? [{ op: 'set', clip: had.id, field: 'src', value: clip.src }, { op: 'fields', clip: had.id, fields: { box: clip.box ?? null, style: clip.style ?? null } }]
      : [{ op: 'insert', clip: { id: 'frame', time: [0, 1], ...clip }, track: { insert: film.film?.tracks.length ?? 0 } }]) as never, label);
  };
  const moment = (seconds: number) => job('frame', async () => {
    const { clip } = await coversApi.frame(projectId, here, seconds);
    await putPicture(clip, 'covers.stepFrame');
  });
  const local = (file: File) => job('picture', async () => {
    const picture = await coversApi.upload(projectId, file);
    const { clip } = await coversApi.picture(projectId, here, { picture });
    await putPicture(clip, 'covers.stepPicture');
  });
  const color = (css: string) => job('picture', async () => {
    const { clip } = await coversApi.picture(projectId, here, { color: css });
    await putPicture(clip, 'covers.stepPicture');
  });
  /** the cover's picture as the film's folder names it (what a service is given to work from); null for a color */
  const pictureFile = () => {
    const had = pictureNow?.clip;
    if (!had || /^color-/.test(had.src)) return null;
    const src = had.src.split('#')[0]!;
    return src.startsWith('../../') ? src.slice(6) : `${here}/${src}`;
  };
  const root = loaded ? loaded.project.path.replace(/[\\/]covers[\\/][^\\/]+[\\/]?$/, '') : null;
  const cutSubject = async () => {
    const file = pictureFile();
    const had = pictureNow;
    if (!file || !had || !root) return;
    const text = await api.make(root, 'cutout', { src: file, out: `cover-${name}-subject-${Date.now().toString(36)}` }, {});
    await edit([{ op: 'insert', clip: { src: `../../${madePath(text)}`, time: [0, 1], ...(had.clip.box ? { box: had.clip.box } : {}), ...(had.clip.style ? { style: had.clip.style } : {}) }, track: { insert: had.track } } as never], 'covers.stepCutout');
  };
  const make = (ask: CoverMakeAsk) => job('picture', async () => {
    if (!root) return;
    setAi(false);
    const ref = ask.fromPicture ? pictureFile() : null;
    if (ask.keepSubject && !clips.some((c) => /-subject/.test(c.clip.src))) await cutSubject();
    const lead = ask.keepSubject ? COVER_BACKGROUND_LEAD : ref ? COVER_REDRAW_LEAD : COVER_PICTURE_LEAD;
    const text = await api.make(root, 'image', {
      /* a name of its own each time: every picture made is kept to go back to */
      out: `cover-${name}-picture-${Date.now().toString(36)}`, prompt: `${lead}${ask.words}`, ratio: shapeOf(stage).ratio, quality: 'high', ...(ref ? { ref: [ref] } : {}),
    }, {});
    await putPicture({ src: `../../${madePath(text)}`, style: 'object-fit: cover' }, 'covers.stepPicture');
    void reload();
  });
  const use = (path: string) => job('picture', async () => {
    setAi(false);
    const { clip } = await coversApi.picture(projectId, here, { picture: path });
    await putPicture(clip, 'covers.stepPicture');
  });
  const agent = (words: string) => {
    setAi(false);
    studioHost?.ask?.({ text: t('covers.agentAsk').replace('{file}', `${here}/film.html`).replace('{words}', words), refs: [] });
  };
  const BLUR = /\s*filter:\s*blur\([^)]*\)[^;]*;?/;
  const blurred = BLUR.test(pictureNow?.clip.style ?? '');
  const blur = (on: boolean) => {
    const had = pictureNow?.clip;
    if (!had) return;
    const style = (had.style ?? '').replace(BLUR, '').trim();
    const next = on ? `${style}${style && !style.endsWith(';') ? ';' : ''} filter: blur(14px) brightness(0.9);`.trim() : style;
    void edit([{ op: 'fields', clip: had.id, fields: { style: next || null } } as never], 'covers.stepBlur');
  };
  const fill = () => {
    const had = pictureNow?.clip;
    if (!had) return;
    const style = (had.style ?? '').replace(/\s*object-fit:[^;]*;?/, '').trim();
    void edit([{ op: 'fields', clip: had.id, fields: { box: null, style: `object-fit: cover;${style ? ` ${style}` : ''}` } } as never], 'covers.stepFill');
  };
  const layers: CoverLayer[] = clips.map(({ clip, loc }) => {
    const look = lookIdOf(clip.src);
    const name = look ? nameOf(list?.looks.items.find((l) => l.id === look)?.name ?? { en: look }, language)
      : isCoverPicture(clip) ? t('covers.picture') : /-subject/.test(clip.src) ? t('covers.subject')
        : (clip.overrides as FilmOverride[] | undefined)?.map((o) => (o as { text?: unknown }).text).find((w): w is string => typeof w === 'string')
          ?? clip.src.split('/').pop()!.replace(/\.[^.]+$/, '');
    const kind: CoverLayer['kind'] = look ? 'look' : isCoverPicture(clip) ? 'picture' : /-subject/.test(clip.src) ? 'subject' : isLibrarySticker(clip.src) ? 'other' : filmSrcIsPage(clip.src) ? 'words' : 'other';
    return { loc, kind, name };
  });
  const moveLayer = (index: number, by: -1 | 1) => {
    const from = clips[index]?.track, to = clips[index + by]?.track;
    if (from != null && to != null) void edit([{ op: 'reorder', from, to } as never], 'covers.stepLayer');
  };
  const pictureSaid = (() => {
    const src = pictureNow?.clip.src;
    if (!src) return null;
    const at = frameMoment(src);
    if (at != null) return { kind: 'frame' as const, said: `${t('covers.ofFilm')} ${at.toFixed(2)} s` };
    if (/^color-/.test(src)) return { kind: 'color' as const, said: t('covers.colorSaid') };
    return { kind: 'picture' as const, said: src.split('/').pop() ?? src };
  })();
  const pictureView = (() => {
    const c = pictureNow?.clip;
    if (!c || !loaded) return null;
    try {
      return { url: new URL(c.src.split('#')[0]!, loaded.folder.endsWith('/') ? loaded.folder : `${loaded.folder}/`).href, page: /\.html?$/i.test(c.src), ...(c.box?.w != null && c.box.h != null ? { box: { x: c.box.x, y: c.box.y, w: c.box.w, h: c.box.h } } : {}) };
    } catch { return null; }
  })();

  /* words and stickers of the library: taken into the cover, put in the middle at a size they read */
  const library = useLibraryIndex();
  const textStyles = (library?.items ?? []).filter((i) => i.cat === 'text' && i.kind === 'textstyle');
  const stickers = (library?.items ?? []).filter((i) => i.cat === 'sticker');
  const addThing = (item: LibraryItem | null) => job('add', async () => {
    const style = item?.kind === 'textstyle' ? item : null;
    const from = item && !style ? `${BUILT_IN}/${item.id}` : `${BUILT_IN}/${TEXT_COMPONENT}`;
    const taken = await api.takeSaved(open.id, from);
    if (!('clip' in taken)) return;
    const own = builtInItem(from);
    const shaped = libraryBox(style?.w ? style : own, stage);
    const words = own?.id === TEXT_COMPONENT ? defaultTextWords() : undefined;
    const vars = style?.vars;
    const box = shaped && own && words != null ? await hugText(pageUrl(own), shaped, stage.w, vars, words) : shaped;
    const had = (taken.clip as { overrides?: unknown[] }).overrides;
    const overrides = words != null ? withWords(vars ? withRootVars(had, vars) : had, words) : undefined;
    await edit([{ op: 'insert', clip: { ...taken.clip, time: [0, 1], ...(box ? { box, size: { w: box.w, h: box.h } } : {}), ...(overrides ? { overrides } : {}) }, track: { insert: 0 } } as never],
      style || !item ? 'covers.stepText' : 'covers.stepSticker');
  });
  /* the template's own words, by their names (Title, Subtitle…) */
  const lookWords = lookNow ? propsOf(lookNow.clip).filter((p) => p.type === 'text') : [];
  const setLookWord = (name: string, value: string) => {
    const had = lookNow?.clip;
    const prop = lookWords.find((p) => p.name === name);
    if (!had || !prop) return;
    const next = withPropValue(had.overrides as FilmOverride[] | undefined, prop, value);
    void edit([{ op: 'fields', clip: had.id, fields: { overrides: next?.length ? next : null } } as never], 'covers.stepWords');
  };

  const actions: CoversActions = {
    projectId, looks: list?.looks ?? null, lookNow: lookNow ? lookIdOf(lookNow.clip.src) : null,
    shots: outer?.shots ?? NO_SHOTS, busy, made: list?.made ?? [],
    thumbOf: (path: string) => `/api/projects/${encodeURIComponent(projectId)}/media?what=poster&path=${encodeURIComponent(path)}`,
    apply: applyLook, none: noLook, preview: setTryLook, moment, local, color, use, openAi: () => setAi(true),
  };
  const coverInfo = list?.covers.find((c) => c.folder === here) ?? null;
  const rail = tab === 'look'
    ? [{ id: '', name: t('covers.all') }, ...(list?.looks.categories ?? []).map((c) => ({ id: c.id, name: nameOf(c.name, language) }))]
    : tab === 'picture' ? PICTURE_LINES.map((id) => ({ id, name: t(`covers.line_${id}`) })) : [];
  const pickTab = (next: Tab) => { setTab(next); setLine(next === 'picture' ? 'film' : ''); };

  return (
    <div className="flex min-h-0 flex-1">
      {/* what a cover is made of */}
      <div className="flex w-[380px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--dialog-side)]">
        <div role="tablist" className="m-3 mb-0 grid grid-cols-4 gap-0.5 rounded-lg bg-[var(--bg-field)] p-0.5">
          {(['look', 'text', 'sticker', 'picture'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} data-cover-tab-left={id} onClick={() => pickTab(id)}
              className={`h-7 rounded-md text-[12.5px] transition ${tab === id ? 'bg-[var(--bg-pressed)] font-semibold text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
              {t(`covers.tab_${id}`)}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 pt-2">
          {rail.length ? (
            <nav className="flex w-[76px] shrink-0 flex-col gap-0.5 overflow-y-auto px-2 py-1">
              {rail.map((r) => (
                <button key={r.id} type="button" aria-current={line === r.id ? 'true' : undefined} onClick={() => setLine(r.id)} data-cover-rail={r.id}
                  className={`rounded-md px-2 py-1.5 text-left text-[12px] transition ${line === r.id ? 'bg-[var(--bg-pressed)] font-semibold text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                  {r.name}
                </button>
              ))}
            </nav>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {tab === 'look' ? <CoversPane actions={actions} category="cover" line={line} />
              : tab === 'picture' ? <CoversPane actions={actions} category="coverPicture" line={line} />
                : tab === 'text' ? (
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
                    {lookWords.length ? (
                      <section className="mb-4" data-cover-look-words="">
                        <p className="mb-2 text-[11.5px] font-medium text-[var(--text-muted)]">{t('covers.lookWords')}</p>
                        <div className="flex flex-col gap-1.5">
                          {lookWords.map((p) => (
                            <LookWord key={`${lookNow!.clip.id}-${p.name}`} name={p.name} value={String(propValue(lookNow!.clip.overrides as FilmOverride[] | undefined, p) ?? '')}
                              onSet={(v) => setLookWord(p.name, v)} />
                          ))}
                        </div>
                      </section>
                    ) : null}
                    <button type="button" data-cover-add-text="" disabled={busy != null} onClick={() => addThing(null)}
                      className="mb-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--bg-field)] text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">
                      <Type size={14} />{t('covers.addText')}
                    </button>
                    <p className="mb-2 text-[11.5px] font-medium text-[var(--text-muted)]">{t('covers.textStyles')}</p>
                    <Things items={textStyles} busy={busy != null} onAdd={addThing} language={language} />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
                    <Things items={stickers} busy={busy != null} onAdd={addThing} language={language} contain />
                  </div>
                )}
          </div>
        </div>
      </div>

      {/* the cover */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 px-6 pb-2 pt-4">
          <Fitted stage={stage}>
            {loaded ? (
              <Preview ref={preview} folder={loaded.folder.endsWith('/') ? loaded.folder : `${loaded.folder}/`} stage={stage} time={() => 0} onKey={(e) => keys.current(e)}
                onInfo={setInfo} onSpans={(spans) => setInfo((had) => (had ? { ...had, spans } : had))}>
                {film.film ? (
                  <FilmStageSelect previewRef={preview} stage={stage} doc={film.film as unknown as FilmDoc} spans={info?.spans ?? []} timeMs={0}
                    onSelectElement={(el) => { setPicked(el); setHeld(el?.kind === 'clip' && el.clipLoc ? [el.clipLoc] : []); }}
                    linkedLocs={held} onSelectClips={(locs) => setHeld([...locs])} onEditClip={editBlocks} controlRef={stageControl}
                    onTransformLayer={transformLayer} onTransformLayers={transformLayers} onEditTextInline={editTextInline} />
                ) : null}
              </Preview>
            ) : null}
            {tryLook ? <CoverLookPreview stage={stage} picture={pictureView} look={libraryLookPage(tryLook)} /> : null}
            {safe ? <CoverSafeArea stage={stage} /> : null}
          </Fitted>
          <button type="button" data-cover-ai-pill="" onClick={() => setAi(true)}
            className="absolute bottom-3 right-6 z-20 flex h-9 items-center gap-2 rounded-full bg-[rgba(30,30,34,.92)] px-4 text-[12.5px] text-white shadow-[0_0_0_1px_rgba(0,193,205,.6),0_8px_24px_rgba(0,0,0,.4)] transition hover:bg-[rgba(40,40,46,.95)]">
            <span className="text-[var(--accent)]">✦</span>{t('covers.aiPill')}
          </button>
        </div>
        <CoverBottom outerId={projectId} filmSeconds={outer?.seconds ?? null} frameAt={frameMoment(pictureNow?.clip.src)} busy={busy}
          canUndo={film.canUndo} canRedo={film.canRedo} onUndo={film.undo} onRedo={film.redo} onFill={fill}
          onMoment={moment} onLocal={local} onAi={() => setAi(true)} onCancel={onCancel} onDone={() => onDone(film.settled)} />
      </div>

      {/* the picture's tools and the layers */}
      <div className="flex w-[260px] shrink-0 flex-col border-l border-[var(--border)]">
        {feed && coverInfo ? <div className="px-3.5 pt-3.5"><CoverFeed projectId={projectId} cover={coverInfo} title={filmTitle} inline /></div> : null}
        <CoverInspector layers={layers} picture={pictureSaid} picked={held[0] ?? picked?.clipLoc ?? null} busy={busy} blurred={blurred}
          onPick={(loc) => { setPicked(null); setHeld([loc]); }} onMove={moveLayer} onCutout={() => job('cutout', cutSubject)} onBlur={blur} onFill={fill}
          onSource={() => pickTab('picture')} onAi={() => setAi(true)} />
      </div>

      {ai ? (
        <CoverAiPanel ratio={shapeOf(stage).ratio} hasPicture={pictureFile() != null} busy={busy === 'picture'}
          made={list?.made ?? []} thumbOf={actions.thumbOf} agent={Boolean(studioHost?.ask)}
          onMake={make} onUse={use} onAgent={agent} onClose={() => setAi(false)} />
      ) : null}
    </div>
  );
}

/** The cover's box: as large as the room allows in the cover's own shape. */
function Fitted({ stage, children }: { stage: { w: number; h: number }; children: React.ReactNode }) {
  const room = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = room.current;
    if (!el) return undefined;
    const fit = () => {
      const k = Math.min(el.clientWidth / stage.w, el.clientHeight / stage.h);
      setSize({ w: Math.floor(stage.w * k), h: Math.floor(stage.h * k) });
    };
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(el);
    return () => seen.disconnect();
  }, [stage.w, stage.h]);
  return (
    <div ref={room} className="flex h-full w-full items-center justify-center">
      <div data-cover-canvas="" className="relative" style={{ width: size.w, height: size.h }}>{size.w > 0 ? children : null}</div>
    </div>
  );
}

/** One of the template's words, written as it is typed and kept once the field is left. */
function LookWord({ name, value, onSet }: { name: string; value: string; onSet: (value: string) => void }) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--text-faint)]">{name}</span>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== value) onSet(draft); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-cover-word={name}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--text-muted)]" />
    </label>
  );
}

/** Words' styles or stickers of the library, a click putting one on the cover. */
function Things({ items, busy, onAdd, language, contain = false }: {
  items: readonly LibraryItem[]; busy: boolean; onAdd: (item: LibraryItem) => void; language: ReturnType<typeof useLanguage>; contain?: boolean;
}) {
  const t = useT();
  if (!items.length) return <p className="py-6 text-center text-[12px] text-[var(--text-faint)]"><Ban size={16} className="mx-auto mb-1.5" />{t('covers.nothing')}</p>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
      {items.map((item) => (
        <button key={item.id} type="button" disabled={busy} onClick={() => onAdd(item)} title={nameOf(item.name, language)} data-cover-thing={item.id}
          className="group relative aspect-square overflow-hidden rounded-md bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition hover:ring-[var(--accent)] disabled:opacity-50">
          <img src={posterUrl(item)} alt="" loading="lazy" draggable={false} className={`absolute inset-0 h-full w-full ${contain ? 'object-contain p-2.5' : 'object-cover'}`} />
          <span className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded bg-black/60 text-white group-hover:flex"><Plus size={12} /></span>
        </button>
      ))}
    </div>
  );
}

