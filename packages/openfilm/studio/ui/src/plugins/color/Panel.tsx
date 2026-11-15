/**
 * The grade's controls, in the order a colorist works a shot: the footage's input first (what camera log it is, a
 * maker's LUT), then its light and balance, the wheels, contrast and color (Primaries), the curves, the hue and
 * saturation curves (HSL), windows on one range of colors, and a look on top. Every control paints as it moves
 * (`onPreview`) and is written when it is let go (`onCommit`); a double-click puts a slider back.
 */
import * as React from 'react';
import { Pipette, Plus, Trash2, Eye, EyeOff, Power } from 'lucide-react';
import { SliderField, Section, Segmented } from '@/components/inspector-fields';
import { MenuSelect, type MenuGroup } from '@/components/MenuSelect';
import { Tooltip } from '@/components/Tooltip';
import { INPUTS } from '../../../../../plugins/color/engine/inputs.mjs';
import { neutralWindow, type Grade, type Points, type Window as GradeWindow } from '../../../../../plugins/color/engine/grade.mjs';
import { CurveEditor } from './CurveEditor';
import { Wheels, type WheelId } from './Wheels';
import type { Tool } from './Viewer';

export type Tab = 'primaries' | 'curves' | 'hsl' | 'windows' | 'input';
type HslCurve = 'hueHue' | 'hueSat' | 'hueLum' | 'lumSat' | 'satSat';
type Words = (key: string, values?: Record<string, string | number>) => string;

const NONE = '';
const IMPORT = '\u0000import';

export function Panel({ grade, base, tab, onTab, onPreview, onCommit, tool, onTool, picking, matte, onMatte, luts, onImportLut, histogram, w }: {
  /** the grade shown (being moved) */
  grade: Grade;
  /** the grade as written: what a field's typed `+10` or `-40` is counted from while the picture shows a move */
  base: Grade;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onPreview: (g: Grade) => void;
  onCommit: (g: Grade) => void;
  tool: Tool;
  /** a picker on or off; for a window's, which window it picks for */
  onTool: (tool: Tool, window?: number) => void;
  /** the window a picker picks for */
  picking: number | null;
  /** the window whose matte the viewer shows, or null */
  matte: number | null;
  onMatte: (index: number | null) => void;
  /** the project's LUT files, by path */
  luts: string[];
  onImportLut: (as: 'input' | 'look') => void;
  /** luma's histogram of the picture as graded, 256 bins */
  histogram: ArrayLike<number> | undefined;
  w: Words;
}) {
  const set = (patch: Partial<Grade>, commit: boolean) => (commit ? onCommit : onPreview)({ ...grade, ...patch });
  const slider = (key: 'exposure' | 'white' | 'tint' | 'contrast' | 'pivot' | 'highlights' | 'shadows' | 'saturation' | 'vibrance', o: { min: number; max: number; neutral: number; step: number; unit?: string; fieldMin?: number; fieldMax?: number }) => (
    <SliderField label={w(key)} value={base[key]} fieldWidth={o.unit ? 76 : 60} {...o}
      onPreview={(n) => set({ [key]: n } as Partial<Grade>, false)} onCommit={(n) => set({ [key]: n } as Partial<Grade>, true)} onRevert={() => onPreview(grade)} />
  );
  const tabs: Tab[] = ['input', 'primaries', 'curves', 'hsl', 'windows'];
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-panel)] text-[var(--text)]">
      <div role="tablist" className="flex shrink-0 gap-0.5 border-b border-[var(--border)] px-2 py-1.5">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)}
            className={`rounded-[5px] px-2 py-1 text-[11px] transition ${tab === t ? 'bg-[var(--bg-selected)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
            {w(`tab.${t}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {tab === 'primaries' ? (
          <>
            <Section id="color.light" title={w('light')} aside={(
              <Tooltip label={w('pickWhiteTip')}>
                <button type="button" aria-pressed={tool === 'white'} onClick={() => onTool(tool === 'white' ? 'none' : 'white')}
                  className={`flex h-5 w-5 items-center justify-center rounded-[4px] ${tool === 'white' ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
                  <Pipette size={12} />
                </button>
              </Tooltip>
            )}>
              {slider('exposure', { min: -4, max: 4, neutral: 0, step: 0.01, unit: 'EV', fieldMin: -8, fieldMax: 8 })}
              {slider('white', { min: 2000, max: 12000, neutral: 6500, step: 10, unit: 'K', fieldMin: 1700, fieldMax: 15000 })}
              {slider('tint', { min: -100, max: 100, neutral: 0, step: 1 })}
            </Section>
            <Section id="color.wheels" title={w('wheels')}>
              <Wheels values={{ offset: grade.offset, lift: grade.lift, gamma: grade.gamma, gain: grade.gain }}
                labels={{ offset: w('offset'), lift: w('lift'), gamma: w('gamma'), gain: w('gain') }} resetLabel={w('reset')}
                onPreview={(id: WheelId, v) => set({ [id]: v } as Partial<Grade>, false)}
                onCommit={(id: WheelId, v) => set({ [id]: v } as Partial<Grade>, true)} />
            </Section>
            <Section id="color.tone" title={w('tone')}>
              {slider('contrast', { min: 0.5, max: 2, neutral: 1, step: 0.01, fieldMin: 0, fieldMax: 3 })}
              {slider('pivot', { min: 0.2, max: 0.65, neutral: 0.4135884, step: 0.001, fieldMin: 0, fieldMax: 1 })}
              {slider('highlights', { min: -1, max: 1, neutral: 0, step: 0.01 })}
              {slider('shadows', { min: -1, max: 1, neutral: 0, step: 0.01 })}
            </Section>
            <Section id="color.color" title={w('colorSection')}>
              {slider('saturation', { min: 0, max: 2, neutral: 1, step: 0.01, fieldMax: 3 })}
              {slider('vibrance', { min: -1, max: 1, neutral: 0, step: 0.01 })}
            </Section>
          </>
        ) : null}
        {tab === 'curves' ? <Curves grade={grade} set={set} histogram={histogram} w={w} /> : null}
        {tab === 'hsl' ? <Hsl grade={grade} set={set} w={w} /> : null}
        {tab === 'windows' ? <Windows grade={grade} base={base} set={set} tool={tool} onTool={onTool} picking={picking} matte={matte} onMatte={onMatte} w={w} /> : null}
        {tab === 'input' ? <Input grade={grade} base={base} set={set} luts={luts} onImportLut={onImportLut} w={w} /> : null}
      </div>
    </div>
  );
}

type Set = (patch: Partial<Grade>, commit: boolean) => void;

const CHANNEL_COLOR = { y: 'var(--text)', r: '#ff6b61', g: '#5fd97a', b: '#5aa8ff' } as const;

function Curves({ grade, set, histogram, w }: { grade: Grade; set: Set; histogram: ArrayLike<number> | undefined; w: Words }) {
  const [channel, setChannel] = React.useState<'y' | 'r' | 'g' | 'b'>('y');
  const put = (points: Points, commit: boolean) => set({ curves: { ...grade.curves, [channel]: points } }, commit);
  const changed = (c: 'y' | 'r' | 'g' | 'b') => grade.curves[c].some(([x, y]) => Math.abs(x - y) > 1e-6);
  return (
    <Section id="color.curves" bare title={w('tab.curves')}>
      <div className="flex items-center justify-between">
        <Segmented label={w('channel')} value={channel} small onChange={(v) => setChannel(v as typeof channel)}
          options={(['y', 'r', 'g', 'b'] as const).map((c) => ({ value: c, label: <span style={{ color: c === 'y' ? undefined : CHANNEL_COLOR[c] }}>{w(`ch.${c}`)}{changed(c) ? '•' : ''}</span> }))} />
        <button type="button" disabled={!changed(channel)} onClick={() => put([[0, 0], [1, 1]], true)}
          className="rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40">{w('reset')}</button>
      </div>
      <CurveEditor kind="tone" points={grade.curves[channel]} color={CHANNEL_COLOR[channel]} height={260} label={w(`ch.${channel}`)}
        backdrop={{ bins: histogram }} format={(x, y) => `${Math.round(x * 100)} → ${Math.round(y * 100)}`}
        onPreview={(p) => put(p, false)} onCommit={(p) => put(p, true)} />
      <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{w('curveHelp')}</p>
    </Section>
  );
}

const HSL: Record<HslCurve, { kind: 'hue' | 'graph'; range: [number, number]; rest: number; backdrop: { hues?: boolean; ramp?: boolean }; format: (x: number, y: number) => string }> = {
  hueHue: { kind: 'hue', range: [-0.5, 0.5], rest: 0, backdrop: { hues: true }, format: (x, y) => `${Math.round(x * 360)}° → ${y > 0 ? '+' : ''}${Math.round(y * 360)}°` },
  hueSat: { kind: 'hue', range: [0, 2], rest: 1, backdrop: { hues: true }, format: (x, y) => `${Math.round(x * 360)}° · ${Math.round(y * 100)} %` },
  hueLum: { kind: 'hue', range: [-1, 1], rest: 0, backdrop: { hues: true }, format: (x, y) => `${Math.round(x * 360)}° · ${y > 0 ? '+' : ''}${y.toFixed(2)} EV` },
  lumSat: { kind: 'graph', range: [0, 2], rest: 1, backdrop: { ramp: true }, format: (x, y) => `${Math.round(x * 100)} IRE · ${Math.round(y * 100)} %` },
  satSat: { kind: 'graph', range: [0, 2], rest: 1, backdrop: { ramp: true }, format: (x, y) => `${Math.round(x * 100)} % · ${Math.round(y * 100)} %` },
};

function Hsl({ grade, set, w }: { grade: Grade; set: Set; w: Words }) {
  const [curve, setCurve] = React.useState<HslCurve>('hueSat');
  const spec = HSL[curve];
  return (
    <Section id="color.hsl" bare title={w('tab.hsl')}>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(HSL) as HslCurve[]).map((c) => (
          <button key={c} type="button" aria-pressed={curve === c} onClick={() => setCurve(c)}
            className={`rounded-[5px] px-2 py-1 text-[10.5px] ${curve === c ? 'bg-[var(--bg-selected)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
            {w(`hsl.${c}`)}{grade[c].length ? ' •' : ''}
          </button>
        ))}
      </div>
      <CurveEditor key={curve} kind={spec.kind} points={grade[curve]} range={spec.range} rest={spec.rest} height={200} backdrop={spec.backdrop}
        color="#e8c27a" label={w(`hsl.${curve}`)} format={spec.format}
        onPreview={(p) => set({ [curve]: p } as Partial<Grade>, false)} onCommit={(p) => set({ [curve]: p } as Partial<Grade>, true)} />
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{w(`hslHelp.${curve}`)}</p>
        <button type="button" disabled={!grade[curve].length} onClick={() => set({ [curve]: [] } as Partial<Grade>, true)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40">{w('reset')}</button>
      </div>
    </Section>
  );
}

function Windows({ grade, base, set, tool, onTool, picking, matte, onMatte, w }: { grade: Grade; base: Grade; set: Set; tool: Tool; onTool: (t: Tool, window?: number) => void; picking: number | null; matte: number | null; onMatte: (i: number | null) => void; w: Words }) {
  const change = (i: number, patch: Partial<GradeWindow>, commit: boolean) => set({ windows: grade.windows.map((win, j) => (j === i ? { ...win, ...patch } : win)) }, commit);
  const [open, setOpen] = React.useState(0);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="pr-2 text-[10.5px] leading-snug text-[var(--text-faint)]">{w('windowsHelp')}</p>
        <button type="button" disabled={grade.windows.length >= 8}
          onClick={() => { set({ windows: [...grade.windows, neutralWindow()] }, true); setOpen(grade.windows.length); }}
          className="flex shrink-0 items-center gap-1 rounded-[5px] bg-[var(--bg-field)] px-2 py-1 text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40">
          <Plus size={12} />{w('addWindow')}
        </button>
      </div>
      {grade.windows.map((win, i) => (
        <section key={i} className="border-t border-[var(--border)] px-3 py-2">
          <div className="flex h-6 items-center gap-1">
            <button type="button" onClick={() => setOpen(open === i ? -1 : i)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px] font-semibold">
              <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: `hsl(${win.hue} 70% 50%)` }} />
              <span className={`truncate ${win.on ? '' : 'text-[var(--text-faint)] line-through'}`}>{w('window', { n: i + 1 })}</span>
            </button>
            <Tooltip label={w('pickWindowTip')}>
              <button type="button" aria-pressed={tool === 'window' && picking === i} onClick={() => { setOpen(i); onTool(tool === 'window' && picking === i ? 'none' : 'window', i); }}
                className={`flex h-5 w-5 items-center justify-center rounded-[4px] ${tool === 'window' && picking === i ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}><Pipette size={12} /></button>
            </Tooltip>
            <Tooltip label={w('matteTip')}>
              <button type="button" aria-pressed={matte === i} onClick={() => onMatte(matte === i ? null : i)}
                className={`flex h-5 w-5 items-center justify-center rounded-[4px] ${matte === i ? 'bg-[var(--bg-selected)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>{matte === i ? <Eye size={12} /> : <EyeOff size={12} />}</button>
            </Tooltip>
            <Tooltip label={win.on ? w('turnOff') : w('turnOn')}>
              <button type="button" aria-pressed={win.on} onClick={() => change(i, { on: !win.on }, true)}
                className={`flex h-5 w-5 items-center justify-center rounded-[4px] hover:bg-[var(--bg-hover)] ${win.on ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`}><Power size={12} /></button>
            </Tooltip>
            <Tooltip label={w('remove')}>
              <button type="button" onClick={() => { if (matte === i) onMatte(null); set({ windows: grade.windows.filter((_, j) => j !== i) }, true); }}
                className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><Trash2 size={12} /></button>
            </Tooltip>
          </div>
          {open === i ? (() => {
            /* the fields count from the window as written */
            const fixed = base.windows[i] ?? win;
            return (
            <div className="mt-1.5 flex flex-col gap-2 pb-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{w('takes')}</div>
              <div className="h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, hsl(0 80% 55%), hsl(60 80% 55%), hsl(120 80% 50%), hsl(180 80% 50%), hsl(240 80% 60%), hsl(300 80% 55%), hsl(360 80% 55%))' }} />
              <SliderField label={w('hue')} value={fixed.hue} min={0} max={360} neutral={win.hue} step={1} unit="°" onPreview={(n) => change(i, { hue: n }, false)} onCommit={(n) => change(i, { hue: n }, true)} />
              <SliderField label={w('width')} value={fixed.width} min={1} max={180} neutral={40} step={1} unit="°" onPreview={(n) => change(i, { width: n }, false)} onCommit={(n) => change(i, { width: n }, true)} />
              <Pair w={w} label={w('satRange')} value={fixed.sat} onPreview={(v) => change(i, { sat: v }, false)} onCommit={(v) => change(i, { sat: v }, true)} />
              <Pair w={w} label={w('lumRange')} value={fixed.lum} onPreview={(v) => change(i, { lum: v }, false)} onCommit={(v) => change(i, { lum: v }, true)} />
              <SliderField label={w('soft')} value={fixed.soft} min={0} max={1} neutral={0.5} step={0.01} onPreview={(n) => change(i, { soft: n }, false)} onCommit={(n) => change(i, { soft: n }, true)} />
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <input type="checkbox" checked={win.invert} onChange={(e) => change(i, { invert: e.target.checked }, true)} />{w('invert')}
              </label>
              <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{w('does')}</div>
              <SliderField label={w('hueShift')} value={fixed.hueShift} min={-90} max={90} neutral={0} step={1} unit="°" fieldMin={-180} fieldMax={180} onPreview={(n) => change(i, { hueShift: n }, false)} onCommit={(n) => change(i, { hueShift: n }, true)} />
              <SliderField label={w('saturation')} value={fixed.saturation} min={0} max={2} neutral={1} step={0.01} fieldMax={3} onPreview={(n) => change(i, { saturation: n }, false)} onCommit={(n) => change(i, { saturation: n }, true)} />
              <SliderField label={w('exposure')} value={fixed.exposure} min={-2} max={2} neutral={0} step={0.01} unit="EV" fieldMin={-4} fieldMax={4} onPreview={(n) => change(i, { exposure: n }, false)} onCommit={(n) => change(i, { exposure: n }, true)} />
              <SliderField label={w('warmth')} value={fixed.warmth} min={-1} max={1} neutral={0} step={0.01} onPreview={(n) => change(i, { warmth: n }, false)} onCommit={(n) => change(i, { warmth: n }, true)} />
            </div>
            );
          })() : null}
        </section>
      ))}
    </div>
  );
}

/** A range of 0–1: its name, then its low and high end each a slider. */
function Pair({ label, value, onPreview, onCommit, w }: { label: string; value: [number, number]; onPreview: (v: [number, number]) => void; onCommit: (v: [number, number]) => void; w: Words }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
      <SliderField label={w('from')} value={value[0]} min={0} max={1} neutral={0} step={0.01}
        onPreview={(n) => onPreview([Math.min(n, value[1]), value[1]])} onCommit={(n) => onCommit([Math.min(n, value[1]), value[1]])} />
      <SliderField label={w('to')} value={value[1]} min={0} max={1} neutral={1} step={0.01}
        onPreview={(n) => onPreview([value[0], Math.max(n, value[0])])} onCommit={(n) => onCommit([value[0], Math.max(n, value[0])])} />
    </div>
  );
}

function Input({ grade, base, set, luts, onImportLut, w }: { grade: Grade; base: Grade; set: Set; luts: string[]; onImportLut: (as: 'input' | 'look') => void; w: Words }) {
  const kinds = ['display', 'hdr', 'log'] as const;
  const inputGroups: MenuGroup[] = kinds.map((k) => ({ label: w(`kind.${k}`), choices: INPUTS.filter((i) => i.kind === k).map((i) => ({ value: i.id, label: i.name })) }));
  const lutGroups = (none: string): MenuGroup[] => [
    { choices: [{ value: NONE, label: none }] },
    ...(luts.length ? [{ label: w('projectLuts'), choices: luts.map((p) => ({ value: p, label: p })) }] : []),
    { choices: [{ value: IMPORT, label: w('importLut') }] },
  ];
  const kind = INPUTS.find((i) => i.id === grade.input)?.kind ?? 'display';
  return (
    <>
      <Section id="color.input" title={w('footage')}>
        <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{w('inputHelp')}</p>
        <MenuSelect label={w('input')} prefix={w('input')} value={grade.input} groups={inputGroups} menuWidth="content"
          disabled={Boolean(grade.inputLut)} onPick={(v) => set({ input: v }, true)} />
        {kind === 'log' ? (
          <Segmented label={w('range')} value={grade.range} small onChange={(v) => set({ range: v as Grade['range'] }, true)}
            options={[{ value: 'legal', label: w('ranges.legal') }, { value: 'full', label: w('ranges.full') }]} />
        ) : null}
        <MenuSelect label={w('inputLut')} prefix={w('inputLut')} value={grade.inputLut?.path ?? NONE} groups={lutGroups(w('noLut'))} menuWidth="content"
          onPick={(v) => (v === IMPORT ? onImportLut('input') : set({ inputLut: v ? { path: v } : null }, true))} />
        <Segmented label={w('output')} value={grade.output} small onChange={(v) => set({ output: v as Grade['output'] }, true)}
          options={[{ value: 'auto', label: w('outputs.auto') }, { value: 'film', label: w('outputs.film') }, { value: 'standard', label: w('outputs.standard') }]} />
        <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{w(`outputHelp.${grade.output}`)}</p>
      </Section>
      <Section id="color.look" title={w('look')}>
        <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{w('lookHelp')}</p>
        <MenuSelect label={w('look')} prefix={w('look')} value={grade.look?.path ?? NONE} groups={lutGroups(w('noLook'))} menuWidth="content"
          onPick={(v) => (v === IMPORT ? onImportLut('look') : set({ look: v ? { path: v, mix: grade.look?.mix ?? 1 } : null }, true))} />
        {grade.look ? (
          <SliderField label={w('mix')} value={Math.round((base.look ?? grade.look).mix * 100)} min={0} max={100} neutral={100} step={1} unit="%"
            onPreview={(n) => set({ look: { path: grade.look!.path, mix: n / 100 } }, false)} onCommit={(n) => set({ look: { path: grade.look!.path, mix: n / 100 } }, true)} />
        ) : null}
      </Section>
    </>
  );
}
