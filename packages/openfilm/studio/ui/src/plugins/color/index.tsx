/**
 * The color workbench, as the element its plugin brings (plugins/color): the film's video clips graded one by one,
 * by hand, as a colorist grades them. Its blocks: the picture being graded (with the footage beside it), the scopes,
 * the grade's controls, and the film's clips in a strip, each as it plays now.
 *
 * A clip's grade is a LUT of the project named first in its `--of-lut` (plugins/color/project.mjs): the film plays and
 * exports through it with the plugin off. What is shown here is that same LUT applied to the footage at its own depth
 * (grade-worker.ts), so the picture is the one that will play. A change paints at once and is written a moment after
 * it is let go; ⌘Z takes it back. `openfilm color` changes the same grades: what it writes shows here.
 */
import * as React from 'react';
import { StrictMode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Redo2, RotateCcw, Undo2, Wand2 } from 'lucide-react';
import { addPluginWords, useT } from '@/i18n';
import { projectEvents } from '@/api';
import { MenuSelect } from '@/components/MenuSelect';
import { Tooltip } from '@/components/Tooltip';
import { pluginApi, project as projectOf, toast } from '@/studio';
import { useBlock, useProject, useProvide } from '@/studio/react';
import { neutralGrade, normalize, sizeFor, type Grade } from '../../../../../plugins/color/engine/grade.mjs';
import { Clips, type ClipRow } from './Clips';
import { Panel, type Tab } from './Panel';
import { Scopes } from './Scopes';
import { Viewer, type Compare, type Tool } from './Viewer';
import { useGrader } from './use-grader';
import type { Scope } from './grade-worker';

addPluginWords('color', import.meta.glob('../../../../../plugins/color/i18n/*.json', { eager: true, import: 'default' }));

const api = pluginApi('color');
const OWNER = 'color';
/** How long a frame's longer side is read for the picture, px; and for a clip's picture in the strip. */
const FRAME_W = 1280, THUMB_W = 224;
/** How long after a change is let go it is written, ms. */
const WRITE_AFTER = 300;

interface Row extends ClipRow { grade: Grade; auto: { input: string; range: 'legal' | 'full' } }

/** The plugin's words: `w('window', { n: 2 })`. */
function useWords() {
  const t = useT();
  return React.useCallback((key: string, values: Record<string, string | number> = {}) => (
    Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(`plugin.color.${key}`))
  ), [t]);
}

const keep = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const store = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* this time only */ } };

function Color({ projectId }: { projectId: string }) {
  const state = useProject(projectId);
  const w = useWords();
  const viewerBlock = useBlock(OWNER, 'viewer');
  const scopesBlock = useBlock(OWNER, 'scopes');
  const gradeBlock = useBlock(OWNER, 'grade');
  const clipsBlock = useBlock(OWNER, 'clips');
  const base = `projects/${encodeURIComponent(projectId)}`;
  const grader = useGrader();

  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  /** the grade being moved (painted, not written yet) */
  const [live, setLive] = React.useState<Grade | null>(null);
  /** the second of the selected clip's file shown */
  const [second, setSecond] = React.useState<number | null>(null);
  const [frameSeq, setFrameSeq] = React.useState(0);
  /** the clip the frame read last is of: its picture is graded by its own grade only */
  const [frameOf, setFrameOf] = React.useState<string | null>(null);
  const [lutSeq, setLutSeq] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [compare, setCompare] = React.useState<Compare>('graded');
  const [wipe, setWipe] = React.useState(0.5);
  const [tool, setTool] = React.useState<Tool>('none');
  const [picking, setPicking] = React.useState<number | null>(null);
  const [matte, setMatte] = React.useState<number | null>(null);
  const [tab, setTab] = React.useState<Tab>(() => keep('openfilm.color.tab', 'primaries'));
  const [chosen, setChosen] = React.useState<[Scope, Scope]>(() => keep('openfilm.color.scopes', ['waveform', 'vectorscope']));
  const [luts, setLuts] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const history = React.useRef(new Map<string, { undo: Grade[]; redo: Grade[] }>());
  const pending = React.useRef(new Map<string, Grade>());
  const writing = React.useRef<Promise<void> | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedLuts = React.useRef(new Set<string>());

  /** the rows as they are now, for what is done between draws (a change, an undo) */
  const rowsNow = React.useRef<Row[] | null>(rows);
  rowsNow.current = rows;
  const row = rows?.find((r) => r.id === selected) ?? null;
  const grade = live ?? row?.grade ?? null;

  /* the clips, read again as the film changes (a grade written here, by a command, or the edit) */
  const read = React.useCallback(async () => {
    try {
      const { clips } = await api.get<{ clips: Row[] }>(`${base}/clips`);
      setRows(clips.map((c) => {
        /* a grade still waiting to be written here stays as it is here */
        const mine = pending.current.get(c.id);
        return { ...c, grade: mine ?? normalize(c.grade) };
      }));
      setSelected((s) => (s && clips.some((c) => c.id === s) ? s : clips[0]?.id ?? null));
    } catch (e) {
      setRows([]);
      toast(e instanceof Error ? e.message : String(e), { error: true });
    }
  }, [base]);
  React.useEffect(() => { void read(); }, [read]);
  React.useEffect(() => projectEvents(projectId, (event) => { if (event.type === 'film') void read(); }), [projectId, read]);
  React.useEffect(() => {
    api.get<{ luts: string[] }>(`${base}/luts`).then((r) => setLuts(r.luts)).catch(() => {});
  }, [base, rows?.length]);

  /* the frame: the clip's middle when it is chosen, then wherever the strip under the picture is put */
  React.useEffect(() => {
    if (!row) return;
    const mid = row.to === null ? row.from : (row.from + row.to) / 2;
    setSecond((s) => (s === null || s < row.from || (row.to !== null && s > row.to) ? mid : s));
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!row || second === null) return;
    let live2 = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/plugins/color/${base}/clips/${encodeURIComponent(row.id)}/frame?s=${second.toFixed(3)}&box=${FRAME_W}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Studio answered ${res.status}`);
        const fw = Number(res.headers.get('x-width')), fh = Number(res.headers.get('x-height'));
        const data = await res.arrayBuffer();
        if (!live2) return;
        grader.setFrame(fw, fh, data);
        setFrameOf(row.id);
        setFrameSeq((n) => n + 1);
      } catch (e) {
        if (live2) toast(e instanceof Error ? e.message : String(e), { error: true });
      } finally {
        if (live2) setLoading(false);
      }
    }, 90);
    return () => { live2 = false; clearTimeout(t); };
  }, [row?.id, second, base]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the LUT files the grade names, read once each */
  const named = React.useMemo(() => [grade?.inputLut?.path, grade?.look?.path, ...(row?.others ?? [])].filter((p): p is string => Boolean(p)), [grade?.inputLut?.path, grade?.look?.path, row?.others]);
  React.useEffect(() => {
    if (!state?.film) return;
    const want = named.filter((p) => !loadedLuts.current.has(p));
    if (!want.length) return;
    Promise.all(want.map(async (p) => {
      const res = await fetch(new URL(p.split('/').map(encodeURIComponent).join('/'), state.film));
      if (!res.ok) throw new Error(`${p}: ${res.status}`);
      return [p, await res.text()] as const;
    })).then((texts) => {
      for (const [p] of texts) loadedLuts.current.add(p);
      grader.addLuts(Object.fromEntries(texts));
      setLutSeq((n) => n + 1);
    }).catch((e) => toast(String(e instanceof Error ? e.message : e), { error: true }));
  }, [named, state?.film]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the picture: graded again whenever the grade, the frame or what is shown changes */
  const gradeKey = grade ? JSON.stringify(grade) : '';
  React.useEffect(() => {
    if (!grade || !frameSeq || frameOf !== row?.id) return;
    const scopes = [...new Set<Scope>([...chosen, ...(tab === 'curves' ? ['histogram' as const] : [])])];
    const o = { others: row?.others ?? [], key: matte, scopes };
    /* a grade baked at 65 points takes a moment: a picture at 33 first, then the one that plays (the worker keeps
       only the newest asked, so a move meanwhile replaces it) */
    if (live === null && sizeFor(grade) > 33) grader.render(grade, { ...o, draft: true });
    grader.render(grade, { ...o, draft: live !== null });
  }, [gradeKey, frameSeq, frameOf, lutSeq, matte, chosen[0], chosen[1], tab, live !== null, row?.others.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── writing ── */
  const flush = React.useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    while (writing.current) await writing.current;
    if (!pending.current.size) return;
    const run = (async () => {
      for (const [id, g] of [...pending.current]) {
        try {
          const done = await api.put<{ lut: string | null; grade: Grade }>(`${base}/clips/${encodeURIComponent(id)}`, { grade: g });
          /* written as it was asked, unless it was changed again meanwhile */
          if (pending.current.get(id) === g) pending.current.delete(id);
          setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, lut: done.lut, graded: Boolean(done.lut), grade: pending.current.get(id) ?? normalize(done.grade) } : r)) ?? rs);
        } catch (e) {
          pending.current.delete(id);
          toast(`${w('notWritten')}: ${e instanceof Error ? e.message : String(e)}`, { error: true });
          void read();
        }
      }
    })();
    writing.current = run.then(() => { writing.current = null; });
    await writing.current;
    if (pending.current.size) await flush();
  }, [base, read, w]);
  React.useEffect(() => () => { void flush(); }, [flush]);

  /** A clip's grade changed for good: kept for undo, shown, and written a moment later. */
  const commitFor = React.useCallback((id: string, next: Grade, { undoable = true } = {}) => {
    const g = normalize(next);
    const was = rowsNow.current?.find((r) => r.id === id);
    if (!was || JSON.stringify(was.grade) === JSON.stringify(g)) return;
    if (undoable) {
      const h = history.current.get(id) ?? { undo: [], redo: [] };
      h.undo.push(was.grade); h.redo = [];
      if (h.undo.length > 200) h.undo.shift();
      history.current.set(id, h);
    }
    pending.current.set(id, g);
    /* kept here at once too: a second change before the page draws again builds on this one */
    rowsNow.current = rowsNow.current?.map((r) => (r.id === id ? { ...r, grade: g } : r)) ?? null;
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, grade: g } : r)) ?? rs);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, WRITE_AFTER);
  }, [flush]);
  const settleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = React.useCallback((next: Grade) => {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    setLive(null);
    if (selected) commitFor(selected, next);
  }, [selected, commitFor]);
  /* a button held down: what is shown is still being moved */
  const held = React.useRef(false);
  React.useEffect(() => {
    const down = () => { held.current = true; }, up = () => { held.current = false; };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); };
  }, []);
  /* what is shown is written once it is left alone: a control that paints without saying it was let go (a key held,
     a slider whose last move comes after the pointer is up) still has its grade written */
  const preview = React.useCallback((next: Grade) => {
    const g = normalize(next);
    setLive(g);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    const wait = () => { settleTimer.current = setTimeout(() => { if (held.current) wait(); else commit(g); }, 700); };
    wait();
  }, [commit]);

  const step = React.useCallback((back: boolean) => {
    if (!row) return;
    const h = history.current.get(row.id);
    const from = back ? h?.undo : h?.redo;
    const to = back ? h?.redo : h?.undo;
    if (!h || !from?.length || !to) return;
    const g = from.pop()!;
    to.push(row.grade);
    setLive(null);
    commitFor(row.id, g, { undoable: false });
  }, [row, commitFor]);
  const canUndo = Boolean(row && history.current.get(row.id)?.undo.length);
  const canRedo = Boolean(row && history.current.get(row.id)?.redo.length);

  /* ⌘Z, ⇧⌘Z while the workbench is shown and nothing is being typed in */
  React.useEffect(() => {
    if (!viewerBlock.shown && !gradeBlock.shown) return;
    const press = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); step(!e.shiftKey); }
      else if (e.key === 'Escape' && tool !== 'none') { setTool('none'); }
      else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === '\\') { setCompare((c) => (c === 'original' ? 'graded' : 'original')); }
    };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  }, [viewerBlock.shown, gradeBlock.shown, step, tool]);

  useProvide(OWNER, {
    opens: ['looks/color/*.cube'],
    show: (link) => {
      const m = /looks\/color\/([\w-]+)-[0-9a-f]{8}\.cube/.exec(link);
      if (m && rows?.some((r) => r.id === m[1])) setSelected(m[1]);
    },
    settle: () => flush(),
    restored: () => { history.current.clear(); pending.current.clear(); void read(); },
  });

  /* ── what the buttons do ── */
  const run = async (what: string, job: () => Promise<void>) => {
    setBusy(what);
    try { await job(); } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); } finally { setBusy(null); }
  };
  const auto = () => row && run('auto', async () => {
    await flush();
    const r = await api.post<{ grade: Grade }>(`${base}/clips/${encodeURIComponent(row.id)}/auto`, { grade: row.grade });
    commitFor(row.id, r.grade);
  });
  const matchTo = (to: string) => row && run('match', async () => {
    await flush();
    const r = await api.post<{ grade: Grade }>(`${base}/clips/${encodeURIComponent(row.id)}/match`, { to, grade: row.grade });
    commitFor(row.id, r.grade);
  });
  const copyTo = (to: string) => {
    if (!row || !rows) return;
    const targets = to === '*' ? rows.filter((r) => r.id !== row.id) : rows.filter((r) => r.id === to);
    for (const t of targets) commitFor(t.id, { ...row.grade, input: t.grade.input, range: t.grade.range, inputLut: t.grade.inputLut });
    toast(w('copied', { n: targets.length }));
  };
  const reset = () => row && commitFor(row.id, neutralGrade(row.auto.input, row.auto.range));

  const pick = async (x: number, y: number) => {
    if (!grade) return;
    if (tool === 'white') {
      const { white, tint } = await grader.whiteAt(grade, x, y);
      commit({ ...grade, white, tint });
      setTool('none');
    } else if (tool === 'window' && picking !== null && grade.windows[picking]) {
      const p = await grader.pick(x, y);
      const [h, s] = p.hsv;
      const l = 0.2126 * p.shown[0] + 0.7152 * p.shown[1] + 0.0722 * p.shown[2];
      const r2 = (n: number) => Math.round(n * 100) / 100;
      commit({ ...grade, windows: grade.windows.map((win, i) => (i === picking ? { ...win, hue: Math.round(h * 360), sat: [r2(Math.max(0, s - 0.2)), r2(Math.min(1, s + 0.3))], lum: [r2(Math.max(0, l - 0.3)), r2(Math.min(1, l + 0.3))] } : win)) });
      setMatte(picking);
      setTool('none');
    }
  };

  const file = React.useRef<HTMLInputElement | null>(null);
  const importAs = React.useRef<'input' | 'look'>('look');
  const importLut = async (files: FileList | null) => {
    if (!files?.length || !grade) return;
    try {
      const [path] = await projectOf(projectId).importFiles([...files], { into: 'luts' });
      if (!path) return;
      setLuts((l) => [...new Set([...l, path])].sort());
      commit(importAs.current === 'input' ? { ...grade, inputLut: { path } } : { ...grade, look: { path, mix: grade.look?.mix ?? 1 } });
    } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
  };

  const thumb = React.useCallback(async (c: ClipRow) => {
    const mid = c.to === null ? c.from : (c.from + c.to) / 2;
    const res = await fetch(`/api/plugins/color/${base}/clips/${encodeURIComponent(c.id)}/frame?s=${mid.toFixed(3)}&box=${THUMB_W}&graded=1`);
    if (!res.ok) return null;
    return { w: Number(res.headers.get('x-width')), h: Number(res.headers.get('x-height')), raw: await res.arrayBuffer() };
  }, [base]);

  const words = {
    original: w('original'), graded: w('graded'), pickWhite: w('pickWhite'), pickWindow: w('pickWindow'),
    none: rows && !rows.length ? w('noClips') : '',
  };
  const shot = grader.shot;
  const filmTime = row && second !== null ? row.at + (second - row.from) / (row.speed || 1) : null;

  const btn = 'flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[11.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40';
  return (
    <>
      {createPortal(
        <div className="flex h-full min-h-0 flex-col bg-[var(--bg-viewer)] text-[var(--text)]">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
            <div role="radiogroup" aria-label={w('compare')} className="flex rounded-[7px] bg-[var(--bg-field)] p-0.5">
              {(['graded', 'wipe', 'original'] as const).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={compare === c} onClick={() => setCompare(c)}
                  className={`rounded-[5px] px-2 py-0.5 text-[11px] ${compare === c ? 'bg-[var(--bg-panel)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]'}`}>{w(`cmp.${c}`)}</button>
              ))}
            </div>
            <span className="flex-1" />
            <Tooltip label={w('autoTip')}><button type="button" className={btn} disabled={!row || busy !== null} onClick={auto}><Wand2 size={13} />{busy === 'auto' ? w('working') : w('auto')}</button></Tooltip>
            <div className="w-[128px]">
              <MenuSelect label={w('matchTo')} prefix={w('matchTo')} value="" disabled={!row || busy !== null || (rows?.length ?? 0) < 2} menuWidth="content"
                groups={[{ choices: (rows ?? []).filter((r) => r.id !== row?.id).map((r) => ({ value: r.id, label: r.id })) }]} onPick={(v) => { void matchTo(v); }} />
            </div>
            <div className="w-[118px]">
              <MenuSelect label={w('copyTo')} prefix={w('copyTo')} value="" disabled={!row || (rows?.length ?? 0) < 2} menuWidth="content"
                groups={[{ choices: [{ value: '*', label: w('allClips') }] }, { choices: (rows ?? []).filter((r) => r.id !== row?.id).map((r) => ({ value: r.id, label: r.id })) }]} onPick={copyTo} />
            </div>
            <Tooltip label={w('resetTip')}><button type="button" className={btn} disabled={!row} onClick={reset}><RotateCcw size={13} /></button></Tooltip>
            <Tooltip label={w('undo')} shortcut="⌘Z"><button type="button" className={btn} disabled={!canUndo} onClick={() => step(true)}><Undo2 size={13} /></button></Tooltip>
            <Tooltip label={w('redo')} shortcut="⇧⌘Z"><button type="button" className={btn} disabled={!canRedo} onClick={() => step(false)}><Redo2 size={13} /></button></Tooltip>
          </div>
          <div className="relative min-h-0 flex-1">
            <Viewer shot={shot} compare={compare} wipe={wipe} onWipe={setWipe} tool={tool} onPick={(x, y) => { void pick(x, y); }} loading={loading} words={words} />
            {shot?.missing.length ? <div className="absolute bottom-2 left-2 rounded bg-[var(--warn)]/90 px-2 py-1 text-[11px] text-black">{w('lutMissing', { path: shot.missing[0] })}</div> : null}
          </div>
          {row ? (
            <div className="flex h-9 shrink-0 items-center gap-3 border-t border-[var(--border)] px-3">
              <span className="w-[92px] shrink-0 truncate text-[11px] text-[var(--text)]" title={row.src}>{row.id}</span>
              <input type="range" aria-label={w('moment')} className="min-w-0 flex-1 accent-[var(--accent)]"
                min={row.from} max={row.to ?? row.from + 10} step={0.01} value={second ?? row.from}
                onChange={(e) => setSecond(Number(e.target.value))} disabled={row.to === null} />
              <span className="w-[110px] shrink-0 text-right font-mono text-[10.5px] tabular-nums text-[var(--text-faint)]">
                {filmTime !== null ? `${filmTime.toFixed(2)} s` : ''}{shot ? ` · ${Math.round(shot.ms)} ms` : ''}
              </span>
            </div>
          ) : null}
        </div>, viewerBlock.slot)}
      {createPortal(<Scopes shot={shot} chosen={chosen} words={{ waveform: w('scope.waveform'), parade: w('scope.parade'), vectorscope: w('scope.vectorscope'), histogram: w('scope.histogram') }}
        onChoose={(slot, s) => setChosen((c) => { const n: [Scope, Scope] = slot === 0 ? [s, c[1]] : [c[0], s]; store('openfilm.color.scopes', n); return n; })} />, scopesBlock.slot)}
      {createPortal(grade ? (
        <>
          <Panel grade={grade} base={row?.grade ?? grade} tab={tab} onTab={(t) => { setTab(t); store('openfilm.color.tab', t); }} onPreview={preview} onCommit={commit}
            tool={tool} onTool={(t, i) => { setTool(t); if (i !== undefined) setPicking(i); }} picking={picking} matte={matte} onMatte={setMatte}
            luts={luts} onImportLut={(as) => { importAs.current = as; file.current?.click(); }}
            histogram={shot?.scopes.histogram ? Array.from(shot.scopes.histogram.subarray(768, 1024)) : undefined} w={w} />
          <input ref={file} type="file" accept=".cube" hidden onChange={(e) => { void importLut(e.target.files); e.target.value = ''; }} />
        </>
      ) : <div className="flex h-full items-center justify-center bg-[var(--bg-panel)] px-6 text-center text-[11px] text-[var(--text-faint)]">{rows ? w('noClips') : ''}</div>, gradeBlock.slot)}
      {createPortal(<Clips clips={rows ?? []} selected={selected} onSelect={(id) => { void flush(); setLive(null); setMatte(null); setSecond(null); setSelected(id); }} thumb={thumb}
        words={{ graded: w('gradedDot'), none: rows ? w('noClips') : '' }} />, clipsBlock.slot)}
    </>
  );
}

export default class ColorWorkbench extends HTMLElement {
  #root: Root | null = null;

  connectedCallback(): void {
    const projectId = this.getAttribute('project-id');
    if (!projectId || this.#root) return;
    this.style.display = 'contents';
    this.#root = createRoot(this, { identifierPrefix: 'color-' });
    this.#root.render(<StrictMode><Color projectId={projectId} /></StrictMode>);
  }

  disconnectedCallback(): void {
    /* after the render that took the element out, and only if it was not put back meanwhile: an element moved keeps
       what it holds */
    queueMicrotask(() => {
      if (this.isConnected || !this.#root) return;
      const root = this.#root;
      this.#root = null;
      root.unmount();
    });
  }
}
