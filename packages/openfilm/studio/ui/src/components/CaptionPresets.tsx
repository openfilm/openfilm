/**
 * A caption's preset looks (the caption inspector's Text › Basic): "none" first, then each of the caption looks
 * (FILM_SUBTITLE_LOOKS) and the looks the person saved, a "T" drawn in each. A look is the library text's variables
 * (lib/caption-look); saving one keeps the caption's look now on this computer, for any project.
 */
import React from 'react';
import { Ban, X } from 'lucide-react';
import { FILM_SUBTITLE_DEFAULT, FILM_SUBTITLE_LOOKS, subtitleStyleVtt } from '../../../server/film-subtitle.mjs';
import { useT } from '@/i18n';
import { lookVars } from '@/lib/caption-look';

/** A caption look's variables (lib/caption-look), from its CSS as film-subtitle writes it. */
export function captionLookVars(id: string): Record<string, string> {
  const look = FILM_SUBTITLE_LOOKS[id as keyof typeof FILM_SUBTITLE_LOOKS];
  return look ? lookVars(subtitleStyleVtt({ ...FILM_SUBTITLE_DEFAULT, ...look } as never).css) : {};
}

export interface SavedLook { id: string; vars: Record<string, string> }
const SAVED_KEY = 'openfilm.captionPresets';
const MAX_SAVED = 24;

function readSaved(): SavedLook[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((x): x is SavedLook => !!x && typeof x.id === 'string' && !!x.vars && typeof x.vars === 'object').slice(0, MAX_SAVED) : [];
  } catch { return []; }
}
function writeSaved(list: SavedLook[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, MAX_SAVED))); } catch { /* kept for this window only */ }
  window.dispatchEvent(new Event(SAVED_KEY));
}

/** The looks the person saved, kept in step across the inspectors open. */
export function useSavedLooks(): [SavedLook[], (vars: Record<string, string>) => void, (id: string) => void] {
  const [saved, setSaved] = React.useState(readSaved);
  React.useEffect(() => {
    const again = () => setSaved(readSaved());
    window.addEventListener(SAVED_KEY, again);
    window.addEventListener('storage', again);
    return () => { window.removeEventListener(SAVED_KEY, again); window.removeEventListener('storage', again); };
  }, []);
  const save = React.useCallback((vars: Record<string, string>) => writeSaved([{ id: `s${Date.now().toString(36)}`, vars }, ...readSaved()]), []);
  const drop = React.useCallback((id: string) => writeSaved(readSaved().filter((x) => x.id !== id)), []);
  return [saved, save, drop];
}

/** How a look draws its "T": its font, color, edge, shadow and box. */
function tStyle(v: Readonly<Record<string, string>>): React.CSSProperties {
  const stroke = Number.parseFloat(v['--stroke'] ?? '0');
  const box = v['--box'] && v['--box'] !== 'transparent' && v['--box'] !== 'none' ? v['--box'] : undefined;
  return {
    fontFamily: v['--font'], fontWeight: Number(v['--weight'] ?? 700) || 700, fontStyle: v['--italic'] === 'italic' ? 'italic' : undefined,
    color: v['--color'] ?? '#fff', textShadow: v['--shadow'] && v['--shadow'] !== 'none' ? v['--shadow'] : undefined,
    WebkitTextStroke: stroke > 0 ? `${Math.max(1, stroke * 22)}px ${v['--stroke-color'] ?? '#000'}` : undefined, paintOrder: 'stroke fill',
    background: box, padding: box ? '0 5px' : undefined, borderRadius: box ? 3 : undefined, lineHeight: 1.15,
  };
}

/** The grid of presets: `on` is the one the caption has now ('' none, null another). */
export function CaptionPresets({ on, onPick, saved, onDrop }: {
  on: string | null;
  onPick: (id: string, vars: Record<string, string> | null) => void;
  saved: readonly SavedLook[];
  onDrop: (id: string) => void;
}) {
  const t = useT();
  const tile = tileClass;
  return (
    <div data-caption-presets="" className="grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5">
      <button type="button" title={t('textInspector.none')} onClick={() => onPick('', null)} className={`${tile(on === '')} text-[var(--text-faint)]`}><Ban size={18} /></button>
      {Object.keys(FILM_SUBTITLE_LOOKS).map((id) => (
        <button key={id} type="button" data-caption-preset={id} title={t(`assetDrawer.captionLook_${id}`)} onClick={() => onPick(id, captionLookVars(id))} className={tile(on === id)}>
          <span style={tStyle(captionLookVars(id))}>T</span>
        </button>
      ))}
      <SavedLookTiles saved={saved} on={on} onPick={onPick} onDrop={onDrop} />
    </div>
  );
}

const tileClass = (lit: boolean) => `relative grid aspect-square place-items-center rounded-[6px] bg-[var(--bg-field)] text-[20px] ${lit ? 'ring-2 ring-[var(--accent)]' : 'hover:ring-1 hover:ring-[var(--text-faint)]'}`;

/** The looks the person saved (captions' and lines of words' alike), each its "T", taken away by its ×. */
export function SavedLookTiles({ saved, on, onPick, onDrop }: {
  saved: readonly SavedLook[];
  on: string | null;
  onPick: (id: string, vars: Record<string, string>) => void;
  onDrop: (id: string) => void;
}) {
  const t = useT();
  return (
    <>
      {saved.map((s) => (
        <span key={s.id} className="group relative">
          <button type="button" data-caption-preset={s.id} title={t('captionTrack.savedLook')} onClick={() => onPick(s.id, s.vars)} className={`${tileClass(on === s.id)} w-full`}>
            <span style={tStyle(s.vars)}>T</span>
          </button>
          <button type="button" aria-label={t('captionTrack.savedLookDrop')} onClick={() => onDrop(s.id)}
            className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center rounded-full bg-[var(--bg-raised)] text-[var(--text-muted)] shadow-[0_0_0_1px_var(--border)] hover:text-[var(--text)] group-hover:grid">
            <X size={10} />
          </button>
        </span>
      ))}
    </>
  );
}
