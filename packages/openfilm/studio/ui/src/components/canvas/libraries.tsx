/**
 * What the board's toolbar opens over it, each a large window as the node canvases people know draw theirs: the
 * history of what its making nodes made (this project's or every project's, by kind), and the libraries — characters
 * (lib/canvas-library), styles and effects — whose cards go onto the board.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, ChevronLeft, Clock, FileX2, Film, Heart, Image as ImageIcon, PenLine, Search, Sparkles, Trash2, Upload, UserPlus, UserRound, X } from 'lucide-react';
import { useT } from '@/i18n';
import { api, type CanvasCharacter, type CanvasMade } from '@/api';
import { EFFECTS, EFFECT_GROUPS, STYLES, STYLE_GROUPS, libraryKept, noteUsed, toggleFavorite, type LibraryItem, type LibraryKind } from '@/lib/canvas-library';

/** the window itself: 1200 × 780 at most, 24 round, a column of its parts at the left when it has them */
export function CanvasModal({ onClose, side, children, label }: {
  onClose: () => void;
  side?: React.ReactNode;
  children: React.ReactNode;
  label: string;
}) {
  const t = useT();
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div className="cv-fade fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-6" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={label}
        className="cv-grow relative flex h-[min(780px,calc(100vh-48px))] w-[min(1200px,calc(100vw-48px))] overflow-hidden rounded-[24px] bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]">
        {side ? <aside className="flex w-[180px] shrink-0 flex-col border-r !border-[var(--cv-float-line)] px-2 py-4">{side}</aside> : null}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        <button type="button" aria-label={t('canvas.outline.close')} onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><X size={16} /></button>
      </div>
    </div>,
    document.body,
  );
}

/** a part of the window's left column, the one shown lit */
export function SideItem({ icon, label, on, onClick }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex h-9 w-full items-center gap-2 rounded-[12px] px-3 text-left text-[13px] transition ${on ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`}>
      <span className="shrink-0">{icon}</span><span className="truncate">{label}</span>
    </button>
  );
}

/** tabs at the window's top: the one shown in white, the others grey */
export function TopTabs<T extends string>({ tabs, on, onPick }: { tabs: Array<[T, string]>; on: T; onPick: (tab: T) => void }) {
  return (
    <div className="flex items-center gap-4">
      {tabs.map(([key, label]) => (
        <button key={key} type="button" onClick={() => onPick(key)}
          className={`text-[14px] font-medium transition ${key === on ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-ink-3)] hover:text-[var(--cv-ink-2)]'}`}>{label}</button>
      ))}
    </div>
  );
}

/** a filter chip, with how many it holds */
export function Chip({ label, count, on, onClick }: { label: string; count?: number; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[12.5px] transition ${on ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
      {label}{count !== undefined ? <span className="text-[var(--cv-ink-3)]">{count}</span> : null}
    </button>
  );
}

type MediaFilter = 'all' | 'image' | 'video' | 'audio';
const mediaOfMade = (m: CanvasMade): Exclude<MediaFilter, 'all'> => (m.make === 'image' || m.make === 'video' ? m.make : 'audio');

/**
 * What the canvases made, newest first: this project's or every project's, all or by kind. A click puts one on the
 * board (one of another project's is copied into this one first); one of this project's can be dragged there too.
 */
export function HistoryModal({ projectId, uploads, onAdd, onClose }: {
  projectId: string;
  /** what the board has that was brought in, not made: "Uploaded" */
  uploads: Array<{ path: string; media: 'image' | 'video' | 'audio'; url?: string }>;
  onAdd: (path: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [part, setPart] = React.useState<'made' | 'uploaded'>('made');
  const [scope, setScope] = React.useState<'project' | 'all'>('project');
  const [filter, setFilter] = React.useState<MediaFilter>('all');
  const [made, setMade] = React.useState<CanvasMade[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setMade(null);
    void api.canvasMade(projectId, scope === 'all').then((list) => { if (live) setMade(list); }, () => { if (live) setMade([]); });
    return () => { live = false; };
  }, [projectId, scope]);
  const items = part === 'made'
    ? (made ?? []).map((m) => ({ key: `${m.project ?? ''}|${m.path}`, path: m.path, media: mediaOfMade(m), url: api.canvasMadeFile(projectId, m), made: m }))
    : uploads.map((u) => ({ key: u.path, path: u.path, media: u.media, url: u.url, made: null as CanvasMade | null }));
  const counts = { all: items.length, image: 0, video: 0, audio: 0 };
  for (const i of items) counts[i.media] += 1;
  const shown = items.filter((i) => filter === 'all' || i.media === filter);
  const add = async (item: (typeof items)[number]) => {
    if (busy) return;
    if (!item.made?.project || item.made.project === projectId) { onAdd(item.path); onClose(); return; }
    setBusy(item.key);
    try { onAdd(await api.bringMade(projectId, item.made)); onClose(); } catch { setBusy(null); }
  };
  return (
    <CanvasModal label={t('canvas.history.title')} onClose={onClose}
      side={(
        <>
          <div className="mb-3 px-3 text-[13px] font-medium text-[var(--cv-ink-2)]">{t('canvas.history.title')}</div>
          <SideItem icon={<Clock size={15} />} label={t('canvas.history.made')} on={part === 'made'} onClick={() => setPart('made')} />
          <SideItem icon={<Upload size={15} />} label={t('canvas.history.uploaded')} on={part === 'uploaded'} onClick={() => setPart('uploaded')} />
        </>
      )}>
      <div className="flex items-center gap-4 px-5 pt-5">
        {part === 'made' ? <TopTabs tabs={[['project', t('canvas.history.thisProject')], ['all', t('canvas.history.allProjects')]]} on={scope} onPick={setScope} /> : <span className="text-[14px] font-medium">{t('canvas.history.uploaded')}</span>}
      </div>
      <div className="flex items-center gap-1 px-4 pt-3">
        {(['all', 'image', 'audio', 'video'] as const).map((f) => <Chip key={f} label={t(`canvas.history.kinds.${f}`)} count={counts[f]} on={filter === f} onClick={() => setFilter(f)} />)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
        {part === 'made' && made === null ? null : shown.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
            {shown.map((item) => (
              <button key={item.key} type="button" onClick={() => { void add(item); }} disabled={busy !== null}
                title={[item.made?.prompt, item.made?.projectName].filter(Boolean).join('\n') || item.path}
                className="group/item flex flex-col gap-1.5 text-left disabled:opacity-60">
                <span className="relative block aspect-square w-full overflow-hidden rounded-[12px] bg-[var(--cv-card)] ring-1 ring-[var(--cv-float-line)] transition group-hover/item:ring-[var(--cv-ring)]">
                  {item.media === 'image' && item.url ? <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    : item.media === 'video' && item.url ? <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-[var(--cv-label)]"><AudioLines size={28} /></span>}
                  <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-[6px] bg-black/60 text-white">
                    {item.media === 'image' ? <ImageIcon size={12} /> : item.media === 'video' ? <Film size={12} /> : <AudioLines size={12} />}
                  </span>
                  {busy === item.key ? <span className="absolute inset-0 flex items-center justify-center bg-black/40"><span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /></span> : null}
                </span>
                <span className="truncate px-0.5 text-[12px] text-[var(--cv-ink-2)]">{item.made?.prompt || item.path.split('/').pop()}</span>
                {item.made?.projectName && item.made.project !== projectId ? <span className="-mt-1 truncate px-0.5 text-[11px] text-[var(--cv-ink-3)]">{item.made.projectName}</span> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-[var(--cv-ink)]">
            <FileX2 size={22} className="text-[var(--cv-ink-2)]" />{t('canvas.history.none')}
          </div>
        )}
      </div>
    </CanvasModal>
  );
}

/* ── the material libraries: styles and effects ── */

/** an effect's little scene, moving as its camera does */
const EFFECT_CSS = `
@keyframes cvfx-push { from { transform: scale(1); } to { transform: scale(1.7); } }
@keyframes cvfx-pull { from { transform: scale(1.7); } to { transform: scale(1); } }
@keyframes cvfx-orbit { 0% { transform: perspective(300px) rotateY(-35deg); } 50% { transform: perspective(300px) rotateY(35deg); } 100% { transform: perspective(300px) rotateY(-35deg); } }
@keyframes cvfx-track { from { transform: translateX(-18%); } to { transform: translateX(18%); } }
@keyframes cvfx-follow { 0% { transform: scale(1.25) translateY(0); } 50% { transform: scale(1.3) translateY(-3%); } 100% { transform: scale(1.25) translateY(0); } }
@keyframes cvfx-whip { 0%, 35% { transform: translateX(0); filter: blur(0); } 45% { transform: translateX(-14%); filter: blur(5px); } 55% { transform: translateX(14%); filter: blur(5px); } 65%, 100% { transform: translateX(0); filter: blur(0); } }
@keyframes cvfx-vertigo-bg { from { transform: scale(1); } to { transform: scale(1.8); } }
@keyframes cvfx-rise { from { transform: translateY(0) scale(1.2); } to { transform: translateY(18%) scale(0.85); } }
@keyframes cvfx-dive { from { transform: scale(0.8) translateY(-10%); } to { transform: scale(1.8) translateY(8%); } }
@keyframes cvfx-clouds { 0% { opacity: 1; transform: scale(1); } 60% { opacity: 1; transform: scale(2.4); } 100% { opacity: 0; transform: scale(3); } }
@keyframes cvfx-fpv { 0% { transform: rotate(-8deg) scale(1.2) translateX(-6%); } 50% { transform: rotate(8deg) scale(1.5) translateX(6%); } 100% { transform: rotate(-8deg) scale(1.2) translateX(-6%); } }
@keyframes cvfx-slow { from { transform: translateY(-30%); } to { transform: translateY(30%); } }
@keyframes cvfx-lapse { 0% { filter: brightness(1.2); } 50% { filter: brightness(0.45); } 100% { filter: brightness(1.2); } }
@keyframes cvfx-bullet { 0% { transform: perspective(300px) rotateY(0); } 100% { transform: perspective(300px) rotateY(360deg); } }
@keyframes cvfx-shake { 0%, 100% { transform: translate(0, 0) rotate(0); } 25% { transform: translate(1.5%, -1%) rotate(0.6deg); } 50% { transform: translate(-1%, 1.5%) rotate(-0.5deg); } 75% { transform: translate(1%, 1%) rotate(0.4deg); } }
@keyframes cvfx-pov { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3%); } }
@keyframes cvfx-focus-a { 0%, 40% { filter: blur(0); } 60%, 100% { filter: blur(3px); } }
@keyframes cvfx-focus-b { 0%, 40% { filter: blur(3px); } 60%, 100% { filter: blur(0); } }
`;
const MOVES: Record<string, string> = {
  push: 'cvfx-push 2.4s ease-in-out infinite alternate', pull: 'cvfx-pull 2.4s ease-in-out infinite alternate', orbit: 'cvfx-orbit 3s ease-in-out infinite',
  track: 'cvfx-track 2.4s ease-in-out infinite alternate', follow: 'cvfx-follow 1.2s ease-in-out infinite', whip: 'cvfx-whip 1.8s ease-in-out infinite',
  vertigo: 'cvfx-vertigo-bg 2.4s ease-in-out infinite alternate', rise: 'cvfx-rise 2.6s ease-in-out infinite alternate', dive: 'cvfx-dive 2.2s ease-in infinite',
  clouds: '', fpv: 'cvfx-fpv 2.2s ease-in-out infinite', slow: '', lapse: 'cvfx-lapse 2s linear infinite', bullet: 'cvfx-bullet 3s linear infinite',
  shake: 'cvfx-shake 0.5s linear infinite', pov: 'cvfx-pov 0.9s ease-in-out infinite', focus: '',
};

/**
 * An effect's card: a field of dots (the world) and a white disc (what the camera looks at), moved as its camera
 * moves — a diagram of the move, not a picture of a place.
 */
function EffectScene({ look }: { look: string }) {
  const dots = { backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.32) 1.4px, transparent 1.8px)', backgroundSize: '14px 14px', backgroundPosition: 'center' };
  const subject = look === 'slow' ? { animation: 'cvfx-slow 4s ease-in-out infinite alternate' } : look === 'focus' ? { animation: 'cvfx-focus-b 2.4s ease-in-out infinite alternate' } : undefined;
  return (
    <span className="relative block h-full w-full overflow-hidden bg-[#181818]">
      <span className="absolute inset-[-40%]" style={{ animation: MOVES[look] || undefined, transformOrigin: '50% 50%' }}>
        <span className="absolute inset-0" style={{ ...dots, ...(look === 'focus' ? { animation: 'cvfx-focus-a 2.4s ease-in-out infinite alternate' } : look === 'lapse' ? { animation: 'cvfx-lapse 2s linear infinite' } : {}) }} />
        <span className="absolute left-1/2 top-1/2 aspect-square w-[11%] -translate-x-1/2 -translate-y-1/2">
          <span className="block h-full w-full rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.35)]" style={subject} />
        </span>
      </span>
      {look === 'clouds' ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-[140%] w-[140%] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9)_30%,rgba(255,255,255,0)_70%)]" style={{ animation: 'cvfx-clouds 2.6s ease-in infinite' }} />
        </span>
      ) : null}
      {/* the frame the camera sees */}
      <span className="pointer-events-none absolute inset-[12%] rounded-[6px] border border-white/25" />
    </span>
  );
}

/**
 * The styles' or effects' library: everything, what was liked, what was used last; searched, by group. A card picked
 * goes onto the board (wired into the picture or clip it was opened for).
 */
export function MaterialLibrary({ kind, onPick, onClose }: {
  kind: LibraryKind;
  onPick: (item: LibraryItem<string>) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = React.useState<'all' | 'fav' | 'recent'>('all');
  const [group, setGroup] = React.useState<string>('all');
  const [query, setQuery] = React.useState('');
  const [, setTick] = React.useState(0);
  const items: Array<LibraryItem<string>> = kind === 'styles' ? STYLES : EFFECTS;
  const groups: string[] = kind === 'styles' ? STYLE_GROUPS : EFFECT_GROUPS;
  const kept = libraryKept(kind);
  const nameOf = (item: LibraryItem<string>) => t(`canvas.${kind}.names.${item.id}`);
  const q = query.trim().toLowerCase();
  const listed = (tab === 'fav' ? kept.fav.flatMap((id) => items.filter((i) => i.id === id))
    : tab === 'recent' ? kept.recent.flatMap((id) => items.filter((i) => i.id === id)) : items)
    .filter((i) => (group === 'all' || i.group === group) && (!q || `${nameOf(i)} ${i.words}`.toLowerCase().includes(q)));
  return (
    <CanvasModal label={t(`canvas.library.${kind}`)} onClose={onClose}>
      <style>{EFFECT_CSS}</style>
      <div className="flex items-center gap-3 px-5 pr-16 pt-4">
        <div className="flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-0.5">
          {(['all', 'fav', 'recent'] as const).map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`h-8 rounded-[8px] px-3 text-[13px] transition ${tab === key ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
              {t(`canvas.library.tabs.${key}`).replace('{kind}', t(`canvas.library.short.${kind}`))}
            </button>
          ))}
        </div>
        <label className="flex h-9 w-[min(320px,40%)] items-center gap-2 rounded-[10px] bg-[var(--cv-chip)] px-3 text-[var(--cv-ink-3)]">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(`canvas.library.search.${kind}`)}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
          <Search size={14} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b !border-[var(--cv-float-line)] px-4 py-3">
        <Chip label={t('canvas.library.groups.all')} on={group === 'all'} onClick={() => setGroup('all')} />
        {groups.map((g) => <Chip key={g} label={t(`canvas.library.groups.${g}`)} on={group === g} onClick={() => setGroup(g)} />)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
        {listed.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
            {listed.map((item) => {
              const liked = kept.fav.includes(item.id);
              const [a, b] = item.look.split(',');
              return (
                <div key={item.id} className="group/card relative flex flex-col gap-1.5">
                  <button type="button" onClick={() => { noteUsed(kind, item.id); onPick(item); }} title={item.words}
                    className="relative block aspect-[4/5] w-full overflow-hidden rounded-[12px] ring-1 ring-[var(--cv-float-line)] transition hover:ring-[var(--cv-ring)]">
                    {kind === 'effects' ? <EffectScene look={item.look} /> : (
                      <span className="flex h-full w-full flex-col justify-end p-3 text-left" style={{ background: `linear-gradient(150deg, ${a} 0%, ${b} 100%)` }}>
                        <span className="line-clamp-4 text-[11.5px] leading-snug text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">{item.words}</span>
                      </span>
                    )}
                  </button>
                  <button type="button" aria-label={t(liked ? 'canvas.library.unlike' : 'canvas.library.like')} aria-pressed={liked}
                    onClick={() => { toggleFavorite(kind, item.id); setTick((n) => n + 1); }}
                    className={`absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-[8px] bg-black/55 text-white transition hover:bg-black/75 ${liked ? 'flex' : 'hidden group-hover/card:flex'}`}>
                    <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
                  </button>
                  <span className="truncate px-0.5 text-[13px] text-[var(--cv-ink)]">{nameOf(item)}</span>
                  <span className="-mt-1 truncate px-0.5 text-[11.5px] text-[var(--cv-ink-3)]">{t(`canvas.library.groups.${item.group}`)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-[var(--cv-ink-2)]">
            <FileX2 size={22} />{t(tab === 'fav' ? 'canvas.library.noneLiked' : tab === 'recent' ? 'canvas.library.noneUsed' : 'canvas.nothing')}
          </div>
        )}
      </div>
    </CanvasModal>
  );
}

/* ── the characters ── */

/** what a character's picture is of, as made from its presets: the portrait, the full body, its expressions, a turnaround */
export const CHARACTER_PARTS = [
  { role: 'face', preset: 'portrait' }, { role: 'body', preset: 'fullBody' }, { role: 'expressions', preset: 'expressions' }, { role: 'turnaround', preset: 'turnaround16' },
] as const;

/**
 * The person's characters: their cards (a picture, a name); one picked is put on the board (or wired into the node it
 * was opened for), renamed, described or removed. A new one is made from a few words (its pictures made on the board,
 * a group to keep as a character once made), or brought from pictures of the computer or of the Assets.
 */
export function CharacterLibrary({ projectId, forNode, assets, onUse, onGenerate, onImport, onClose }: {
  projectId: string;
  /** opened from a node's panel: a character picked goes into it */
  forNode: boolean;
  /** the project's pictures, to make one of */
  assets: Array<{ path: string; name: string; url: string }>;
  onUse: (character: CanvasCharacter) => void;
  onGenerate: (name: string, about: string) => void;
  /** pictures of the computer brought into the project: their paths */
  onImport: () => Promise<string[]>;
  onClose: () => void;
}) {
  const t = useT();
  const [list, setList] = React.useState<CanvasCharacter[] | null>(null);
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<null | 'menu' | 'import' | 'generate' | 'name' | 'edit'>(null);
  const [name, setName] = React.useState('');
  const [about, setAbout] = React.useState('');
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => { void api.canvasCharacters().then(setList, () => setList([])); }, []);
  React.useEffect(load, [load]);
  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter((c) => !q || `${c.name} ${c.about ?? ''}`.toLowerCase().includes(q));
  const current = (list ?? []).find((c) => c.id === picked) ?? null;
  const cover = (c: CanvasCharacter) => (c.pictures.find((p) => p.role === 'body') ?? c.pictures.find((p) => p.role === 'face') ?? c.pictures[0])?.url;
  const keep = async () => {
    setError(null);
    try {
      await api.saveCanvasCharacter(projectId, { name: name.trim(), about: about.trim(), pictures: chosen.map((path, i) => ({ role: i === 0 ? 'face' : 'other', path })) });
      setStep(null); setChosen([]); setName(''); setAbout(''); load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const field = 'w-full rounded-[10px] bg-[var(--cv-chip)] px-3 py-2 text-[13px] text-[var(--cv-ink)] outline-none ring-1 ring-transparent focus:ring-[var(--cv-ring)] placeholder:text-[var(--cv-ink-3)]';
  const primary = 'flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-40';
  const secondary = 'flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-chip)] px-4 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-40';
  if (step === 'generate' || step === 'name' || step === 'edit') {
    const editing = step === 'edit' && current;
    return (
      <CanvasModal label={t('canvas.characters.title')} onClose={onClose}>
        <div className="flex items-center gap-2 px-5 pt-4">
          <button type="button" aria-label={t('canvas.menu.back')} onClick={() => { setStep(null); setError(null); }} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><ChevronLeft size={16} /></button>
        </div>
        <div className="mx-auto flex w-[min(560px,90%)] flex-1 flex-col justify-center gap-4 pb-16">
          <div className="text-[22px] font-semibold">{t(step === 'generate' ? 'canvas.characters.newTitle' : step === 'edit' ? 'canvas.characters.edit' : 'canvas.characters.nameTitle')}</div>
          {step === 'name' ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {chosen.map((path) => { const a = assets.find((x) => x.path === path); return a ? <img key={path} src={a.url} alt="" className="h-24 w-24 shrink-0 rounded-[10px] object-cover" /> : null; })}
            </div>
          ) : null}
          <input autoFocus value={editing ? name || current!.name : name} onChange={(event) => setName(event.target.value)} placeholder={t('canvas.characters.name')} className={field} />
          <textarea value={editing && !about ? current!.about ?? '' : about} onChange={(event) => setAbout(event.target.value)} rows={5}
            placeholder={t(step === 'generate' ? 'canvas.characters.describe' : 'canvas.characters.aboutHint')} className={`${field} resize-none leading-relaxed`} />
          {error ? <div className="text-[12px] text-red-500">{error}</div> : null}
          <div className="flex items-center gap-2">
            {editing ? (
              <button type="button" className={`${secondary} !text-red-500`} onClick={() => { void api.removeCanvasCharacter(current!.id).then(() => { setPicked(null); setStep(null); load(); }); }}>
                <Trash2 size={14} />{t('canvas.characters.remove')}
              </button>
            ) : null}
            <span className="flex-1" />
            {step === 'generate' ? (
              <button type="button" className={primary} disabled={!name.trim() || !about.trim()} onClick={() => { onGenerate(name.trim(), about.trim()); onClose(); }}>
                <Sparkles size={14} />{t('canvas.characters.generate')}
              </button>
            ) : step === 'edit' ? (
              <button type="button" className={primary} onClick={() => {
                void api.updateCanvasCharacter(current!.id, { ...(name.trim() ? { name: name.trim() } : {}), about: about || current!.about || '' })
                  .then(() => { setStep(null); setName(''); setAbout(''); load(); }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
              }}>{t('canvas.characters.save')}</button>
            ) : (
              <button type="button" className={primary} disabled={!name.trim() || !chosen.length} onClick={() => { void keep(); }}>{t('canvas.characters.save')}</button>
            )}
          </div>
        </div>
      </CanvasModal>
    );
  }
  return (
    <CanvasModal label={t('canvas.characters.title')} onClose={onClose}>
      <div className="flex items-center gap-4 px-5 pr-16 pt-5">
        <TopTabs tabs={[['mine', t('canvas.characters.mine')]]} on="mine" onPick={() => {}} />
        <label className="ml-auto flex h-8 w-[220px] items-center gap-2 rounded-[10px] bg-[var(--cv-chip)] px-3 text-[var(--cv-ink-3)]">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('canvas.characters.search')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-5">
        {step === 'import' ? (
          <>
            <div className="mb-3 text-[13px] text-[var(--cv-ink-2)]">{t('canvas.characters.pickAssets')}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {assets.map((a) => {
                const on = chosen.includes(a.path);
                return (
                  <button key={a.path} type="button" onClick={() => setChosen((c) => (on ? c.filter((p) => p !== a.path) : [...c, a.path]))}
                    className={`relative aspect-square overflow-hidden rounded-[12px] ring-2 transition ${on ? 'ring-[var(--cv-edge-lit)]' : 'ring-transparent hover:ring-[var(--cv-ring)]'}`}>
                    <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {on ? <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--cv-edge-lit)] px-1 text-[11px] text-white">{chosen.indexOf(a.path) + 1}</span> : null}
                  </button>
                );
              })}
            </div>
            {!assets.length ? <div className="py-10 text-center text-[13px] text-[var(--cv-ink-2)]">{t('canvas.panel.nothingInAssets')}</div> : null}
          </>
        ) : list === null ? null : shown.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
            {shown.map((c) => (
              <button key={c.id} type="button" onClick={() => setPicked(picked === c.id ? null : c.id)} onDoubleClick={() => { onUse(c); onClose(); }}
                className="group/char flex flex-col items-center gap-2 text-left">
                <span className={`relative block aspect-[3/4] w-full overflow-hidden rounded-[14px] bg-[var(--cv-card)] ring-2 transition ${picked === c.id ? 'ring-[var(--cv-ink)]' : 'ring-transparent group-hover/char:ring-[var(--cv-ring)]'}`}>
                  {cover(c) ? <img src={cover(c)} alt="" className="h-full w-full object-cover" /> : null}
                  <span className="absolute bottom-1.5 right-1.5 rounded-[6px] bg-black/60 px-1.5 text-[11px] text-white">{c.pictures.length}</span>
                </span>
                <span className="w-full truncate text-center text-[13px]">{c.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[13px] text-[var(--cv-ink-2)]">
            <UserRound size={30} className="text-[var(--cv-ink-3)]" />
            <span className="max-w-[360px] leading-relaxed">{t('canvas.characters.none')}</span>
          </div>
        )}
      </div>
      <div className="relative flex items-center gap-2 border-t !border-[var(--cv-float-line)] px-5 py-3">
        {step === 'import' ? (
          <>
            <button type="button" className={secondary} onClick={() => { setStep(null); setChosen([]); }}>{t('canvas.characters.cancel')}</button>
            <span className="flex-1" />
            <button type="button" className={primary} disabled={!chosen.length} onClick={() => setStep('name')}>{t('canvas.characters.next')}</button>
          </>
        ) : (
          <>
            {/* none picked: making one is what the window offers, in its middle */}
            {current ? null : <span className="flex-1" />}
            <div className="relative">
              <button type="button" className={current ? secondary : primary} onClick={() => setStep(step === 'menu' ? null : 'menu')}><UserPlus size={14} />{t('canvas.characters.create')}</button>
              {step === 'menu' ? (
                <div className={`absolute bottom-11 w-[200px] rounded-[12px] bg-[var(--cv-float)] p-1 text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)] ${current ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}>
                  <button type="button" className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-[13px] hover:bg-[var(--cv-float-hover)]" onClick={() => { setName(''); setAbout(''); setStep('generate'); }}><Sparkles size={14} />{t('canvas.characters.generateNew')}</button>
                  <button type="button" className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-[13px] hover:bg-[var(--cv-float-hover)]" onClick={() => { void onImport().then((paths) => { if (paths.length) { setChosen(paths); setName(''); setAbout(''); setStep('name'); } else setStep(null); }); }}><Upload size={14} />{t('canvas.characters.fromComputer')}</button>
                  <button type="button" className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-[13px] hover:bg-[var(--cv-float-hover)]" onClick={() => { setChosen([]); setStep('import'); }}><ImageIcon size={14} />{t('canvas.characters.fromAssets')}</button>
                </div>
              ) : null}
            </div>
            <span className="flex-1" />
            {current ? (
              <>
                <button type="button" className={secondary} onClick={() => { setName(''); setAbout(''); setStep('edit'); }}><PenLine size={14} />{t('canvas.characters.edit')}</button>
                <button type="button" className={primary} onClick={() => { onUse(current); onClose(); }}>{t(forNode ? 'canvas.characters.useHere' : 'canvas.characters.add')}</button>
              </>
            ) : null}
          </>
        )}
      </div>
    </CanvasModal>
  );
}
