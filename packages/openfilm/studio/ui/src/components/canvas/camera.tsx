/**
 * What a picture or a clip is shot with: four wheels — the camera, the lens, the focal length, the aperture — each
 * turned by its arrows, the wheel or the keys, what it looks like shown above (the lens's look on one street). What is
 * picked goes onto the board as words wired into the node, as a style does.
 */
import React from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { APERTURES, BODIES, FOCALS, LENSES, NO_CAMERA, type CameraPart, type CameraPick } from '@/lib/canvas-camera';

const pictures = (glob: Record<string, string>) => Object.fromEntries(Object.entries(glob).map(([path, url]) => [path.split('/').pop()!.replace(/\.webp$/, ''), url]));
/** a camera's and a lens's picture (on a clear ground), and how each camera, lens, focal length and aperture shows one same street */
const ICONS = pictures(import.meta.glob<string>('./camera/{body,lens}-*.webp', { eager: true, import: 'default' }));
const LOOKS = pictures(import.meta.glob<string>('./camera/look-*.webp', { eager: true, import: 'default' }));

type Wheel = 'body' | 'lens' | 'focal' | 'aperture';
/** where each wheel's names are said */
export const GROUP: Record<Wheel, string> = { body: 'bodies', lens: 'lenses', focal: 'focals', aperture: 'apertures' };
const WHEELS: Array<[Wheel, readonly CameraPart[]]> = [['body', BODIES], ['lens', LENSES], ['focal', FOCALS], ['aperture', APERTURES]];

/** a focal length drawn: a lens ring, wider the shorter it is */
function FocalMark({ id }: { id: string }) {
  const mm = Number(id) || 50;
  const r = id === 'auto' ? 15 : Math.max(9, Math.min(19, 22 - Math.log2(mm / 14) * 3.2));
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="22" fill="#1d1d1f" stroke="#4a4a4f" strokeWidth="2" />
      <circle cx="28" cy="28" r={r} fill="url(#glass)" stroke="#6a6a70" strokeWidth="1.5" />
      <defs><radialGradient id="glass" cx="35%" cy="35%" r="70%"><stop offset="0" stopColor="#7c8cff" stopOpacity="0.55" /><stop offset="1" stopColor="#0c0c10" /></radialGradient></defs>
    </svg>
  );
}
/** an aperture drawn: blades round a hole, smaller the larger the f-number */
function ApertureMark({ id }: { id: string }) {
  const f = Number(id.replace('_', '.')) || 4;
  const hole = id === 'auto' ? 10 : Math.max(3, Math.min(17, 19 - Math.log2(f) * 3.6));
  const blades = Array.from({ length: 7 }, (_, i) => (i / 7) * 360);
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="22" fill="#2a2a2e" stroke="#4a4a4f" strokeWidth="2" />
      {blades.map((a) => <path key={a} d={`M28 28 L${28 + 22 * Math.cos((a * Math.PI) / 180)} ${28 + 22 * Math.sin((a * Math.PI) / 180)} A22 22 0 0 1 ${28 + 22 * Math.cos(((a + 52) * Math.PI) / 180)} ${28 + 22 * Math.sin(((a + 52) * Math.PI) / 180)} Z`} fill="#3a3a3f" stroke="#1a1a1c" strokeWidth="0.8" />)}
      <circle cx="28" cy="28" r={hole} fill="#0b0b0d" />
    </svg>
  );
}

/** what a pick looks like on the street: its lens's, else its camera's, else the street as it is */
export const cameraLook = (pick: CameraPick) => LOOKS[`look-lens-${pick.lens}`] ?? LOOKS[`look-body-${pick.body}`] ?? LOOKS[`look-focal-${pick.focal}`] ?? LOOKS[`look-aperture-${pick.aperture}`] ?? LOOKS['look-auto'];

function mark(wheel: Wheel, id: string) {
  if (wheel === 'focal') return <FocalMark id={id} />;
  if (wheel === 'aperture') return <ApertureMark id={id} />;
  const src = ICONS[`${wheel}-${id}`];
  return src ? <img src={src} alt="" draggable={false} className="h-16 w-16 object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]" /> : <FocalMark id="auto" />;
}

export function CameraPicker({ start, onClose, onPick }: { start?: CameraPick; onClose: () => void; onPick: (pick: CameraPick) => void }) {
  const t = useT();
  const [pick, setPick] = React.useState<CameraPick>(start ?? NO_CAMERA);
  const [active, setActive] = React.useState<Wheel>('body');
  const wheelAt = React.useRef(0);
  const name = (wheel: Wheel, id: string) => (wheel === 'focal' && id !== 'auto' ? `${id}mm` : t(`canvas.camera.${GROUP[wheel]}.${id}`));
  const turn = (wheel: Wheel, by: number) => {
    const list = WHEELS.find(([w]) => w === wheel)![1];
    setPick((p) => {
      const i = Math.max(0, Math.min(list.length - 1, list.findIndex((x) => x.id === p[wheel]) + by));
      return { ...p, [wheel]: list[i]!.id };
    });
    setActive(wheel);
  };
  React.useEffect(() => {
    /* its own keys: ← → the wheel, ↑ ↓ turn it, Enter takes it, Esc closes */
    const key = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const at = WHEELS.findIndex(([w]) => w === active);
      const take = (run: () => void) => { event.preventDefault(); event.stopPropagation(); run(); };
      if (event.key === 'Escape') take(onClose);
      else if (event.key === 'ArrowLeft') take(() => setActive(WHEELS[Math.max(0, at - 1)]![0]));
      else if (event.key === 'ArrowRight') take(() => setActive(WHEELS[Math.min(WHEELS.length - 1, at + 1)]![0]));
      else if (event.key === 'ArrowUp') take(() => turn(active, -1));
      else if (event.key === 'ArrowDown') take(() => turn(active, 1));
      else if (event.key === 'Enter') take(() => onPick(pick));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  /* the look of what is being turned; else the lens's, the camera's, the street as it is */
  const look = LOOKS[`look-${active}-${pick[active]}`] ?? LOOKS[`look-lens-${pick.lens}`] ?? LOOKS[`look-body-${pick.body}`] ?? LOOKS['look-auto'];

  return createPortal(
    <div className="cv-fade fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-6" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={t('canvas.camera.title')}
        className="cv-grow relative flex max-h-[calc(100vh-48px)] w-[min(1040px,calc(100vw-48px))] flex-col overflow-hidden rounded-[24px] bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]">
        <div className="flex items-center gap-3 px-6 pt-5">
          <span className="text-[14px] font-semibold">{t('canvas.camera.title')}</span>
          <span className="flex-1" />
          <button type="button" onClick={() => setPick(NO_CAMERA)} className="h-8 rounded-[9px] px-3 text-[13px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{t('canvas.camera.reset')}</button>
          <button type="button" aria-label={t('canvas.outline.close')} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><X size={16} /></button>
        </div>
        {/* what it looks like through this lens */}
        <div className="flex justify-center px-6 pt-4">
          <div className="relative aspect-[16/9] w-[min(560px,100%)] overflow-hidden rounded-[16px] bg-[var(--cv-chip)] shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
            {look ? <img key={look} src={look} alt="" draggable={false} className="cv-fade h-full w-full object-cover" /> : null}
          </div>
        </div>
        {/* the four wheels */}
        <div className="grid grid-cols-4 gap-5 px-8 pb-2 pt-6">
          {WHEELS.map(([wheel, list]) => {
            const i = list.findIndex((x) => x.id === pick[wheel]);
            const prev = list[i - 1]; const next = list[i + 1];
            const on = active === wheel;
            return (
              <div key={wheel} className="flex min-w-0 flex-col items-center gap-2"
                onPointerEnter={() => setActive(wheel)}
                onWheel={(event) => {
                  const now = performance.now();
                  if (now - wheelAt.current < 110 || Math.abs(event.deltaY) < 4) return;
                  wheelAt.current = now;
                  turn(wheel, event.deltaY > 0 ? 1 : -1);
                }}>
                <span className={`text-[14px] transition ${on ? 'font-semibold text-[var(--cv-ink)]' : 'text-[var(--cv-ink-3)]'}`}>{t(`canvas.camera.wheels.${wheel}`)}</span>
                <button type="button" aria-label={t('canvas.camera.previous')} disabled={!prev} onClick={() => turn(wheel, -1)}
                  className={`flex h-7 w-11 items-center justify-center rounded-[8px] transition disabled:opacity-0 ${on ? 'bg-[var(--cv-chip)] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]' : 'text-[var(--cv-ink-3)]'}`}><ChevronUp size={16} /></button>
                <button type="button" disabled={!prev} onClick={() => turn(wheel, -1)} className="h-9 w-full truncate rounded-t-[14px] bg-[color-mix(in_srgb,var(--cv-ink)_3%,transparent)] px-2 text-[12.5px] text-[var(--cv-ink-3)] opacity-60 transition hover:opacity-100 disabled:invisible">
                  {prev ? name(wheel, prev.id) : ''}
                </button>
                <div className={`flex h-[124px] w-full flex-col items-center justify-center gap-2.5 rounded-[18px] transition ${on ? 'bg-[radial-gradient(circle_at_50%_30%,color-mix(in_srgb,var(--cv-ink)_10%,transparent),color-mix(in_srgb,var(--cv-ink)_4%,transparent))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--cv-ink)_16%,transparent)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_4%,transparent)]'}`}>
                  {mark(wheel, pick[wheel])}
                  <span className="max-w-full truncate px-2 text-[14px] text-[var(--cv-ink)]">{name(wheel, pick[wheel])}</span>
                </div>
                <button type="button" disabled={!next} onClick={() => turn(wheel, 1)} className="h-9 w-full truncate rounded-b-[14px] bg-[color-mix(in_srgb,var(--cv-ink)_3%,transparent)] px-2 text-[12.5px] text-[var(--cv-ink-3)] opacity-60 transition hover:opacity-100 disabled:invisible">
                  {next ? name(wheel, next.id) : ''}
                </button>
                <button type="button" aria-label={t('canvas.camera.next')} disabled={!next} onClick={() => turn(wheel, 1)}
                  className={`flex h-7 w-11 items-center justify-center rounded-[8px] transition disabled:opacity-0 ${on ? 'bg-[var(--cv-chip)] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]' : 'text-[var(--cv-ink-3)]'}`}><ChevronDown size={16} /></button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 px-8 pb-6 pt-3">
          <button type="button" onClick={() => onPick(pick)}
            className="h-11 min-w-[128px] rounded-[14px] bg-[var(--cv-invert)] px-6 text-[14px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90">{t('canvas.camera.confirm')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
